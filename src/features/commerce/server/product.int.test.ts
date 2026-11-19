// [LT] Practice Packs, exam packages and subscriptions: bought through the fake gateway; a pack's
// mock tests open only to its buyers (not even to the course's students); a package becomes a
// timed exam for its buyers; a plan opens its courses and packages for a month and renews from its
// end; a pack's sale is split by the course's owners, a package or plan is platform revenue.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { ledgerTransaction } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

type Caller = Awaited<ReturnType<ServerFnHarness['newStudent']>>;
type Order = {
  orderId: string;
  status: string;
  access: { startsAt: string; endsAt: string } | null;
};
let s: ServerFnHarness;
let goalId: string;
let course: PublishedCourse;
let mockExamId: string;
let packId: string;
let packageId: string;
let planId: string;

const setting = async (settingKey: string, v: number) =>
  value(
    await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
  );

beforeAll(async () => {
  s = await createServerFnHarness();
  await setting('catalog.coursePrice.minPoisha', 10_000);
  await setting('catalog.coursePrice.maxPoisha', 5_000_000);
  await setting('catalog.examPackagePrice.maxPoisha', 500_000);
  await setting('catalog.planMonthlyPrice.maxPoisha', 300_000);
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
  ).goalId;
  course = await createPublishHelper(s).published(goalId, { sections: 1, months: 6 });

  // Bank questions (Admin publishes directly) and a mock test by the course's Lead.
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'ক',
      nameEn: 'S',
      goalIds: [goalId],
    }),
  );
  const { topicId } = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, { subjectId, nameBn: 'খ', nameEn: 'T' }),
  );
  const questionIds: string[] = [];
  for (let i = 0; i < 3; i += 1)
    questionIds.push(
      value<{ questionId: string }>(
        await s.call('saveBankQuestionDraft', s.admin.request, {
          topicId,
          difficulty: 'easy',
          promptBn: `প্রশ্ন ${i}`,
          promptEn: `Q ${i}`,
          optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
          optionsEn: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
        }),
      ).questionId,
    );
  type Detail = { exam: { examId: string; version: number } };
  let d = value<Detail>(
    await s.call('saveExamDraft', course.lead.request, {
      kind: 'mock',
      titleBn: 'প্যাক টেস্ট',
      titleEn: 'Pack test',
      goalId,
      durationMinutes: 10,
      negativeBps: 0,
      blueprint: [{ topicId, difficulty: null, count: 3 }],
    }),
  );
  d = value<Detail>(
    await s.call('drawExamQuestionSet', course.lead.request, {
      examId: d.exam.examId,
      expectedVersion: d.exam.version,
    }),
  );
  value(
    await s.call('publishExamForStudents', course.lead.request, {
      examId: d.exam.examId,
      expectedVersion: d.exam.version,
    }),
  );
  mockExamId = d.exam.examId;

  // A Practice Pack of that mock test (the real Assessment check validates it).
  const pack = value<{ practicePackId: string; version: number }>(
    await s.call('savePracticePack', course.lead.request, {
      courseId: course.courseId,
      titleBn: 'শেষ মুহূর্তের প্যাক',
      titleEn: 'Last-minute pack',
      price: '১৫০',
      questionSetIds: [mockExamId],
    }),
  );
  value(
    await s.call('publishPracticePack', course.lead.request, {
      practicePackId: pack.practicePackId,
      expectedVersion: pack.version,
    }),
  );
  packId = pack.practicePackId;

  const pkg = value<{ examPackageId: string; version: number }>(
    await s.call('saveExamPackage', s.admin.request, {
      goalId,
      titleBn: 'মডেল টেস্ট প্যাকেজ',
      titleEn: 'Model test package',
      price: '২০০',
      questionIds,
      timeLimitMinutes: 15,
    }),
  );
  value(
    await s.call('publishExamPackage', s.admin.request, {
      examPackageId: pkg.examPackageId,
      expectedVersion: pkg.version,
    }),
  );
  packageId = pkg.examPackageId;

  const plan = value<{ planId: string; version: number }>(
    await s.call('savePlan', s.admin.request, {
      goalId,
      nameBn: 'মাসিক প্ল্যান',
      nameEn: 'Monthly plan',
      monthlyPrice: '২৯৯',
      courseIds: [course.courseId],
      examPackageIds: [packageId],
    }),
  );
  value(
    await s.call('publishPlan', s.admin.request, {
      planId: plan.planId,
      expectedVersion: plan.version,
    }),
  );
  planId = plan.planId;
}, 240_000);
afterAll(async () => {
  await s?.close();
});

async function buy(student: Caller, productType: string, productId: string): Promise<Order> {
  const order = value<Order>(
    await s.call('startProductOrder', student.request, { productType, productId }),
  );
  return value<Order>(
    await s.call('settleMyFakeProductOrder', student.request, {
      orderId: order.orderId,
      outcome: 'succeed',
    }),
  );
}
const examIds = async (c: Caller) =>
  value<{ exams: Array<{ examId: string }> }>(await s.call('getMyExams', c.request, {})).exams.map(
    (e) => e.examId,
  );
async function student(): Promise<Caller> {
  const c = await s.newStudent();
  value(await s.call('chooseGoal', c.request, { goalId }));
  return c;
}

describe('Practice Packs', () => {
  it('lock their mock tests to buyers; six months; one purchase; split like a course sale', async () => {
    const browser = await student();
    expect(await examIds(browser)).not.toContain(mockExamId);
    expect(await s.call('startMyExam', browser.request, { examId: mockExamId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const order = await buy(browser, 'practice_pack', packId);
    expect(order.status).toBe('succeeded');
    const months =
      (new Date(order.access?.endsAt as string).getTime() -
        new Date(order.access?.startsAt as string).getTime()) /
      (30 * 86_400_000);
    expect(months).toBeGreaterThan(5.8);
    expect(months).toBeLessThan(6.2);
    expect(await examIds(browser)).toContain(mockExamId);
    expect(
      value<{ questions: unknown[] }>(
        await s.call('startMyExam', browser.request, { examId: mockExamId }),
      ).questions,
    ).toHaveLength(3);
    expect(
      await s.call('startProductOrder', browser.request, {
        productType: 'practice_pack',
        productId: packId,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.commerce.alreadyOwned' } });
    const [tx] = await getDb()
      .select({ kind: ledgerTransaction.kind, courseId: ledgerTransaction.courseId })
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.sourcePaymentId, order.orderId));
    expect(tx).toEqual({ kind: 'course_sale', courseId: course.courseId });
  });
});

describe('exam packages and plans', () => {
  it('a package becomes a timed exam for its buyer; it is platform revenue', async () => {
    const buyer = await student();
    const before = await examIds(buyer);
    const order = await buy(buyer, 'exam_package', packageId);
    const after = await examIds(buyer);
    const added = after.filter((id) => !before.includes(id));
    expect(added).toHaveLength(1);
    const sheet = value<{ questions: unknown[] }>(
      await s.call('startMyExam', buyer.request, { examId: added[0] }),
    );
    expect(sheet.questions).toHaveLength(3);
    // Someone else cannot open it.
    const other = await student();
    expect(await s.call('startMyExam', other.request, { examId: added[0] })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const [tx] = await getDb()
      .select({ kind: ledgerTransaction.kind })
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.sourcePaymentId, order.orderId));
    expect(tx?.kind).toBe('platform_sale');
  });

  it('a plan opens its course and package for a month, and renewing adds the next month', async () => {
    const subscriber = await student();
    expect(
      await s.call('getMyLearningCourse', subscriber.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const first = await buy(subscriber, 'subscription_plan', planId);
    value(await s.call('getMyLearningCourse', subscriber.request, { courseId: course.courseId }));
    const mine = value<Array<{ courseId: string }>>(
      await s.call('listMyLearningCourses', subscriber.request, {}),
    );
    expect(mine.map((c) => c.courseId)).toContain(course.courseId);
    const second = await buy(subscriber, 'subscription_plan', planId);
    expect(second.access?.startsAt).toBe(first.access?.endsAt);
  });
});
