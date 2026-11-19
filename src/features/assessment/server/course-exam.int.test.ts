// [LT] Course exams: an Instructor attaches their own exam to a course they teach; it leaves the
// goal-wide list and only Students enrolled in that course can take it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let goalId: string;
let topicId: string;
let course: PublishedCourse;

beforeAll(async () => {
  s = await createServerFnHarness();
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
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
  ).goalId;
  course = await createPublishHelper(s).published(goalId, { sections: 1, months: 6 });
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'ক',
      nameEn: 'K',
      goalIds: [goalId],
    }),
  );
  topicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, { subjectId, nameBn: 'খ', nameEn: 'T' }),
  ).topicId;
  for (let i = 0; i < 3; i += 1)
    value(
      await s.call('saveBankQuestionDraft', s.admin.request, {
        topicId,
        difficulty: 'easy',
        promptBn: `প্রশ্ন ${i}`,
        promptEn: `Q ${i}`,
        optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
        optionsEn: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
      }),
    );
}, 180_000);
afterAll(async () => {
  await s?.close();
});

type Detail = {
  exam: { examId: string; version: number; courseId: string | null };
  courseOptions: Array<{ courseId: string }>;
};

describe('course exams', () => {
  it('only the course’s Students can see and take an attached exam', async () => {
    const lead = course.lead;
    let d = value<Detail>(
      await s.call('saveExamDraft', lead.request, {
        kind: 'mock',
        titleBn: 'কোর্স টেস্ট',
        titleEn: 'Course test',
        goalId,
        durationMinutes: 10,
        negativeBps: 0,
        blueprint: [{ topicId, difficulty: null, count: 3 }],
      }),
    );
    expect(d.courseOptions.map((c) => c.courseId)).toContain(course.courseId);
    // Another Instructor's course is refused.
    const outsider = await s.newInstructor();
    const theirs = value<Detail>(
      await s.call('saveExamDraft', outsider.request, {
        kind: 'mock',
        titleBn: 'অন্য',
        titleEn: 'Other',
        goalId,
        durationMinutes: 10,
        negativeBps: 0,
        blueprint: [{ topicId, difficulty: null, count: 3 }],
      }),
    );
    expect(
      await s.call('attachExamToMyCourse', outsider.request, {
        examId: theirs.exam.examId,
        expectedVersion: theirs.exam.version,
        courseId: course.courseId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    d = value<Detail>(
      await s.call('attachExamToMyCourse', lead.request, {
        examId: d.exam.examId,
        expectedVersion: d.exam.version,
        courseId: course.courseId,
      }),
    );
    expect(d.exam.courseId).toBe(course.courseId);
    d = value<Detail>(
      await s.call('drawExamQuestionSet', lead.request, {
        examId: d.exam.examId,
        expectedVersion: d.exam.version,
      }),
    );
    value(
      await s.call('publishExamForStudents', lead.request, {
        examId: d.exam.examId,
        expectedVersion: d.exam.version,
      }),
    );

    // A Student of the goal who has not bought the course sees nothing and cannot start it.
    const browser = await s.newStudent();
    value(await s.call('chooseGoal', browser.request, { goalId }));
    const list = value<{ exams: Array<{ examId: string }> }>(
      await s.call('getMyExams', browser.request, {}),
    );
    expect(list.exams.map((e) => e.examId)).not.toContain(d.exam.examId);
    expect(await s.call('startMyExam', browser.request, { examId: d.exam.examId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    // After buying the course, it is there.
    const checkout = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', browser.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', browser.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
    const after = value<{ exams: Array<{ examId: string; courseId: string | null }> }>(
      await s.call('getMyExams', browser.request, {}),
    );
    expect(after.exams.find((e) => e.examId === d.exam.examId)?.courseId).toBe(course.courseId);
    expect(
      value<{ questions: unknown[] }>(
        await s.call('startMyExam', browser.request, { examId: d.exam.examId }),
      ).questions,
    ).toHaveLength(3);
  });
});
