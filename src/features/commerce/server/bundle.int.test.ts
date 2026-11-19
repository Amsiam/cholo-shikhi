// [LT] US8.5 Buy a bundle: the bundle page shows each course's standalone price, the bundle price
// and the saving (AC8.5.1); paying creates one payment, one enrolment (own access clock) and one
// ledger sale per course, the parts adding up to the bundle price exactly (AC8.5.2); a course of
// the bundle can be refunded alone; the academic one-course rule applies (AC8.5.3): an academic
// bundle that would leave the Student with more than one active course is refused. Settling twice
// is idempotent, a declined payment grants nothing, owners, strangers and visitors are refused. An
// unpaid bundle checkout expires like a single-course one, and paying it afterwards is refused.
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import {
  bundle,
  bundleOrder,
  enrolment,
  ledgerTransaction,
  payment,
} from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { createBundleOrderRepository } from '../data/bundle.repository.ts';
import {
  type BundleOffer,
  type BundleOrderView,
  expireAbandonedBundleOrders,
} from './bundle.server.ts';

let s: ServerFnHarness;
let jobGoalId: string;
let academicGoalId: string;
let jobBundleId: string;
let academicBundleId: string;
let academicExtra: PublishedCourse;
let academicPair: [PublishedCourse, PublishedCourse];
let cheap: PublishedCourse;
let dear: PublishedCourse;

async function segmentWithGoal(segmentType: 'academic' | 'job_aspirant') {
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput({ segmentType })),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  return { segmentId, goalId };
}

beforeAll(async () => {
  s = await createServerFnHarness();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
    ['commerce.refund.windowDays', 7],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const job = await segmentWithGoal('job_aspirant');
  const academic = await segmentWithGoal('academic');
  jobGoalId = job.goalId;
  academicGoalId = academic.goalId;
  cheap = await p.published(job.goalId, { sections: 2, price: '১০০০', months: 6 });
  dear = await p.published(job.goalId, { sections: 1, price: '২০০০', months: 12 });
  jobBundleId = value<{ bundleId: string }>(
    await s.call('createBundle', s.admin.request, {
      nameBn: 'বিসিএস সম্পূর্ণ',
      nameEn: 'BCS complete',
      segmentId: job.segmentId,
      pricePoisha: 250_000,
      courseIds: [cheap.courseId, dear.courseId],
    }),
  ).bundleId;
  const [a1, a2] = [
    await p.published(academic.goalId, { sections: 1 }),
    await p.published(academic.goalId, { sections: 1 }),
  ];
  academicExtra = await p.published(academic.goalId, { sections: 1 });
  academicPair = [a1 as PublishedCourse, a2 as PublishedCourse];
  const academicInput = {
    nameBn: 'এইচএসসি জোড়া',
    nameEn: 'HSC pair',
    segmentId: academic.segmentId,
    pricePoisha: 200_000,
    courseIds: academicPair.map((c) => c.courseId),
  };
  // A9 refuses an academic bundle of several courses (US2.16)...
  expect(await s.call('createBundle', s.admin.request, academicInput)).toMatchObject({
    ok: false,
    error: { i18nKey: 'errors.marketing.academicBundle' },
  });
  // ...so this one stands for a bundle saved before that rule.
  const [legacy] = await getDb()
    .insert(bundle)
    .values({ ...academicInput, createdBy: s.admin.userId })
    .returning();
  academicBundleId = (legacy as { bundleId: string }).bundleId;
}, 300_000);
afterAll(async () => {
  await s?.close();
});

async function studentOf(goalId: string) {
  const st = await s.newStudent();
  value(await s.call('chooseGoal', st.request, { goalId }));
  return st;
}

describe('buying a bundle (US8.5)', () => {
  it('AC8.5.1: shows each course alone, the bundle price and the saving, to visitors too', async () => {
    const offer = value<BundleOffer>(
      await s.call('getBundleOffer', s.anonymous(), { bundleId: jobBundleId }),
    );
    expect(offer.courses.map((c) => [c.courseId, c.listPricePoisha])).toEqual([
      [cheap.courseId, 100_000],
      [dear.courseId, 200_000],
    ]);
    expect(offer).toMatchObject({
      pricePoisha: 250_000,
      standaloneTotalPoisha: 300_000,
      savingPoisha: 50_000,
    });
    // 250000 in proportion 1:2 is 83333.33 and 166666.67; the leftover poisha goes to the larger
    // remainder.
    expect(offer.courses.map((c) => c.allocatedPoisha)).toEqual([83_333, 166_667]);
    expect(
      await s.call('getBundleOffer', s.anonymous(), {
        bundleId: '00000000-0000-4000-8000-0000000000aa',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.commerce.bundleUnavailable' } });
  });

  it('AC8.5.2: one enrolment per course with its own clock, and one ledger sale per course', async () => {
    const st = await studentOf(jobGoalId);
    expect((await s.call('startBundleOrder', s.anonymous(), { bundleId: jobBundleId })).ok).toBe(
      false,
    );
    const order = value<BundleOrderView>(
      await s.call('startBundleOrder', st.request, { bundleId: jobBundleId }),
    );
    expect(order.status).toBe('pending');
    // A stranger cannot see or settle it.
    const stranger = await s.newStudent();
    expect(
      (await s.call('getMyBundleOrder', stranger.request, { orderId: order.orderId })).ok,
    ).toBe(false);
    expect(
      (
        await s.call('settleMyFakeBundleOrder', stranger.request, {
          orderId: order.orderId,
          outcome: 'succeed',
        })
      ).ok,
    ).toBe(false);

    const paid = value<BundleOrderView>(
      await s.call('settleMyFakeBundleOrder', st.request, {
        orderId: order.orderId,
        outcome: 'succeed',
      }),
    );
    expect(paid.status).toBe('succeeded');
    const payments = await getDb()
      .select()
      .from(payment)
      .where(eq(payment.bundleOrderId, order.orderId));
    expect(payments.map((x) => [x.courseId, x.amountPoisha, x.status]).sort()).toEqual(
      [
        [cheap.courseId, 83_333, 'succeeded'],
        [dear.courseId, 166_667, 'succeeded'],
      ].sort(),
    );
    const enrolments = await getDb()
      .select()
      .from(enrolment)
      .where(
        inArray(
          enrolment.paymentId,
          payments.map((x) => x.paymentId),
        ),
      );
    expect(enrolments).toHaveLength(2);
    const ends = Object.fromEntries(enrolments.map((e) => [e.courseId, e.endsAt.getTime()]));
    // 6 months versus 12 months: each course keeps its own access period.
    expect((ends[dear.courseId] as number) - (ends[cheap.courseId] as number)).toBeGreaterThan(
      150 * 24 * 60 * 60 * 1000,
    );
    const sales = await getDb()
      .select()
      .from(ledgerTransaction)
      .where(
        inArray(
          ledgerTransaction.sourcePaymentId,
          payments.map((x) => x.paymentId),
        ),
      );
    expect(sales.map((x) => x.kind)).toEqual(['course_sale', 'course_sale']);
    expect(sales.reduce((sum, x) => sum + Number(x.amountPoisha), 0)).toBe(250_000);

    // Settling again changes nothing; declining a paid order is refused; buying again is refused.
    expect(
      value<BundleOrderView>(
        await s.call('settleMyFakeBundleOrder', st.request, {
          orderId: order.orderId,
          outcome: 'succeed',
        }),
      ).items.every((i) => i.accessEndsAt !== null),
    ).toBe(true);
    expect(
      await s.call('settleMyFakeBundleOrder', st.request, {
        orderId: order.orderId,
        outcome: 'fail',
      }),
    ).toMatchObject({ ok: false, error: { code: 'PAYMENT_SETTLED' } });
    expect(await s.call('startBundleOrder', st.request, { bundleId: jobBundleId })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.commerce.bundleOwned' },
    });

    // One course of the bundle is refunded alone, for its part of the price.
    const cheapPayment = payments.find((x) => x.courseId === cheap.courseId);
    const { refundId } = value<{ refundId: string }>(
      await s.call('requestMyRefund', st.request, {
        paymentId: cheapPayment?.paymentId,
        reason: 'I only wanted the second course.',
      }),
    );
    value(
      await s.call('decideRefundRequest', s.admin.request, {
        refundId,
        decision: 'approve',
        policy: 'full',
      }),
    );
    const after = await getDb()
      .select()
      .from(enrolment)
      .where(
        inArray(
          enrolment.paymentId,
          payments.map((x) => x.paymentId),
        ),
      );
    expect(Object.fromEntries(after.map((e) => [e.courseId, e.status]))).toEqual({
      [cheap.courseId]: 'revoked',
      [dear.courseId]: 'active',
    });
    const kinds = (
      await getDb()
        .select()
        .from(ledgerTransaction)
        .where(eq(ledgerTransaction.sourcePaymentId, cheapPayment?.paymentId as string))
    ).map((x) => [x.kind, Number(x.amountPoisha)]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['course_sale', 83_333],
        ['course_refund', 83_333],
      ]),
    );
  });

  it('a declined bundle payment grants nothing', async () => {
    const st = await studentOf(jobGoalId);
    const order = value<BundleOrderView>(
      await s.call('startBundleOrder', st.request, { bundleId: jobBundleId }),
    );
    expect(
      value<BundleOrderView>(
        await s.call('settleMyFakeBundleOrder', st.request, {
          orderId: order.orderId,
          outcome: 'fail',
        }),
      ).status,
    ).toBe('failed');
    expect(
      await getDb().select().from(payment).where(eq(payment.bundleOrderId, order.orderId)),
    ).toEqual([]);
    expect(await getDb().select().from(enrolment).where(eq(enrolment.userId, st.userId))).toEqual(
      [],
    );
  });

  it('AC8.5.3: an academic student with an active paid course is refused', async () => {
    const busy = await studentOf(academicGoalId);
    const c = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', busy.request, { courseId: academicExtra.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', busy.request, {
        paymentId: c.paymentId,
        outcome: 'succeed',
      }),
    );
    expect(
      await s.call('startBundleOrder', busy.request, { bundleId: academicBundleId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ACADEMIC_ACTIVE_COURSE', i18nKey: 'errors.commerce.academic_active_course' },
    });
  });

  it('AC8.5.3: an academic bundle that would leave several active courses is refused', async () => {
    // A Student with no active course: the two courses alone would be two active academic courses.
    const fresh = await studentOf(academicGoalId);
    expect(
      await s.call('startBundleOrder', fresh.request, { bundleId: academicBundleId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ACADEMIC_ACTIVE_COURSE', i18nKey: 'errors.commerce.academicBundleSeveral' },
    });
    // Checked again at payment: an order opened before the rule (written directly) is refused too,
    // and nothing is granted.
    const order = await createBundleOrderRepository().insertOrder(
      getDb(),
      {
        userId: fresh.userId,
        bundleId: academicBundleId,
        nameBn: 'এইচএসসি জোড়া',
        nameEn: 'HSC pair',
        amountPoisha: 200_000,
      },
      academicPair.map((c, position) => ({
        position,
        courseId: c.courseId,
        listPricePoisha: 100_000,
        allocatedPoisha: 100_000,
        accessDurationMonths: 6,
      })),
    );
    expect(
      await s.call('settleMyFakeBundleOrder', fresh.request, {
        orderId: order.orderId,
        outcome: 'succeed',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ACADEMIC_ACTIVE_COURSE', i18nKey: 'errors.commerce.academicBundleSeveral' },
    });
    expect(
      await getDb().select().from(payment).where(eq(payment.bundleOrderId, order.orderId)),
    ).toEqual([]);
    expect(
      await getDb().select().from(enrolment).where(eq(enrolment.userId, fresh.userId)),
    ).toEqual([]);
    // A course bought while the order was open is refused the same way at payment.
    const other = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', fresh.request, { courseId: academicExtra.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', fresh.request, {
        paymentId: other.paymentId,
        outcome: 'succeed',
      }),
    );
    expect(
      await s.call('settleMyFakeBundleOrder', fresh.request, {
        orderId: order.orderId,
        outcome: 'succeed',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ACADEMIC_ACTIVE_COURSE', i18nKey: 'errors.commerce.academic_active_course' },
    });
  });
});

describe('abandoned bundle checkouts expire', () => {
  const age = (orderIds: string[]) =>
    getDb()
      .update(bundleOrder)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(inArray(bundleOrder.orderId, orderIds));
  const statusOf = async (orderId: string) =>
    (await getDb().select().from(bundleOrder).where(eq(bundleOrder.orderId, orderId)))[0];

  it('expires unpaid bundle orders older than the expiry, once, never a paid one', async () => {
    const [a, b] = [await studentOf(jobGoalId), await studentOf(jobGoalId)];
    const abandoned = value<BundleOrderView>(
      await s.call('startBundleOrder', a.request, { bundleId: jobBundleId }),
    );
    const paid = value<BundleOrderView>(
      await s.call('startBundleOrder', b.request, { bundleId: jobBundleId }),
    );
    value(
      await s.call('settleMyFakeBundleOrder', b.request, {
        orderId: paid.orderId,
        outcome: 'succeed',
      }),
    );
    await age([abandoned.orderId, paid.orderId]);
    // Not old enough for a three-hour expiry.
    expect(await expireAbandonedBundleOrders(new Date(), 180)).toBe(0);
    // Two runs at the same moment expire it exactly once (SKIP LOCKED + the pending guard).
    const runs = await Promise.all([
      expireAbandonedBundleOrders(new Date(), 60),
      expireAbandonedBundleOrders(new Date(), 60),
    ]);
    expect(runs.reduce((x, y) => x + y, 0)).toBe(1);
    expect(await expireAbandonedBundleOrders(new Date(), 60)).toBe(0);
    expect(await statusOf(abandoned.orderId)).toMatchObject({
      status: 'failed',
      gatewayRef: 'expired',
    });
    expect((await statusOf(paid.orderId))?.status).toBe('succeeded');
    // Paying the expired order late is refused and grants nothing.
    expect(
      await s.call('settleMyFakeBundleOrder', a.request, {
        orderId: abandoned.orderId,
        outcome: 'succeed',
      }),
    ).toMatchObject({ ok: false, error: { code: 'PAYMENT_SETTLED' } });
    expect(
      await getDb().select().from(payment).where(eq(payment.bundleOrderId, abandoned.orderId)),
    ).toEqual([]);
    expect(await getDb().select().from(enrolment).where(eq(enrolment.userId, a.userId))).toEqual(
      [],
    );
  });

  it('an expiry racing a payment leaves exactly one outcome', async () => {
    const st = await studentOf(jobGoalId);
    const order = value<BundleOrderView>(
      await s.call('startBundleOrder', st.request, { bundleId: jobBundleId }),
    );
    await age([order.orderId]);
    const [settled] = await Promise.all([
      s.call('settleMyFakeBundleOrder', st.request, { orderId: order.orderId, outcome: 'succeed' }),
      expireAbandonedBundleOrders(new Date(), 60),
    ]);
    const row = await statusOf(order.orderId);
    const payments = await getDb()
      .select()
      .from(payment)
      .where(eq(payment.bundleOrderId, order.orderId));
    if (row?.status === 'succeeded') {
      expect((settled as { ok: boolean }).ok).toBe(true);
      expect(payments).toHaveLength(2);
    } else {
      expect(row).toMatchObject({ status: 'failed', gatewayRef: 'expired' });
      expect((settled as { ok: boolean }).ok).toBe(false);
      expect(payments).toEqual([]);
    }
  });
});
