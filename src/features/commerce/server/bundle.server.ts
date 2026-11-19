// US8.5 Buy a bundle, through the development fake gateway. The bundle page shows each member
// course's standalone price beside the bundle price (AC8.5.1). Checkout locks the terms: each
// course's list price, access duration and its part of the bundle price (../domain/
// bundle-allocation.ts, in proportion to the list prices). Paying creates, in ONE transaction, a
// payment per course for its part, one enrolment per course with its own access clock (AC8.5.2)
// and one ledger sale per course split by that course's section owners, so refunds, switches and
// instructor shares work per course exactly as for a single purchase. The one-active-course rule
// for academic segments (US2.16) applies (AC8.5.3).
import { courseTitlesOf, getProductTerms } from '#src/features/catalog/index.ts';
import { getSegment } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { recordCourseSale } from '#src/features/ledger/index.ts';
import { type ActiveBundle, activeBundle } from '#src/features/marketing/index.ts';
import { flags } from '#src/features/platform/index.ts';
import { accrueReferral } from '#src/features/referrals/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { type Executor, getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  type BundleOrderItemRow,
  type BundleOrderRow,
  createBundleOrderRepository,
} from '../data/bundle.repository.ts';
import { createCommerceRepository } from '../data/commerce.repository.ts';
import { receiptNumber } from '../domain/access.ts';
import { allocateBundlePrice } from '../domain/bundle-allocation.ts';
import {
  COMMERCE_FLAGS,
  decideSettlement,
  isFakeGatewayAllowed,
  type NodeEnv,
  pendingExpiryCutoff,
} from '../domain/checkout.ts';
import { BundleOfferInput, BundleOrderRef, SettleBundleOrderInput } from './commerce.schema.ts';

const repo = createBundleOrderRepository();
const commerce = createCommerceRepository();

export type BundleError = AppError<
  | 'NOT_FOUND'
  | 'FEATURE_DISABLED'
  | 'ALREADY_ENROLLED'
  | 'ACADEMIC_ACTIVE_COURSE'
  | 'PAYMENT_SETTLED'
  | 'VALIDATION_FAILED'
>;
const withKey = <C extends BundleError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const notFound = () => withKey('NOT_FOUND', 'errors.commerce.bundleUnavailable');
const owned = () => withKey('ALREADY_ENROLLED', 'errors.commerce.bundleOwned');
/** US2.16: refused with `academic_active_course`. */
const academicActive = () =>
  withKey('ACADEMIC_ACTIVE_COURSE', 'errors.commerce.academic_active_course');
/** US2.16: the bundle alone would give an academic Student more than one active course. */
const academicSeveral = () =>
  withKey('ACADEMIC_ACTIVE_COURSE', 'errors.commerce.academicBundleSeveral');

async function gatewayAllowed(userId: string): Promise<boolean> {
  const flagOn = await flags().isEnabled(COMMERCE_FLAGS.fakeGateway, { userId });
  return isFakeGatewayAllowed(getEnv().NODE_ENV as NodeEnv, flagOn);
}

export type BundleOffer = {
  bundleId: string;
  nameBn: string;
  nameEn: string;
  pricePoisha: number;
  /** The member courses' standalone prices added up. */
  standaloneTotalPoisha: number;
  /** What the bundle saves against buying each course alone (0 when it saves nothing). */
  savingPoisha: number;
  courses: Array<{
    courseId: string;
    titleBn: string;
    titleEn: string;
    listPricePoisha: number;
    accessDurationMonths: number;
    /** This course's part of the bundle price (its sale in the ledger). */
    allocatedPoisha: number;
  }>;
};

type Priced = { bundle: ActiveBundle; offer: BundleOffer };

/** The bundle with each member course's published terms and its part of the price. */
async function pricedBundle(bundleId: string): Promise<Result<Priced, BundleError>> {
  const bundle = await activeBundle(bundleId);
  if (!bundle) return err(notFound());
  const terms = await Promise.all(
    bundle.courseIds.map((id) => getProductTerms({ type: 'course', id })),
  );
  const courses: Array<{ courseId: string; listPrice: number; months: number }> = [];
  for (const [i, t] of terms.entries()) {
    if (!t.ok || t.value.status !== 'published' || !t.value.accessDurationMonths)
      return err(notFound());
    courses.push({
      courseId: bundle.courseIds[i] as string,
      listPrice: t.value.listPrice,
      months: t.value.accessDurationMonths,
    });
  }
  const parts = allocateBundlePrice(
    bundle.pricePoisha,
    courses.map((c) => c.listPrice),
  );
  if (!parts.ok) return err(withKey('VALIDATION_FAILED', parts.error.i18nKey));
  const titles = await courseTitlesOf(bundle.courseIds);
  const standaloneTotalPoisha = courses.reduce((s, c) => s + c.listPrice, 0);
  return ok({
    bundle,
    offer: {
      bundleId: bundle.bundleId,
      nameBn: bundle.nameBn,
      nameEn: bundle.nameEn,
      pricePoisha: bundle.pricePoisha,
      standaloneTotalPoisha,
      savingPoisha: Math.max(0, standaloneTotalPoisha - bundle.pricePoisha),
      courses: courses.map((c, i) => ({
        courseId: c.courseId,
        titleBn: titles[c.courseId]?.titleBn ?? '',
        titleEn: titles[c.courseId]?.titleEn ?? '',
        listPricePoisha: c.listPrice,
        accessDurationMonths: c.months,
        allocatedPoisha: parts.value[i] as number,
      })),
    },
  });
}

/** AC8.5.1: the bundle page (public, like the catalog's bundle list). */
export async function bundleOffer(
  raw: BundleOfferInput,
): Promise<Result<BundleOffer, BundleError>> {
  const input = BundleOfferInput.parse(raw);
  const priced = await pricedBundle(input.bundleId);
  return priced.ok ? ok(priced.value.offer) : priced;
}

/**
 * Why this Student cannot buy these courses now, or null: a member course they already have, or
 * (US2.16) an academic segment where completing the purchase would leave them with more than one
 * active course: they already hold an active paid course, or the bundle itself holds several.
 */
async function purchaseBlock(
  exec: Executor,
  userId: string,
  bundle: { courseIds: readonly string[]; segmentId: string | null },
): Promise<BundleError | null> {
  const active = await commerce.activeEnrolments(exec, userId);
  if (active.some((e) => bundle.courseIds.includes(e.courseId))) return owned();
  if (bundle.segmentId) {
    const segment = await getSegment(bundle.segmentId);
    if (segment.ok && segment.value.segmentType === 'academic') {
      if (active.length > 0) return academicActive();
      if (bundle.courseIds.length > 1) return academicSeveral();
    }
  }
  return null;
}

export type BundleOrderView = {
  orderId: string;
  receiptNumber: string;
  bundleId: string;
  nameBn: string;
  nameEn: string;
  amountPoisha: number;
  status: BundleOrderRow['status'];
  createdAt: string;
  items: Array<{
    courseId: string;
    titleBn: string;
    titleEn: string;
    listPricePoisha: number;
    allocatedPoisha: number;
    accessDurationMonths: number;
    paymentId: string | null;
    /** The course's own access, once the bundle is paid. */
    accessEndsAt: string | null;
  }>;
};

async function toView(
  exec: Executor,
  o: BundleOrderRow,
  items: BundleOrderItemRow[],
): Promise<BundleOrderView> {
  const titles = await courseTitlesOf(items.map((i) => i.courseId));
  const enrolments = await Promise.all(
    items.map((i) => (i.paymentId ? commerce.enrolmentOfPayment(exec, i.paymentId) : null)),
  );
  return {
    orderId: o.orderId,
    receiptNumber: receiptNumber(o.orderId, o.createdAt),
    bundleId: o.bundleId,
    nameBn: o.nameBn,
    nameEn: o.nameEn,
    amountPoisha: o.amountPoisha,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    items: items.map((i, n) => ({
      courseId: i.courseId,
      titleBn: titles[i.courseId]?.titleBn ?? '',
      titleEn: titles[i.courseId]?.titleEn ?? '',
      listPricePoisha: i.listPricePoisha,
      allocatedPoisha: i.allocatedPoisha,
      accessDurationMonths: i.accessDurationMonths,
      paymentId: i.paymentId,
      accessEndsAt: enrolments[n]?.endsAt.toISOString() ?? null,
    })),
  };
}

/** Opens a pending bundle order at the bundle's current price, with the split locked in. */
export async function startBundleCheckout(
  actor: Actor,
  raw: BundleOfferInput,
): Promise<Result<BundleOrderView, BundleError>> {
  const input = BundleOfferInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId)))
    return err(withKey('FEATURE_DISABLED', 'errors.common.FEATURE_DISABLED'));
  const priced = await pricedBundle(input.bundleId);
  if (!priced.ok) return priced;
  const block = await purchaseBlock(getDb(), actor.userId, priced.value.bundle);
  if (block) return err(block);
  const { offer } = priced.value;
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const order = await repo.insertOrder(
      exec,
      {
        userId: actor.userId,
        bundleId: offer.bundleId,
        nameBn: offer.nameBn,
        nameEn: offer.nameEn,
        amountPoisha: offer.pricePoisha,
      },
      offer.courses.map((c, position) => ({
        position,
        courseId: c.courseId,
        listPricePoisha: c.listPricePoisha,
        allocatedPoisha: c.allocatedPoisha,
        accessDurationMonths: c.accessDurationMonths,
      })),
    );
    return ok(await toView(exec, order, await repo.itemsOf(exec, order.orderId)));
  });
}

export async function getBundleOrder(
  actor: Actor,
  raw: BundleOrderRef,
): Promise<Result<BundleOrderView, BundleError>> {
  const input = BundleOrderRef.parse(raw);
  const db = getDb();
  const o = await repo.orderOfUser(db, input.orderId, actor.userId);
  if (!o) return err(withKey('NOT_FOUND', 'errors.common.NOT_FOUND'));
  return ok(await toView(db, o, await repo.itemsOf(db, o.orderId)));
}

/**
 * The fake gateway's answer; idempotent. Success creates every course's payment, enrolment and
 * ledger sale in one transaction, or nothing: a refusal is decided before anything is written.
 */
export async function settleFakeBundleOrder(
  actor: Actor,
  raw: SettleBundleOrderInput,
): Promise<Result<BundleOrderView, BundleError>> {
  const input = SettleBundleOrderInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId)))
    return err(withKey('FEATURE_DISABLED', 'errors.common.FEATURE_DISABLED'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const o = await repo.lockOrderOfUser(exec, input.orderId, actor.userId);
    if (!o) return err(withKey('NOT_FOUND', 'errors.common.NOT_FOUND'));
    const decision = decideSettlement(o.status, input.outcome);
    if (!decision.ok) return err(withKey('PAYMENT_SETTLED', 'errors.commerce.PAYMENT_SETTLED'));
    const items = await repo.itemsOf(exec, o.orderId);
    if (!decision.value.isNew) return ok(await toView(exec, o, items));
    if (decision.value.next === 'failed') {
      await repo.settleOrder(exec, o.orderId, 'failed', `fake-${o.orderId}`);
      return ok(await toView(exec, { ...o, status: 'failed' }, items));
    }
    // Checks first (an error result does not roll back): no member course already active (each
    // locked for this transaction), and the academic one-course rule.
    for (const item of items)
      if (await commerce.activeEnrolmentForUpdate(exec, actor.userId, item.courseId))
        return err(owned());
    const bundle = await activeBundle(o.bundleId);
    const block = await purchaseBlock(exec, actor.userId, {
      courseIds: items.map((i) => i.courseId),
      segmentId: bundle?.segmentId ?? null,
    });
    if (block) return err(block);
    const occurredAt = new Date();
    for (const item of items) {
      const payment = await commerce.insertPayment(exec, {
        userId: actor.userId,
        courseId: item.courseId,
        amountPoisha: item.allocatedPoisha,
        bundleOrderId: o.orderId,
        accessDurationMonths: item.accessDurationMonths,
        kind: 'purchase',
      });
      await commerce.settlePayment(exec, payment.paymentId, 'succeeded', `fake-${o.orderId}`);
      await commerce.insertEnrolment(exec, {
        userId: actor.userId,
        courseId: item.courseId,
        paymentId: payment.paymentId,
        months: item.accessDurationMonths,
      });
      // Each course's part is posted as its own sale, split by that course's section owners.
      const posted = await recordCourseSale(tx, {
        paymentId: payment.paymentId,
        courseId: item.courseId,
        amountPoisha: item.allocatedPoisha,
        occurredAt,
      });
      if (!posted.ok)
        throw new Error(`ledger refused bundle sale ${payment.paymentId}: ${posted.error.code}`);
      // AC8.7.1: each course's confirmed payment accrues the referrer's share.
      await accrueReferral(tx, {
        paymentId: payment.paymentId,
        userId: actor.userId,
        amountPoisha: item.allocatedPoisha,
        occurredAt,
      });
      await repo.linkItemPayment(exec, o.orderId, item.position, payment.paymentId);
    }
    await repo.settleOrder(exec, o.orderId, 'succeeded', `fake-${o.orderId}`);
    return ok(
      await toView(exec, { ...o, status: 'succeeded' }, await repo.itemsOf(exec, o.orderId)),
    );
  });
}

const EXPIRY_BATCH = 500;

/**
 * Expires abandoned bundle checkouts the same way as single-course ones: every pending bundle order
 * older than the expiry is marked failed (`expired`). An order settled at the same moment is skipped
 * (row lock) and its settlement wins; paying an expired order later is refused (already settled).
 */
export async function expireAbandonedBundleOrders(
  now: Date,
  expiryMinutes: number,
): Promise<number> {
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const stale = await repo.lockStalePending(
      exec,
      pendingExpiryCutoff(now, expiryMinutes),
      EXPIRY_BATCH,
    );
    for (const row of stale) await repo.settleOrder(exec, row.orderId, 'failed', 'expired');
    return stale.length;
  });
}
