// [LT] Purchase through the fake gateway, enrolment-gated learning, and object-level ownership:
// a Student only reads and settles their own payments, and without an active enrolment every
// course and lesson read answers NOT_FOUND, like a missing course.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

type Checkout = {
  paymentId: string;
  courseId: string;
  amountPoisha: number;
  accessDurationMonths: number;
  status: 'pending' | 'succeeded' | 'failed';
  enrolmentId: string | null;
};

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let course: PublishedCourse;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  }
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  course = await p.published(goalId, { sections: 2, months: 6 });
}, 120_000);
afterAll(async () => {
  await s?.close();
});

const flag = (state: 'on') =>
  s.call('saveFlag', s.admin.request, {
    flagKey: 'commerce.fakeGateway',
    description: 'LT: fake gateway',
    state,
  });

describe('the fake gateway is off unless allowed', () => {
  it('refuses checkout outside development while the flag is off', async () => {
    // No flag row yet: an unknown flag evaluates off (U1 BR8.2), and NODE_ENV is test.
    const student = await s.newStudent();
    expect(
      await s.call('startCourseCheckout', student.request, { courseId: course.courseId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' },
    });
  });
});

describe('purchase, enrolment and learning access', () => {
  let buyer: Awaited<ReturnType<ServerFnHarness['newStudent']>>;
  let other: Awaited<ReturnType<ServerFnHarness['newStudent']>>;
  let checkout: Checkout;

  beforeAll(async () => {
    value(await flag('on'));
    buyer = await s.newStudent();
    other = await s.newStudent();
  });

  it('without an enrolment every learning read and write answers NOT_FOUND', async () => {
    const lessonId = course.lessonIds[0] as string;
    const ref = { courseId: course.courseId, lessonId };
    for (const [name, data] of [
      ['getMyLearningCourse', { courseId: course.courseId }],
      ['getMyLesson', ref],
      ['completeMyLesson', ref],
      ['submitMyQuiz', { ...ref, answers: [] }],
    ] as const) {
      expect(await s.call(name, buyer.request, data)).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(
      value<{ isEnrolled: boolean }>(
        await s.call('getMyEnrolmentStatus', buyer.request, { courseId: course.courseId }),
      ).isEnrolled,
    ).toBe(false);
  });

  it('checkout opens a pending payment at the published price and duration', async () => {
    checkout = value<Checkout>(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    );
    expect(checkout.status).toBe('pending');
    expect(checkout.amountPoisha).toBeGreaterThan(0);
    expect(checkout.accessDurationMonths).toBe(6);
    expect(checkout.enrolmentId).toBeNull();
  });

  it('another Student can neither see nor settle the payment', async () => {
    expect(
      await s.call('getMyCheckout', other.request, { paymentId: checkout.paymentId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await s.call('settleMyFakePayment', other.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('a succeeded payment creates exactly one enrolment, and repeating it changes nothing', async () => {
    const first = value<Checkout>(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
    expect(first.status).toBe('succeeded');
    expect(first.enrolmentId).not.toBeNull();
    const again = value<Checkout>(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
    expect(again.enrolmentId).toBe(first.enrolmentId);
  });

  it('a settled payment never flips to the other outcome', async () => {
    expect(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: checkout.paymentId,
        outcome: 'fail',
      }),
    ).toMatchObject({ ok: false, error: { code: 'PAYMENT_SETTLED' } });
  });

  it('a second checkout for an owned course is refused', async () => {
    expect(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_ENROLLED' },
    });
  });

  it('the enrolled Student sees the course, completes a lesson and gains progress', async () => {
    const mine = value<Array<{ courseId: string }>>(
      await s.call('listMyLearningCourses', buyer.request, {}),
    );
    expect(mine.map((c) => c.courseId)).toContain(course.courseId);
    const lessonId = course.lessonIds[0] as string;
    const lesson = value<{ isCompleted: boolean; nextLessonId: string | null }>(
      await s.call('getMyLesson', buyer.request, { courseId: course.courseId, lessonId }),
    );
    expect(lesson.isCompleted).toBe(false);
    value(await s.call('completeMyLesson', buyer.request, { courseId: course.courseId, lessonId }));
    value(await s.call('completeMyLesson', buyer.request, { courseId: course.courseId, lessonId }));
    const home = value<{ progress: { completed: number; total: number } }>(
      await s.call('getMyLearningCourse', buyer.request, { courseId: course.courseId }),
    );
    expect(home.progress.completed).toBe(1);
    expect(home.progress.total).toBe(course.lessonIds.length);
    const summary = value<{ enrolled: number }>(
      await s.call('getMyLearningSummary', buyer.request, {}),
    );
    expect(summary.enrolled).toBe(1);
  });

  it('a reading lesson cannot be submitted as a quiz', async () => {
    expect(
      await s.call('submitMyQuiz', buyer.request, {
        courseId: course.courseId,
        lessonId: course.lessonIds[0] as string,
        answers: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
  });

  it('the other Student still has no access to the course', async () => {
    expect(
      await s.call('getMyLearningCourse', other.request, { courseId: course.courseId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('a declined payment creates no enrolment', async () => {
    const pending = value<Checkout>(
      await s.call('startCourseCheckout', other.request, { courseId: course.courseId }),
    );
    const declined = value<Checkout>(
      await s.call('settleMyFakePayment', other.request, {
        paymentId: pending.paymentId,
        outcome: 'fail',
      }),
    );
    expect(declined.status).toBe('failed');
    expect(declined.enrolmentId).toBeNull();
    expect(
      value<{ isEnrolled: boolean }>(
        await s.call('getMyEnrolmentStatus', other.request, { courseId: course.courseId }),
      ).isEnrolled,
    ).toBe(false);
  });
});

describe('purchase history and receipts', () => {
  it('lists the Student’s own payments with access, and keeps receipts private', async () => {
    // The fake gateway flag is already on from the purchase tests above.
    const buyer = await s.newStudent();
    const failedCheckout = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: failedCheckout.paymentId,
        outcome: 'fail',
      }),
    );
    const paid = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: paid.paymentId,
        outcome: 'succeed',
      }),
    );

    const purchases = value<
      Array<{
        paymentId: string;
        status: string;
        receiptNumber: string;
        access: { isExpired: boolean; isExpiringSoon: boolean } | null;
      }>
    >(await s.call('getMyPurchases', buyer.request, {}));
    expect(purchases.map((p) => p.status)).toEqual(['succeeded', 'failed']);
    expect(purchases[0]?.receiptNumber).toMatch(/^CS-\d{6}-[0-9A-F]{8}$/);
    expect(purchases[0]?.access).toMatchObject({ isExpired: false, isExpiringSoon: false });
    expect(purchases[1]?.access).toBeNull();

    expect(
      value<{ paymentId: string }>(
        await s.call('getMyReceipt', buyer.request, { paymentId: paid.paymentId }),
      ).paymentId,
    ).toBe(paid.paymentId);
    const other = await s.newStudent();
    expect(
      await s.call('getMyReceipt', other.request, { paymentId: paid.paymentId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(value<unknown[]>(await s.call('getMyPurchases', other.request, {}))).toHaveLength(0);
  });
});

describe('renewal (FR-DIST-4)', () => {
  it('refuses a second purchase early, renews in the last 14 days from the end date, and books the sale', async () => {
    const buyer = await s.newStudent();
    const first = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: first.paymentId,
        outcome: 'succeed',
      }),
    );
    // With months of access left, buying again is a duplicate.
    expect(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'ALREADY_ENROLLED' } });
    expect(
      value(await s.call('getMyEnrolmentStatus', buyer.request, { courseId: course.courseId })),
    ).toMatchObject({ isEnrolled: true, canRenew: false });

    // Move the access into its last 14 days.
    const endsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    await s.t.pool.query('UPDATE enrolment SET ends_at = $1 WHERE payment_id = $2', [
      endsAt,
      first.paymentId,
    ]);
    expect(
      value(await s.call('getMyEnrolmentStatus', buyer.request, { courseId: course.courseId })),
    ).toMatchObject({ isEnrolled: true, canRenew: true });

    const renewal = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', buyer.request, {
        paymentId: renewal.paymentId,
        outcome: 'succeed',
      }),
    );
    const { rows } = await s.t.pool.query<{ ends_at: Date; n: string }>(
      `SELECT max(ends_at) AS ends_at, count(*)::text AS n FROM enrolment
        WHERE user_id = $1 AND course_id = $2`,
      [buyer.userId, course.courseId],
    );
    const row = rows[0] as { ends_at: Date; n: string };
    // Still one enrolment, now ending 6 months (the course's duration) after the old end date.
    expect(row.n).toBe('1');
    const expected = new Date(endsAt);
    expected.setUTCMonth(expected.getUTCMonth() + 6);
    expect(Math.abs(row.ends_at.getTime() - expected.getTime())).toBeLessThan(3 * 24 * 3600 * 1000);

    const purchases = value<Array<{ paymentId: string; kind: string; access: { endsAt: string } }>>(
      await s.call('getMyPurchases', buyer.request, {}),
    );
    const renewed = purchases.find((p) => p.paymentId === renewal.paymentId);
    expect(renewed?.kind).toBe('renewal');
    expect(new Date(renewed?.access.endsAt ?? 0).getTime()).toBe(row.ends_at.getTime());
    const { rows: ledger } = await s.t.pool.query(
      'SELECT 1 FROM ledger_transaction WHERE source_payment_id = $1',
      [renewal.paymentId],
    );
    expect(ledger).toHaveLength(1);
  });
});

describe('free trial (FR-DIST-1)', () => {
  let trialCourse: PublishedCourse;
  let otherCourse: PublishedCourse;

  beforeAll(async () => {
    const { segmentId } = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    const { goalId } = value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
    );
    trialCourse = await p.published(goalId, { sections: 7, months: 6 });
    otherCourse = await p.published(goalId, { sections: 2, months: 6 });
  }, 180_000);

  it('opens the first 5 lessons, refuses a second trial, ends after 5 lessons, and buying opens all', async () => {
    // Only an Admin designates the trial course.
    expect(
      await s.call('setSegmentTrialCourse', trialCourse.lead.request, {
        courseId: trialCourse.courseId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    value(
      await s.call('setSegmentTrialCourse', s.admin.request, { courseId: trialCourse.courseId }),
    );

    const student = await s.newStudent();
    expect(
      value(await s.call('getMyTrialStatus', student.request, { courseId: trialCourse.courseId })),
    ).toMatchObject({ isTrialCourse: true, state: 'available' });
    // Not a trial course: nothing to start.
    expect(
      await s.call('startMyTrial', student.request, { courseId: otherCourse.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    // Q15: a trial needs a mobile number on the account, and a number belongs to one account only.
    expect(
      await s.call('startMyTrial', student.request, { courseId: trialCourse.courseId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.commerce.trialNeedsPhone' } });
    expect(
      await s.call('saveMyProfile', student.request, { name: 'Trial Student', phone: '0123' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const phone = `01${7 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    expect(
      value<{ phone: string }>(
        await s.call('saveMyProfile', student.request, { name: 'Trial Student', phone }),
      ).phone,
    ).toBe(`+88${phone}`);
    const twin = await s.newStudent();
    expect(await s.call('saveMyProfile', twin.request, { name: 'Twin', phone })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.profile.phoneTaken' },
    });
    value(await s.call('startMyTrial', student.request, { courseId: trialCourse.courseId }));
    expect(
      await s.call('startMyTrial', student.request, { courseId: trialCourse.courseId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.commerce.trialUsed' },
    });

    const home = value<{
      trial: { lessonLimit: number; isExpired: boolean };
      sections: Array<{ lessons: Array<{ lessonId: string; isLocked: boolean }> }>;
    }>(await s.call('getMyLearningCourse', student.request, { courseId: trialCourse.courseId }));
    expect(home.trial).toMatchObject({ lessonLimit: 5, isExpired: false });
    const lessons = home.sections.flatMap((x) => x.lessons);
    expect(lessons.map((l) => l.isLocked)).toEqual([false, false, false, false, false, true, true]);

    const ref = (i: number) => ({
      courseId: trialCourse.courseId,
      lessonId: lessons[i]?.lessonId as string,
    });
    expect(await s.call('getMyLesson', student.request, ref(5))).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.learning.trialLocked' },
    });
    expect(await s.call('completeMyLesson', student.request, ref(6))).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.learning.trialLocked' },
    });
    for (let i = 0; i < 5; i += 1) value(await s.call('completeMyLesson', student.request, ref(i)));

    // All five open lessons done: the trial has run out and the content locks.
    expect(
      value<{ trial: { isExpired: boolean } }>(
        await s.call('getMyLearningCourse', student.request, { courseId: trialCourse.courseId }),
      ).trial.isExpired,
    ).toBe(true);
    expect(await s.call('getMyLesson', student.request, ref(0))).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.learning.trialLocked' },
    });
    const listed = value<Array<{ courseId: string; trial: { isExpired: boolean } | null }>>(
      await s.call('listMyLearningCourses', student.request, {}),
    );
    expect(listed.find((c) => c.courseId === trialCourse.courseId)?.trial?.isExpired).toBe(true);

    // Buying the course opens everything.
    const paid = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', student.request, { courseId: trialCourse.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', student.request, {
        paymentId: paid.paymentId,
        outcome: 'succeed',
      }),
    );
    expect((await s.call('getMyLesson', student.request, ref(6))).ok).toBe(true);
    expect(
      value<{ trial: unknown }>(
        await s.call('getMyLearningCourse', student.request, { courseId: trialCourse.courseId }),
      ).trial,
    ).toBeNull();

    // Moving the segment's trial to another course does not give a second trial.
    value(
      await s.call('setSegmentTrialCourse', s.admin.request, { courseId: otherCourse.courseId }),
    );
    expect(
      value(await s.call('getMyTrialStatus', student.request, { courseId: otherCourse.courseId })),
    ).toMatchObject({ isTrialCourse: true, state: 'usedElsewhere' });
  });
});

describe('per-segment trial caps (US2.23)', () => {
  it('new trials use the changed caps, running trials keep theirs, and a cap of 0 is refused', async () => {
    const { segmentId } = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    const { goalId } = value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
    );
    const course = await p.published(goalId, { sections: 6, months: 6 });
    value(await s.call('setSegmentTrialCourse', s.admin.request, { courseId: course.courseId }));
    // AC2.23.2: a course that is not published cannot be the trial course.
    expect(
      (
        await s.call('setSegmentTrialCourse', s.admin.request, {
          courseId: '00000000-0000-4000-8000-00000000abcd',
        })
      ).ok,
    ).toBe(false);

    const withPhone = async () => {
      const st = await s.newStudent();
      const phone = `01${7 + Math.floor(Math.random() * 3)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      value(await s.call('saveMyProfile', st.request, { name: 'Cap Student', phone }));
      value(await s.call('startMyTrial', st.request, { courseId: course.courseId }));
      return st;
    };
    const limitOf = async (st: Awaited<ReturnType<typeof withPhone>>) =>
      value<{ trial: { lessonLimit: number } }>(
        await s.call('getMyLearningCourse', st.request, { courseId: course.courseId }),
      ).trial.lessonLimit;

    const early = await withPhone();
    expect(await limitOf(early)).toBe(5);

    expect(
      (
        await s.call('saveSetting', s.admin.request, {
          settingKey: 'commerce.trial.lessons',
          scopeKey: segmentId,
          value: 0,
          reason: 'LT cap of zero',
        })
      ).ok,
    ).toBe(false);
    for (const [settingKey, v] of [
      ['commerce.trial.days', 14],
      ['commerce.trial.lessons', 3],
    ] as const)
      value(
        await s.call('saveSetting', s.admin.request, {
          settingKey,
          scopeKey: segmentId,
          value: v,
          reason: 'LT tune conversion',
        }),
      );

    const late = await withPhone();
    expect(await limitOf(late)).toBe(3);
    expect(await limitOf(early)).toBe(5);
    const status = value<{ endsAt: string }>(
      await s.call('getMyTrialStatus', late.request, { courseId: course.courseId }),
    );
    const days = (new Date(status.endsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const offers = value<Array<{ segmentId: string; days: number; lessons: number }>>(
      await s.call('listTrialCourseOffers', s.admin.request, {}),
    );
    expect(offers.find((o) => o.segmentId === segmentId)).toMatchObject({ days: 14, lessons: 3 });
  }, 120_000);
});
