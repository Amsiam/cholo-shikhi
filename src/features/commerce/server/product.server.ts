// Buying Practice Packs, exam packages and monthly subscription plans through the fake gateway, and
// what they grant. A pack or package gives six months from purchase (the human's decision); a plan
// gives one month, and buying it again while active adds the next month from the current end
// (manual renewal, US2.10). A pack's sale is split by its course's owners, like a course; an exam
// package or a plan is platform revenue for now.
import {
  getProductTerms,
  productDetails,
  publishedPackContents,
} from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { recordCourseSale, recordPlatformSale } from '#src/features/ledger/index.ts';
import { flags } from '#src/features/platform/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  type AccessRow,
  createProductOrderRepository,
  type OrderRow,
  type ProductType,
} from '../data/product.repository.ts';
import { extendEnd, receiptNumber } from '../domain/access.ts';
import {
  COMMERCE_FLAGS,
  decideSettlement,
  isFakeGatewayAllowed,
  type NodeEnv,
} from '../domain/checkout.ts';
import {
  ProductCheckoutInput,
  ProductOrderRef,
  SettleProductOrderInput,
} from './commerce.schema.ts';

const repo = createProductOrderRepository();

export const PRODUCT_ACCESS_MONTHS: Record<ProductType, 1 | 6> = {
  practice_pack: 6,
  exam_package: 6,
  subscription_plan: 1,
};

type ProductError = AppError<
  'NOT_FOUND' | 'FEATURE_DISABLED' | 'ALREADY_ENROLLED' | 'PAYMENT_SETTLED'
>;

async function gatewayAllowed(userId: string): Promise<boolean> {
  const flagOn = await flags().isEnabled(COMMERCE_FLAGS.fakeGateway, { userId });
  return isFakeGatewayAllowed(getEnv().NODE_ENV as NodeEnv, flagOn);
}

export type OrderView = {
  orderId: string;
  receiptNumber: string;
  productType: ProductType;
  productId: string;
  titleBn: string;
  titleEn: string;
  amountPoisha: number;
  accessMonths: number;
  status: OrderRow['status'];
  createdAt: string;
  access: { startsAt: string; endsAt: string } | null;
};

const toView = (o: OrderRow, a: AccessRow | null): OrderView => ({
  orderId: o.orderId,
  receiptNumber: receiptNumber(o.orderId, o.createdAt),
  productType: o.productType,
  productId: o.productId,
  titleBn: o.titleBn,
  titleEn: o.titleEn,
  amountPoisha: o.amountPoisha,
  accessMonths: o.accessMonths,
  status: o.status,
  createdAt: o.createdAt.toISOString(),
  access: a ? { startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString() } : null,
});

/** Opens a pending order at the product's current price. A pack or package already owned is refused. */
export async function startProductCheckout(
  actor: Actor,
  raw: ProductCheckoutInput,
): Promise<Result<OrderView, ProductError>> {
  const input = ProductCheckoutInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId))) return err(appError('FEATURE_DISABLED'));
  const ref = { type: input.productType, id: input.productId } as const;
  const [terms, details] = await Promise.all([getProductTerms(ref), productDetails(ref)]);
  if (!terms.ok || terms.value.status !== 'published' || !details)
    return err(appError('NOT_FOUND'));
  const db = getDb();
  if (
    input.productType !== 'subscription_plan' &&
    (await repo.latestActive(db, actor.userId, input.productType, input.productId, new Date()))
  )
    return err({ ...appError('ALREADY_ENROLLED'), i18nKey: 'errors.commerce.alreadyOwned' });
  const order = await repo.insertOrder(db, {
    userId: actor.userId,
    productType: input.productType,
    productId: input.productId,
    courseId: details.courseId,
    titleBn: details.titleBn,
    titleEn: details.titleEn,
    amountPoisha: terms.value.listPrice,
    accessMonths: PRODUCT_ACCESS_MONTHS[input.productType],
  });
  return ok(toView(order, null));
}

export async function getProductOrder(
  actor: Actor,
  raw: ProductOrderRef,
): Promise<Result<OrderView, ProductError>> {
  const input = ProductOrderRef.parse(raw);
  const db = getDb();
  const o = await repo.orderOfUser(db, input.orderId, actor.userId);
  if (!o) return err(appError('NOT_FOUND'));
  return ok(toView(o, await repo.accessOfOrder(db, o.orderId)));
}

/** The fake gateway's answer; idempotent. Success grants access and posts the sale together. */
export async function settleFakeProductOrder(
  actor: Actor,
  raw: SettleProductOrderInput,
): Promise<Result<OrderView, ProductError>> {
  const input = SettleProductOrderInput.parse(raw);
  if (!(await gatewayAllowed(actor.userId))) return err(appError('FEATURE_DISABLED'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const o = await repo.lockOrderOfUser(exec, input.orderId, actor.userId);
    if (!o) return err(appError('NOT_FOUND'));
    const decision = decideSettlement(o.status, input.outcome);
    if (!decision.ok) return decision;
    if (!decision.value.isNew) return ok(toView(o, await repo.accessOfOrder(exec, o.orderId)));
    if (decision.value.next === 'failed') {
      await repo.settleOrder(exec, o.orderId, 'failed', `fake-${o.orderId}`);
      return ok(toView({ ...o, status: 'failed' }, null));
    }
    const now = new Date();
    const current = await repo.latestActive(exec, actor.userId, o.productType, o.productId, now);
    if (current && o.productType !== 'subscription_plan')
      return err({ ...appError('ALREADY_ENROLLED'), i18nKey: 'errors.commerce.alreadyOwned' });
    // A plan renewed while active continues from its end, so no days are lost.
    const startsAt = current ? current.endsAt : now;
    await repo.settleOrder(exec, o.orderId, 'succeeded', `fake-${o.orderId}`);
    const access = await repo.insertAccess(exec, {
      userId: actor.userId,
      productType: o.productType,
      productId: o.productId,
      orderId: o.orderId,
      startsAt,
      endsAt: extendEnd(startsAt, o.accessMonths),
    });
    const posted =
      o.productType === 'practice_pack' && o.courseId
        ? await recordCourseSale(tx, {
            paymentId: o.orderId,
            courseId: o.courseId,
            amountPoisha: o.amountPoisha,
            occurredAt: now,
          })
        : await recordPlatformSale(tx, {
            paymentId: o.orderId,
            amountPoisha: o.amountPoisha,
            occurredAt: now,
          });
    if (!posted.ok) throw new Error(`ledger refused order ${o.orderId}: ${posted.error.code}`);
    return ok(toView({ ...o, status: 'succeeded' }, access));
  });
}

/** The caller's product orders, newest first (purchase history). */
export async function listMyOrders(actor: Actor): Promise<OrderView[]> {
  const db = getDb();
  const orders = await repo.ordersOf(db, actor.userId, 200);
  return Promise.all(orders.map(async (o) => toView(o, await repo.accessOfOrder(db, o.orderId))));
}

export type Entitlements = {
  practicePackIds: string[];
  /** Bought directly or included in an active plan. */
  examPackageIds: string[];
  /** Courses included in an active plan, with the plan's end. */
  planCourses: Array<{ courseId: string; endsAt: string }>;
  plans: Array<{ planId: string; endsAt: string }>;
};

/** What the Student's packs, packages and plans let them use right now. */
export async function entitlementsOf(userId: string): Promise<Entitlements> {
  const active = await repo.activeOf(getDb(), userId, new Date());
  const latest = new Map<string, AccessRow>();
  for (const a of active) {
    const key = `${a.productType}:${a.productId}`;
    const seen = latest.get(key);
    if (!seen || a.endsAt > seen.endsAt) latest.set(key, a);
  }
  const rows = [...latest.values()];
  const plans = rows.filter((a) => a.productType === 'subscription_plan');
  const planTerms = await Promise.all(
    plans.map(async (p) => ({
      p,
      terms: await getProductTerms({ type: 'subscription_plan', id: p.productId }),
    })),
  );
  const planCourses = new Map<string, string>();
  const packages = new Set(
    rows.filter((a) => a.productType === 'exam_package').map((a) => a.productId),
  );
  for (const { p, terms } of planTerms) {
    if (!terms.ok) continue;
    for (const c of terms.value.includedCourseIds) {
      const end = p.endsAt.toISOString();
      if ((planCourses.get(c) ?? '') < end) planCourses.set(c, end);
    }
    for (const e of terms.value.includedExamPackageIds) packages.add(e);
  }
  return {
    practicePackIds: rows.filter((a) => a.productType === 'practice_pack').map((a) => a.productId),
    examPackageIds: [...packages],
    planCourses: [...planCourses].map(([courseId, endsAt]) => ({ courseId, endsAt })),
    plans: plans.map((p) => ({ planId: p.productId, endsAt: p.endsAt.toISOString() })),
  };
}

/**
 * Mock tests the Student may take through packs, and those every pack locks away from everyone
 * else (PRD FR-RTN-2: course enrolment does not grant pack content).
 */
export async function packExamAccess(
  userId: string,
): Promise<{ granted: string[]; locked: string[] }> {
  const [packs, ent] = await Promise.all([publishedPackContents(), entitlementsOf(userId)]);
  const owned = new Set(ent.practicePackIds);
  return {
    granted: [
      ...new Set(packs.filter((p) => owned.has(p.practicePackId)).flatMap((p) => p.examIds)),
    ],
    locked: [...new Set(packs.flatMap((p) => p.examIds))],
  };
}
