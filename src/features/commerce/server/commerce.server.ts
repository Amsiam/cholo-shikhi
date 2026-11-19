// The commerce service: checkout through the development fake gateway, and enrolment reads.
// A Student only ever reads or settles their own payment (every query is scoped by user ID), the
// price and duration come from the catalog's published terms at checkout (never from the client),
// and a succeeded payment creates exactly one enrolment inside the settlement transaction.
import { courseTitlesOf, getProductTerms } from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { recordCourseSale } from '#src/features/ledger/index.ts';
import {
  claimPromoUse,
  type PromoClaim,
  type PromoError,
  releasePromoUse,
} from '#src/features/marketing/index.ts';
import { flags } from '#src/features/platform/index.ts';
import { accrueReferral } from '#src/features/referrals/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { appError } from '#src/lib/errors.ts';
import { newId } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createCommerceRepository, type EnrolmentRow } from '../data/commerce.repository.ts';
import { accessState, canRenew, extendEnd, receiptNumber } from '../domain/access.ts';
import {
  alreadyEnrolled,
  COMMERCE_FLAGS,
  type CommerceError,
  decideSettlement,
  isFakeGatewayAllowed,
  type NodeEnv,
  pendingExpiryCutoff,
} from '../domain/checkout.ts';
import { PaymentRefInput, SettleFakePaymentInput, StartCheckoutInput } from './commerce.schema.ts';
import { type RefundState, refundStatesOf } from './refund.server.ts';

const repo = createCommerceRepository();
const notFound = () => appError('NOT_FOUND') as CommerceError;
const disabled = () => appError('FEATURE_DISABLED') as CommerceError;

export type CheckoutView = {
  paymentId: string;
  courseId: string;
  amountPoisha: number;
  /** US8.3: the promo discount already taken off amountPoisha (0 without a code). */
  discountPoisha: number;
  accessDurationMonths: number;
  status: 'pending' | 'succeeded' | 'failed';
  enrolmentId: string | null;
};

async function gatewayAllowed(userId: string): Promise<boolean> {
  const flagOn = await flags().isEnabled(COMMERCE_FLAGS.fakeGateway, { userId });
  return isFakeGatewayAllowed(getEnv().NODE_ENV as NodeEnv, flagOn);
}

function toView(
  row: {
    paymentId: string;
    courseId: string;
    amountPoisha: number;
    discountPoisha: number;
    accessDurationMonths: number;
  },
  status: CheckoutView['status'],
  enrolment: EnrolmentRow | null,
): CheckoutView {
  return {
    paymentId: row.paymentId,
    courseId: row.courseId,
    amountPoisha: row.amountPoisha,
    discountPoisha: row.discountPoisha,
    accessDurationMonths: row.accessDurationMonths,
    status,
    enrolmentId: enrolment?.enrolmentId ?? null,
  };
}

/**
 * Opens a pending payment for a published course at its current list price and duration. With a
 * promo code (US8.3) the code's use is claimed and logged in the same transaction and the payment
 * is for the discounted price; a refused code opens no payment and names its reason.
 */
export async function startCheckout(
  actor: Actor,
  raw: StartCheckoutInput,
): Promise<Result<CheckoutView, CommerceError | PromoError>> {
  const input = StartCheckoutInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId))) return err(disabled());
  const terms = await getProductTerms({ type: 'course', id: input.courseId });
  if (!terms.ok || terms.value.status !== 'published' || !terms.value.accessDurationMonths)
    return err(notFound());
  const months = terms.value.accessDurationMonths;
  const db = getDb();
  // An active enrolment can be renewed in its last 14 days (FR-DIST-4); before that, it is a duplicate.
  const active = await repo.activeEnrolment(db, actor.userId, input.courseId);
  if (active && !canRenew(active.endsAt, new Date())) return err(alreadyEnrolled());
  return withTransaction(db, async (tx) => {
    const paymentId = newId();
    let promo: PromoClaim | null = null;
    if (input.promoCode) {
      const claimed = await claimPromoUse(tx, {
        code: input.promoCode,
        courseId: input.courseId,
        goalId: terms.value.goalId,
        listPricePoisha: terms.value.listPrice,
        paymentId,
        userId: actor.userId,
        at: new Date(),
      });
      if (!claimed.ok) return claimed;
      promo = claimed.value;
    }
    const row = await repo.insertPayment(unwrapTx(tx), {
      paymentId,
      userId: actor.userId,
      courseId: input.courseId,
      amountPoisha: promo ? promo.payPoisha : terms.value.listPrice,
      discountPoisha: promo?.discountPoisha ?? 0,
      promoCodeId: promo?.promoCodeId ?? null,
      accessDurationMonths: months,
      kind: active ? 'renewal' : 'purchase',
    });
    return ok(toView(row, 'pending', null));
  });
}

/** The caller's own payment, for the fake gateway page and the result page. */
export async function getCheckout(
  actor: Actor,
  raw: PaymentRefInput,
): Promise<Result<CheckoutView, CommerceError>> {
  const input = PaymentRefInput.parse(raw);
  const db = getDb();
  const row = await repo.paymentOfUser(db, input.paymentId, actor.userId);
  if (!row) return err(notFound());
  return ok(
    toView(
      row,
      row.status,
      (await repo.enrolmentOfPayment(db, row.paymentId)) ??
        (await repo.renewalOfPayment(db, row.paymentId))?.enrolment ??
        null,
    ),
  );
}

/**
 * The fake gateway's answer. Idempotent: repeating the same outcome returns the same result, and
 * a payment never flips between outcomes. Success creates the enrolment in the same transaction;
 * if the Student meanwhile became enrolled in the course by another payment, this one is refused.
 */
export async function settleFakePayment(
  actor: Actor,
  raw: SettleFakePaymentInput,
): Promise<Result<CheckoutView, CommerceError>> {
  const input = SettleFakePaymentInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId))) return err(disabled());
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const row = await repo.lockPaymentOfUser(exec, input.paymentId, actor.userId);
    if (!row) return err(notFound());
    const decision = decideSettlement(row.status, input.outcome);
    if (!decision.ok) return decision;
    const { next, isNew } = decision.value;
    if (!isNew)
      return ok(
        toView(
          row,
          next,
          (await repo.enrolmentOfPayment(exec, row.paymentId)) ??
            (await repo.renewalOfPayment(exec, row.paymentId))?.enrolment ??
            null,
        ),
      );
    if (next === 'succeeded') {
      const active = await repo.activeEnrolmentForUpdate(exec, actor.userId, row.courseId);
      if (active && row.kind !== 'renewal') return err(alreadyEnrolled());
      await repo.settlePayment(exec, row.paymentId, 'succeeded', `fake-${row.paymentId}`);
      // A renewal extends the current access from its end date, so no days are lost. If the access
      // ran out between checkout and payment, the payment simply starts a new period.
      const enrolment = active
        ? await repo.renewEnrolment(exec, {
            enrolment: active,
            paymentId: row.paymentId,
            newEndsAt: extendEnd(active.endsAt, row.accessDurationMonths),
          })
        : await repo.insertEnrolment(exec, {
            userId: actor.userId,
            courseId: row.courseId,
            paymentId: row.paymentId,
            months: row.accessDurationMonths,
          });
      // The sale is posted to the ledger in the same transaction: no enrolment without its books.
      const posted = await recordCourseSale(tx, {
        paymentId: row.paymentId,
        courseId: row.courseId,
        amountPoisha: row.amountPoisha,
        occurredAt: new Date(),
      });
      if (!posted.ok) throw new Error(`ledger refused sale ${row.paymentId}: ${posted.error.code}`);
      // AC8.7.1: a referred Student's confirmed payment accrues the referrer's share.
      await accrueReferral(tx, {
        paymentId: row.paymentId,
        userId: actor.userId,
        amountPoisha: row.amountPoisha,
        occurredAt: new Date(),
      });
      return ok(toView(row, 'succeeded', enrolment));
    }
    await repo.settlePayment(exec, row.paymentId, 'failed', `fake-${row.paymentId}`);
    // A failed payment gives its promo use back (US8.3), so the code can be used again.
    if (row.promoCodeId) await releasePromoUse(tx, row.paymentId);
    return ok(toView(row, 'failed', null));
  });
}

/** Whether the Student holds an active enrolment, whether it can be renewed now, and until when. */
export async function enrolmentStatus(
  userId: string,
  courseId: string,
): Promise<{ isEnrolled: boolean; canRenew: boolean; endsAt: string | null }> {
  const active = await repo.activeEnrolment(getDb(), userId, courseId);
  return {
    isEnrolled: active !== null,
    canRenew: active !== null && canRenew(active.endsAt, new Date()),
    endsAt: active?.endsAt.toISOString() ?? null,
  };
}

export async function hasActiveEnrolment(userId: string, courseId: string): Promise<boolean> {
  return (await repo.activeEnrolment(getDb(), userId, courseId)) !== null;
}

export async function listActiveEnrolments(
  userId: string,
): Promise<Array<{ courseId: string; startsAt: string; endsAt: string }>> {
  const rows = await repo.activeEnrolments(getDb(), userId);
  return rows.map((r) => ({
    courseId: r.courseId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  }));
}

/** Every succeeded payment, oldest first: the ledger backfill's input. */
export async function listSucceededSales(): Promise<
  Array<{ paymentId: string; courseId: string; amountPoisha: number; occurredAt: Date }>
> {
  const rows = await repo.succeededPayments(getDb());
  return rows.map((r) => ({
    paymentId: r.paymentId,
    courseId: r.courseId,
    amountPoisha: r.amountPoisha,
    occurredAt: r.settledAt ?? r.createdAt,
  }));
}

/** At most this many enrolments are read for one course's statistics. */
export const COURSE_STATS_ENROLMENT_LIMIT = 5000;

/** A course's enrolments, newest first (statistics; the caller authorizes). */
export async function listCourseEnrolments(courseId: string): Promise<
  Array<{
    userId: string;
    status: 'active' | 'expired' | 'revoked' | 'switched';
    startsAt: string;
    endsAt: string;
    amountPoisha: number;
  }>
> {
  const rows = await repo.enrolmentsOfCourse(getDb(), courseId, COURSE_STATS_ENROLMENT_LIMIT);
  const now = Date.now();
  return rows.map((r) => ({
    userId: r.userId,
    // An active enrolment past its end date is reported as expired.
    status: r.status === 'active' && r.endsAt.getTime() <= now ? 'expired' : r.status,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    amountPoisha: r.amountPoisha,
  }));
}

export type Purchase = {
  paymentId: string;
  receiptNumber: string;
  courseId: string;
  titleBn: string;
  titleEn: string;
  amountPoisha: number;
  currency: string;
  gateway: 'fake';
  kind: 'purchase' | 'renewal';
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: string;
  settledAt: string | null;
  accessDurationMonths: number;
  refund: RefundState | null;
  access: {
    startsAt: string;
    endsAt: string;
    daysLeft: number;
    isExpired: boolean;
    isExpiringSoon: boolean;
  } | null;
};

const PURCHASE_LIMIT = 200;

/** The caller's own payments and receipts (newest first). */
export async function listMyPurchases(actor: Actor): Promise<Result<Purchase[], never>> {
  const rows = await repo.purchasesOfUser(getDb(), actor.userId, PURCHASE_LIMIT);
  const titles = await courseTitlesOf([...new Set(rows.map((r) => r.payment.courseId))]);
  const now = new Date();
  const refunds = await refundStatesOf(
    actor.userId,
    rows.map(({ payment: p, enrolment: e }) => ({
      paymentId: p.paymentId,
      status: p.status,
      kind: p.kind,
      settledAt: p.settledAt,
      enrolmentId: e?.enrolmentId ?? null,
      enrolmentStatus: e?.status ?? null,
    })),
  );
  return ok(
    rows.map(({ payment: p, enrolment: e, renewal: r }) => ({
      refund: refunds.get(p.paymentId) ?? null,
      paymentId: p.paymentId,
      receiptNumber: receiptNumber(p.paymentId, p.createdAt),
      courseId: p.courseId,
      titleBn: titles[p.courseId]?.titleBn ?? '',
      titleEn: titles[p.courseId]?.titleEn ?? '',
      amountPoisha: p.amountPoisha,
      currency: p.currency,
      gateway: p.gateway,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      settledAt: p.settledAt?.toISOString() ?? null,
      accessDurationMonths: p.accessDurationMonths,
      kind: p.kind,
      access: r
        ? {
            startsAt: r.previousEndsAt.toISOString(),
            endsAt: r.newEndsAt.toISOString(),
            ...accessState(r.newEndsAt, now),
          }
        : e
          ? {
              startsAt: e.startsAt.toISOString(),
              endsAt: e.endsAt.toISOString(),
              ...accessState(e.endsAt, now),
            }
          : null,
    })),
  );
}

/** One receipt of the caller's own; anyone else's answers NOT_FOUND. */
export async function getMyPurchase(
  actor: Actor,
  raw: PaymentRefInput,
): Promise<Result<Purchase, CommerceError>> {
  const input = PaymentRefInput.parse(raw);
  const all = await listMyPurchases(actor);
  const found = all.ok ? all.value.find((p) => p.paymentId === input.paymentId) : undefined;
  return found ? ok(found) : err(notFound());
}

export type PaymentEvidence = {
  paymentId: string;
  userId: string;
  courseId: string;
  amountPoisha: number;
  status: 'pending' | 'succeeded' | 'failed';
  gatewayRef: string | null;
  createdAt: string;
  settledAt: string | null;
  enrolment: { enrolmentId: string; startsAt: string; endsAt: string; status: string } | null;
};

/** A payment and the enrolment it created, for a dispute's evidence pack (the caller authorizes). */
export async function paymentEvidence(paymentId: string): Promise<PaymentEvidence | null> {
  const db = getDb();
  const row = await repo.paymentById(db, paymentId);
  if (!row) return null;
  const e =
    (await repo.enrolmentOfPayment(db, row.paymentId)) ??
    (await repo.renewalOfPayment(db, row.paymentId))?.enrolment ??
    null;
  return {
    paymentId: row.paymentId,
    userId: row.userId,
    courseId: row.courseId,
    amountPoisha: row.amountPoisha,
    status: row.status,
    gatewayRef: row.gatewayRef,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    enrolment: e
      ? {
          enrolmentId: e.enrolmentId,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          status: e.status,
        }
      : null,
  };
}

const EXPIRY_BATCH = 500;

/**
 * Expires abandoned checkouts: every pending payment older than the expiry is marked failed
 * (`expired`) and its promo use is given back, in one transaction. A payment settled at the same
 * moment is skipped (row lock); the release itself is guarded (`is_released`), so a use is never
 * given back twice nor given back for a payment that succeeded.
 */
export async function expireAbandonedCheckouts(now: Date, expiryMinutes: number): Promise<number> {
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const stale = await repo.lockStalePending(
      exec,
      pendingExpiryCutoff(now, expiryMinutes),
      EXPIRY_BATCH,
    );
    for (const row of stale) {
      await repo.settlePayment(exec, row.paymentId, 'failed', 'expired');
      if (row.promoCodeId) await releasePromoUse(tx, row.paymentId);
    }
    return stale.length;
  });
}
