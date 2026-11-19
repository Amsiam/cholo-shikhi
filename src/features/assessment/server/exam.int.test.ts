// [LT] Exams: staff draw questions from the bank by blueprint and publish; Students take mock tests
// (answers save as they go, negative marking, wrong answers reach the Mistake Vault), make their own
// practice exam, and sit a live exam once, whose results and merit list wait for the window to end.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { exam, examAttempt } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let goalId: string;
let topicId: string;
const correctOf = new Map<string, number>();

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
  ).goalId;
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'গণিত',
      nameEn: 'Maths',
      goalIds: [goalId],
    }),
  );
  topicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, {
      subjectId,
      nameBn: 'শতকরা',
      nameEn: 'Percent',
    }),
  ).topicId;
  for (let i = 0; i < 6; i += 1) {
    const q = value<{ questionId: string }>(
      await s.call('saveBankQuestionDraft', s.admin.request, {
        topicId,
        difficulty: 'medium',
        promptBn: `প্রশ্ন ${i}`,
        promptEn: `Question ${i}`,
        optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
        optionsEn: ['A', 'B', 'C', 'D'],
        correctIndex: i % 4,
      }),
    );
    correctOf.set(q.questionId, i % 4);
  }
}, 120_000);
afterAll(async () => {
  await s?.close();
});

type Detail = { exam: { examId: string; version: number; status: string; questionCount: number } };
type Sheet = {
  attemptId: string;
  questions: Array<Record<string, unknown> & { questionId: string }>;
  answers: Record<string, number>;
};

const draft = (over: Record<string, unknown> = {}) => ({
  kind: 'mock',
  titleBn: 'মডেল টেস্ট ১',
  titleEn: 'Model test 1',
  goalId,
  durationMinutes: 30,
  negativeBps: 5000,
  blueprint: [{ topicId, difficulty: null, count: 4 }],
  ...over,
});

async function publish(caller: { request: Request }, over: Record<string, unknown> = {}) {
  let d = value<Detail>(await s.call('saveExamDraft', caller.request, draft(over)));
  expect(
    await s.call('publishExamForStudents', caller.request, {
      examId: d.exam.examId,
      expectedVersion: d.exam.version,
    }),
  ).toMatchObject({ ok: false, error: { i18nKey: 'errors.exam.drawFirst' } });
  d = value<Detail>(
    await s.call('drawExamQuestionSet', caller.request, {
      examId: d.exam.examId,
      expectedVersion: d.exam.version,
    }),
  );
  expect(d.exam.questionCount).toBe(4);
  return value<Detail>(
    await s.call('publishExamForStudents', caller.request, {
      examId: d.exam.examId,
      expectedVersion: d.exam.version,
    }),
  );
}

describe('mock tests', () => {
  it('a blueprint asking for more than the bank holds is refused, row by row', async () => {
    const d = value<Detail>(
      await s.call(
        'saveExamDraft',
        s.instructor.request,
        draft({ blueprint: [{ topicId, difficulty: 'hard', count: 3 }] }),
      ),
    );
    expect(
      await s.call('drawExamQuestionSet', s.instructor.request, {
        examId: d.exam.examId,
        expectedVersion: d.exam.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'blueprint.0': ['errors.exam.notEnough'] } },
    });
    // Another Instructor cannot see it.
    const other = await s.newInstructor();
    expect(await s.call('getExamForStaff', other.request, { examId: d.exam.examId })).toMatchObject(
      {
        ok: false,
        error: { code: 'NOT_FOUND' },
      },
    );
  });

  it('a Student takes it: no answers sent, saves as they go, negative marks, vault', async () => {
    const published = await publish(s.instructor);
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const list = value<{ exams: Array<{ examId: string; canStart: boolean }> }>(
      await s.call('getMyExams', student.request, {}),
    );
    expect(list.exams.find((e) => e.examId === published.exam.examId)?.canStart).toBe(true);

    const sheet = value<Sheet>(
      await s.call('startMyExam', student.request, { examId: published.exam.examId }),
    );
    expect(sheet.questions).toHaveLength(4);
    expect(sheet.questions[0]).not.toHaveProperty('correctIndex');
    const [q1, q2, q3] = sheet.questions.map((q) => q.questionId) as [string, string, string];
    const right = (id: string) => correctOf.get(id) as number;
    const wrong = (id: string) => (right(id) + 1) % 4;
    for (const [questionId, chosenIndex] of [
      [q1, right(q1)],
      [q2, right(q2)],
      [q3, wrong(q3)],
    ] as const)
      value(
        await s.call('saveMyExamAnswer', student.request, {
          attemptId: sheet.attemptId,
          questionId,
          chosenIndex,
        }),
      );
    // Starting again resumes the same attempt with saved answers.
    const resumed = value<Sheet>(
      await s.call('startMyExam', student.request, { examId: published.exam.examId }),
    );
    expect(resumed.attemptId).toBe(sheet.attemptId);
    expect(Object.keys(resumed.answers)).toHaveLength(3);
    // Another Student cannot touch it.
    const other = await s.newStudent();
    expect(
      await s.call('saveMyExamAnswer', other.request, {
        attemptId: sheet.attemptId,
        questionId: q1,
        chosenIndex: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    value(await s.call('submitMyExam', student.request, { attemptId: sheet.attemptId }));
    const result = value<{
      isReleased: boolean;
      marking: { correct: number; wrong: number; skipped: number; scoreX100: number };
      review: Array<{ correctIndex: number }>;
    }>(await s.call('getMyExamResult', student.request, { attemptId: sheet.attemptId }));
    expect(result.isReleased).toBe(true);
    expect(result.marking).toMatchObject({ correct: 2, wrong: 1, skipped: 1, scoreX100: 150 });
    expect(result.review).toHaveLength(4);
    // Closed: no more answers.
    expect(
      await s.call('saveMyExamAnswer', student.request, {
        attemptId: sheet.attemptId,
        questionId: q1,
        chosenIndex: 0,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.exam.closed' } });
    // The wrong answer is in the vault.
    expect(value<{ active: number }>(await s.call('getMyVault', student.request, {})).active).toBe(
      1,
    );
    // Study mode: answers and explanations are open, and the mock test is listed where it appeared.
    const explored = value<{
      rows: Array<{
        questionId: string;
        correctIndex: number;
        appearances: Array<{ examId: string }>;
      }>;
    }>(await s.call('exploreQuestionBank', student.request, { topicId }));
    const seen = explored.rows.find((r) => r.questionId === q1);
    expect(seen?.correctIndex).toBe(right(q1));
    expect(seen?.appearances.map((x) => x.examId)).toContain(published.exam.examId);
  });

  it('a Student makes their own practice exam; nobody else can open it', async () => {
    const student = await s.newStudent();
    const { examId } = value<{ examId: string }>(
      await s.call('createMyPracticeExam', student.request, {
        topicIds: [topicId],
        count: 5,
        durationMinutes: 10,
        negativeBps: 0,
      }),
    );
    const sheet = value<Sheet>(await s.call('startMyExam', student.request, { examId }));
    expect(sheet.questions).toHaveLength(5);
    const other = await s.newStudent();
    expect(await s.call('startMyExam', other.request, { examId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('live exams', () => {
  it('opens on time, allows one attempt, and releases results after the window', async () => {
    const startsAt = new Date(Date.now() + 3600_000 + 6 * 3600_000).toISOString().slice(0, 16);
    const published = await publish(s.admin, {
      kind: 'live',
      startsAtLocal: startsAt,
      durationMinutes: 60,
    });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    expect(
      await s.call('startMyExam', student.request, { examId: published.exam.examId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.exam.notOpenYet' } });

    // An upcoming live exam is never listed as an appearance.
    const before = value<{ rows: Array<{ appearances: Array<{ examId: string }> }> }>(
      await s.call('exploreQuestionBank', student.request, { topicId }),
    );
    expect(before.rows.flatMap((r) => r.appearances.map((x) => x.examId))).not.toContain(
      published.exam.examId,
    );
    // Move the window so it is open now.
    const db = getDb();
    await db
      .update(exam)
      .set({ startsAt: new Date(Date.now() - 60_000) })
      .where(eq(exam.examId, published.exam.examId));
    const sheet = value<Sheet>(
      await s.call('startMyExam', student.request, { examId: published.exam.examId }),
    );
    const q = sheet.questions[0]?.questionId as string;
    value(
      await s.call('saveMyExamAnswer', student.request, {
        attemptId: sheet.attemptId,
        questionId: q,
        chosenIndex: correctOf.get(q),
      }),
    );
    value(await s.call('submitMyExam', student.request, { attemptId: sheet.attemptId }));
    // While the window is open: nothing released, and no second attempt.
    expect(
      value<{ isReleased: boolean; marking: unknown; review: unknown[] }>(
        await s.call('getMyExamResult', student.request, { attemptId: sheet.attemptId }),
      ),
    ).toMatchObject({ isReleased: false, marking: null, review: [] });
    expect(
      await s.call('startMyExam', student.request, { examId: published.exam.examId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.exam.alreadyTaken' } });
    expect(value<{ active: number }>(await s.call('getMyVault', student.request, {})).active).toBe(
      0,
    );

    // After the window: results and the merit list.
    await db
      .update(exam)
      .set({ startsAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(exam.examId, published.exam.examId));
    await db
      .update(examAttempt)
      .set({ startedAt: new Date(Date.now() - 2 * 3600_000 + 60_000) })
      .where(eq(examAttempt.attemptId, sheet.attemptId));
    const result = value<{
      isReleased: boolean;
      merit: { total: number; myRank: number; top: Array<{ isMe: boolean }> };
    }>(await s.call('getMyExamResult', student.request, { attemptId: sheet.attemptId }));
    expect(result.isReleased).toBe(true);
    expect(result.merit).toMatchObject({ total: 1, myRank: 1 });
    expect(result.merit.top[0]?.isMe).toBe(true);
    // Once ended, it is listed.
    const after = value<{ rows: Array<{ appearances: Array<{ examId: string }> }> }>(
      await s.call('exploreQuestionBank', student.request, { topicId }),
    );
    expect(after.rows.flatMap((r) => r.appearances.map((x) => x.examId))).toContain(
      published.exam.examId,
    );
    // One right, three skipped: skipped questions do not enter the vault.
    expect(value<{ active: number }>(await s.call('getMyVault', student.request, {})).active).toBe(
      0,
    );
  });

  it('cannot be published with a start in the past', async () => {
    const d = value<Detail>(
      await s.call(
        'saveExamDraft',
        s.admin.request,
        draft({ kind: 'live', startsAtLocal: '2020-01-01T10:00' }),
      ),
    );
    const drawn = value<Detail>(
      await s.call('drawExamQuestionSet', s.admin.request, {
        examId: d.exam.examId,
        expectedVersion: d.exam.version,
      }),
    );
    expect(
      await s.call('publishExamForStudents', s.admin.request, {
        examId: drawn.exam.examId,
        expectedVersion: drawn.exam.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { startsAtLocal: ['errors.exam.startInPast'] } },
    });
  });
});
