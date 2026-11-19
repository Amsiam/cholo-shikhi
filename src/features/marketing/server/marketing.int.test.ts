// [LT] US8.1, US8.2, US8.4 with the US8.3 checkout: an Admin creates a campaign for a segment (shown
// on S2 to that segment only), a 2000 bp promo code that discounts a course checkout (the payment,
// the logged use and the ledger sale all carry the discounted price), and a bundle; refused inputs,
// out-of-scope and used-up codes, and non-Admins are refused.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import {
  auditLogEntry,
  ledgerTransaction,
  payment,
  promoCode,
  promoRedemption,
} from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { expireAbandonedCheckouts } from '../../commerce/server/commerce.server.ts';
import { dhakaToday } from '../domain/campaign.ts';
import { myCampaignBanners } from './marketing.server.ts';

let s: ServerFnHarness;
let bcs: { segmentId: string; goalId: string };
let hsc: { segmentId: string; goalId: string };
let courses: PublishedCourse[];
let hscCourse: PublishedCourse;
const today = dhakaToday(new Date().toISOString());
const shift = (days: number) =>
  dhakaToday(new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString());

async function segmentWithGoal(segmentType?: 'academic' | 'job_aspirant') {
  const { segmentId } = value<{ segmentId: string }>(
    await s.call(
      'saveSegment',
      s.admin.request,
      buildSegmentInput(segmentType ? { segmentType } : {}),
    ),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  return { segmentId, goalId };
}

async function studentOf(goalId: string) {
  const st = await s.newStudent();
  value(await s.call('chooseGoal', st.request, { goalId }));
  return st;
}

beforeAll(async () => {
  s = await createServerFnHarness();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
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
  bcs = await segmentWithGoal('job_aspirant');
  hsc = await segmentWithGoal();
  courses = [];
  for (let i = 0; i < 3; i += 1) courses.push(await p.published(bcs.goalId, { sections: 1 }));
  hscCourse = await p.published(hsc.goalId, { sections: 1 });
}, 240_000);
afterAll(async () => {
  await s?.close();
});

describe('campaigns (US8.1)', () => {
  it('shows the banner to the segment on its dates only, and refuses an end before the start', async () => {
    const input = {
      nameBn: 'বিসিএস প্রস্তুতি সপ্তাহ',
      nameEn: 'BCS prep week',
      bannerBn: 'বিসিএস কোর্সে বিশেষ ছাড়',
      bannerEn: 'Special offer on BCS courses',
      landingPath: `/catalog?goal=${bcs.goalId}`,
      segmentIds: [bcs.segmentId],
      startsOn: shift(-1),
      endsOn: shift(5),
    };
    expect(
      await s.call('createCampaign', s.admin.request, { ...input, endsOn: shift(-2) }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.marketing.dates' } });
    const { campaignId } = value<{ campaignId: string }>(
      await s.call('createCampaign', s.admin.request, input),
    );

    const bcsStudent = await studentOf(bcs.goalId);
    const banners = value<Array<{ campaignId: string; bannerEn: string; landingPath: string }>>(
      await s.call('listMyCampaignBanners', bcsStudent.request, {}),
    );
    expect(banners.map((b) => b.campaignId)).toContain(campaignId);

    const hscStudent = await studentOf(hsc.goalId);
    const none = value<Array<{ campaignId: string }>>(
      await s.call('listMyCampaignBanners', hscStudent.request, {}),
    );
    expect(none.map((b) => b.campaignId)).not.toContain(campaignId);

    // The day after the end date (Asia/Dhaka), nothing is shown.
    const after = await myCampaignBanners(
      { userId: bcsStudent.userId, roles: ['student'], locale: 'en', hasStepUp: false },
      new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    );
    expect(after.ok && after.value.map((b) => b.campaignId)).not.toContain(campaignId);
  });
});

describe('promo codes (US8.2, US8.3)', () => {
  const promo = (overrides: Record<string, unknown> = {}) => ({
    code: `BCS${Math.floor(Math.random() * 1e6)}`,
    kind: 'percent',
    percentBps: 2000,
    segmentIds: [bcs.segmentId],
    startsOn: today,
    endsOn: shift(27),
    maxUses: 500,
    ...overrides,
  });

  it('refuses a percent above 10000 bp, a fractional fixed amount and a duplicate code', async () => {
    expect(
      await s.call('createPromoCode', s.admin.request, promo({ percentBps: 10_001 })),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.percent' } });
    expect(
      await s.call(
        'createPromoCode',
        s.admin.request,
        promo({ kind: 'fixed', percentBps: undefined, fixedPoisha: 150.5 }),
      ),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.fixed' } });
    const input = promo();
    value(await s.call('createPromoCode', s.admin.request, input));
    expect(
      await s.call('createPromoCode', s.admin.request, {
        ...input,
        code: input.code.toLowerCase(),
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.duplicate' } });
  });

  it('discounts the checkout: payment, logged use and ledger sale all carry the discounted price', async () => {
    const input = promo();
    const { promoCodeId } = value<{ promoCodeId: string }>(
      await s.call('createPromoCode', s.admin.request, input),
    );
    const course = courses[0] as PublishedCourse;
    const st = await studentOf(bcs.goalId);
    const plain = value<{ amountPoisha: number }>(
      await s.call('startCourseCheckout', st.request, { courseId: course.courseId }),
    );
    const list = plain.amountPoisha;
    const off = Math.floor((list * 2000) / 10_000);
    const c = value<{ paymentId: string; amountPoisha: number; discountPoisha: number }>(
      await s.call('startCourseCheckout', st.request, {
        courseId: course.courseId,
        promoCode: input.code.toLowerCase(),
      }),
    );
    expect(c).toMatchObject({ amountPoisha: list - off, discountPoisha: off });
    const [use] = await getDb()
      .select()
      .from(promoRedemption)
      .where(eq(promoRedemption.paymentId, c.paymentId));
    expect(use).toMatchObject({ promoCodeId, discountPoisha: off, listPricePoisha: list });

    value(
      await s.call('settleMyFakePayment', st.request, {
        paymentId: c.paymentId,
        outcome: 'succeed',
      }),
    );
    const [sale] = await getDb()
      .select()
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.sourcePaymentId, c.paymentId));
    expect(sale).toMatchObject({ kind: 'course_sale', amountPoisha: list - off });
  });

  it('names the reason for an out-of-scope, unknown or used-up code, and opens no payment', async () => {
    const st = await studentOf(hsc.goalId);
    const input = promo({ maxUses: 1 });
    value(await s.call('createPromoCode', s.admin.request, input));
    expect(
      await s.call('startCourseCheckout', st.request, {
        courseId: hscCourse.courseId,
        promoCode: input.code,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.outOfScope' } });
    expect(
      await s.call('startCourseCheckout', st.request, {
        courseId: hscCourse.courseId,
        promoCode: 'NOSUCHCODE',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.notFound' } });
    expect(await getDb().select().from(payment).where(eq(payment.userId, st.userId))).toHaveLength(
      0,
    );

    // One use left, two buyers at the same moment: only one gets the discount (AC8.3.5).
    const [a, b] = [await studentOf(bcs.goalId), await studentOf(bcs.goalId)];
    const course = courses[1] as PublishedCourse;
    const results = await Promise.all(
      [a, b].map((x) =>
        s.call('startCourseCheckout', x.request, {
          courseId: course.courseId,
          promoCode: input.code,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { i18nKey: 'errors.promo.usedUp' },
    });

    // A failed payment gives the use back.
    const winner = results.find((r) => r.ok) as { value: { paymentId: string } };
    const payer = results[0]?.ok ? a : b;
    value(
      await s.call('settleMyFakePayment', payer.request, {
        paymentId: winner.value.paymentId,
        outcome: 'fail',
      }),
    );
    const [row] = await getDb().select().from(promoCode).where(eq(promoCode.code, input.code));
    expect(row?.usedCount).toBe(0);
  });
});

describe('abandoned checkouts give their promo use back', () => {
  it('expires unpaid checkouts older than the Admin-set time, once, and never a paid one', async () => {
    const input = {
      code: `ABN${Math.floor(Math.random() * 1e6)}`,
      kind: 'percent',
      percentBps: 1000,
      segmentIds: [bcs.segmentId],
      startsOn: today,
      endsOn: shift(27),
      maxUses: 2,
    };
    value(await s.call('createPromoCode', s.admin.request, input));
    const course = courses[2] as PublishedCourse;
    const [a, b, c] = [
      await studentOf(bcs.goalId),
      await studentOf(bcs.goalId),
      await studentOf(bcs.goalId),
    ];
    const start = (x: { request: Request }) =>
      s.call('startCourseCheckout', x.request, {
        courseId: course.courseId,
        promoCode: input.code,
      });
    const abandoned = value<{ paymentId: string }>(await start(a));
    const paid = value<{ paymentId: string }>(await start(b));
    expect(await start(c)).toMatchObject({ ok: false, error: { i18nKey: 'errors.promo.usedUp' } });
    value(
      await s.call('settleMyFakePayment', b.request, {
        paymentId: paid.paymentId,
        outcome: 'succeed',
      }),
    );
    // Both are two hours old; only the unpaid one is abandoned.
    await getDb()
      .update(payment)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(sql`${payment.paymentId} in (${abandoned.paymentId}, ${paid.paymentId})`);
    // A fresh checkout is not expired yet.
    expect(await expireAbandonedCheckouts(new Date(), 180)).toBe(0);
    // Two runs at the same moment: the use comes back exactly once.
    const runs = await Promise.all([
      expireAbandonedCheckouts(new Date(), 60),
      expireAbandonedCheckouts(new Date(), 60),
    ]);
    expect(runs.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(1);
    expect(await expireAbandonedCheckouts(new Date(), 60)).toBe(0);
    const [code] = await getDb().select().from(promoCode).where(eq(promoCode.code, input.code));
    expect(code?.usedCount).toBe(1);
    const rows = await getDb()
      .select()
      .from(payment)
      .where(sql`${payment.paymentId} in (${abandoned.paymentId}, ${paid.paymentId})`);
    expect(rows.find((r) => r.paymentId === abandoned.paymentId)).toMatchObject({
      status: 'failed',
      gatewayRef: 'expired',
    });
    expect(rows.find((r) => r.paymentId === paid.paymentId)?.status).toBe('succeeded');
    const [use] = await getDb()
      .select()
      .from(promoRedemption)
      .where(eq(promoRedemption.paymentId, abandoned.paymentId));
    expect(use?.isReleased).toBe(true);
    // Paying the expired checkout late is refused; the freed use goes to the next buyer.
    expect(
      (
        await s.call('settleMyFakePayment', a.request, {
          paymentId: abandoned.paymentId,
          outcome: 'succeed',
        })
      ).ok,
    ).toBe(false);
    value(await start(c));
  });

  it('lets an Admin set the expiry (default 60 minutes) and refuses a Student', async () => {
    const before = value<{ pendingExpiryMinutes: number }>(
      await s.call('listRefundRequests', s.admin.request, { page: 1 }),
    );
    expect(before.pendingExpiryMinutes).toBe(60);
    expect(
      (
        await s.call('saveSetting', s.admin.request, {
          settingKey: 'commerce.checkout.pendingExpiryMinutes',
          value: 5,
          reason: 'Below the 15 minute floor',
        })
      ).ok,
    ).toBe(false);
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey: 'commerce.checkout.pendingExpiryMinutes',
        value: 90,
        reason: 'LT: ninety minutes',
      }),
    );
    const after = value<{ pendingExpiryMinutes: number }>(
      await s.call('listRefundRequests', s.admin.request, { page: 1 }),
    );
    expect(after.pendingExpiryMinutes).toBe(90);
    const st = await s.newStudent();
    expect(
      (
        await s.call('saveSetting', st.request, {
          settingKey: 'commerce.checkout.pendingExpiryMinutes',
          value: 30,
          reason: 'A student trying',
        })
      ).ok,
    ).toBe(false);
  });
});

describe('bundles (US8.4)', () => {
  it('saves three published courses at one price and lists it for the segment', async () => {
    const { bundleId } = value<{ bundleId: string }>(
      await s.call('createBundle', s.admin.request, {
        nameBn: 'বিসিএস সম্পূর্ণ প্রস্তুতি',
        nameEn: 'BCS complete track',
        segmentId: bcs.segmentId,
        pricePoisha: 300_000,
        courseIds: courses.map((c) => c.courseId),
      }),
    );
    const listed = value<Array<{ bundleId: string; pricePoisha: number; courses: unknown[] }>>(
      await s.call('listGoalBundles', s.anonymous(), { goalId: bcs.goalId }),
    );
    expect(listed.find((b) => b.bundleId === bundleId)).toMatchObject({
      pricePoisha: 300_000,
      courses: expect.arrayContaining([
        expect.objectContaining({ courseId: courses[0]?.courseId }),
      ]),
    });
    const elsewhere = value<Array<{ bundleId: string }>>(
      await s.call('listGoalBundles', s.anonymous(), { goalId: hsc.goalId }),
    );
    expect(elsewhere.map((b) => b.bundleId)).not.toContain(bundleId);
    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.subjectId, bundleId));
    expect(audits.map((x) => x.action)).toContain('marketing.bundle.created');
  });

  it('refuses fewer than two courses, and a course of another segment', async () => {
    const base = {
      nameBn: 'ছোট বান্ডেল',
      nameEn: 'Small bundle',
      segmentId: bcs.segmentId,
      pricePoisha: 100_000,
    };
    expect(
      await s.call('createBundle', s.admin.request, {
        ...base,
        courseIds: [courses[0]?.courseId, courses[0]?.courseId],
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.marketing.bundleSize' } });
    expect(
      await s.call('createBundle', s.admin.request, {
        ...base,
        courseIds: [courses[0]?.courseId, hscCourse.courseId],
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.marketing.bundleSegment' } });
  });

  it('refuses an academic-segment bundle of more than one course (US2.16)', async () => {
    const academic = await segmentWithGoal('academic');
    const p = createPublishHelper(s);
    const pair = [
      await p.published(academic.goalId, { sections: 1 }),
      await p.published(academic.goalId, { sections: 1 }),
    ];
    expect(
      await s.call('createBundle', s.admin.request, {
        nameBn: 'এইচএসসি জোড়া',
        nameEn: 'HSC pair',
        segmentId: academic.segmentId,
        pricePoisha: 150_000,
        courseIds: pair.map((c) => c.courseId),
      }),
    ).toMatchObject({
      ok: false,
      error: {
        i18nKey: 'errors.marketing.academicBundle',
        fieldErrors: { courseIds: ['errors.marketing.academicBundle'] },
      },
    });
    const listed = value<Array<{ bundleId: string }>>(
      await s.call('listGoalBundles', s.anonymous(), { goalId: academic.goalId }),
    );
    expect(listed).toEqual([]);
  }, 120_000);

  it('refuses instructors and students on A9', async () => {
    expect((await s.call('getMarketingOverview', s.instructor.request, {})).ok).toBe(false);
    const st = await s.newStudent();
    expect((await s.call('createBundle', st.request, {})).ok).toBe(false);
    expect((await s.call('getMarketingOverview', s.admin.request, {})).ok).toBe(true);
  });
});
