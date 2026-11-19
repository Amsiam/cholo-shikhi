// [LT] Question bank: Admin taxonomy, Instructor authoring with Admin review, Students never see an
// unpublished question or an answer before answering, and a wrong practice answer enters the
// Mistake Vault grouped by topic.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let goalId: string;
let subjectId: string;
let topicId: string;
let subtopicId: string;

const question = (over: Record<string, unknown> = {}) => ({
  topicId: subtopicId,
  difficulty: 'medium',
  promptBn: 'সন্ধি কোনটি?',
  promptEn: 'Which is a sandhi?',
  optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
  optionsEn: ['A', 'B', 'C', 'D'],
  correctIndex: 1,
  explanationBn: 'কারণ খ।',
  explanationEn: 'Because B.',
  sourceNote: 'BCS 41',
  ...over,
});

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
  ).goalId;
  subjectId = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'বাংলা',
      nameEn: 'Bangla',
      goalIds: [goalId],
    }),
  ).subjectId;
  topicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, {
      subjectId,
      nameBn: 'ব্যাকরণ',
      nameEn: 'Grammar',
    }),
  ).topicId;
  subtopicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, {
      subjectId,
      parentTopicId: topicId,
      nameBn: 'সন্ধি',
      nameEn: 'Sandhi',
    }),
  ).topicId;
}, 120_000);
afterAll(async () => {
  await s?.close();
});

describe('taxonomy', () => {
  it('allows one level of sub-topics only', async () => {
    expect(
      await s.call('saveQuestionTopic', s.admin.request, {
        subjectId,
        parentTopicId: subtopicId,
        nameBn: 'গভীর',
        nameEn: 'Too deep',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
  it('is Admin-only to change', async () => {
    expect(
      await s.call('saveQuestionTopic', s.instructor.request, {
        subjectId,
        nameBn: 'ক',
        nameEn: 'K',
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('authoring and review', () => {
  it('an Instructor drafts, submits; only an Admin approves; then Students can practise it', async () => {
    const author = await s.newInstructor();
    const draft = value<{ questionId: string; status: string; version: number }>(
      await s.call('saveBankQuestionDraft', author.request, question()),
    );
    expect(draft.status).toBe('draft');
    expect(
      await s.call(
        'saveBankQuestionDraft',
        author.request,
        question({ optionsEn: ['A', 'A', 'C', 'D'] }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });

    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    // Not published yet: no practice.
    expect(await s.call('startMyPractice', student.request, { topicId })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.practice.empty' },
    });

    const submitted = value<{ status: string; version: number }>(
      await s.call('reviewBankQuestionAction', author.request, {
        questionId: draft.questionId,
        expectedVersion: draft.version,
        action: 'submit',
      }),
    );
    expect(submitted.status).toBe('in_review');
    // The author cannot approve their own question; another Instructor cannot either.
    expect(
      await s.call('reviewBankQuestionAction', author.request, {
        questionId: draft.questionId,
        expectedVersion: submitted.version,
        action: 'approve',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    // An Instructor cannot edit a question under review.
    expect(
      await s.call(
        'saveBankQuestionDraft',
        author.request,
        question({ questionId: draft.questionId, expectedVersion: submitted.version }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const approved = value<{ status: string }>(
      await s.call('reviewBankQuestionAction', s.admin.request, {
        questionId: draft.questionId,
        expectedVersion: submitted.version,
        action: 'approve',
      }),
    );
    expect(approved.status).toBe('published');

    // Catalog: the parent topic counts its sub-topic's questions.
    const catalog = value<{
      subjects: Array<{ topics: Array<{ topicId: string; questionCount: number }> }>;
    }>(await s.call('getMyPracticeTopics', student.request, {}));
    expect(catalog.subjects[0]?.topics.find((t) => t.topicId === topicId)?.questionCount).toBe(1);

    // Practice: no answer before answering.
    const round = value<{ questions: Array<Record<string, unknown>> }>(
      await s.call('startMyPractice', student.request, { topicId }),
    );
    expect(round.questions).toHaveLength(1);
    expect(round.questions[0]).not.toHaveProperty('correctIndex');

    // A wrong answer enters the vault, grouped by topic.
    const graded = value<{ isCorrect: boolean; correctIndex: number; addedToVault: boolean }>(
      await s.call('answerMyPracticeQuestion', student.request, {
        questionId: draft.questionId,
        chosenIndex: 3,
      }),
    );
    expect(graded).toMatchObject({ isCorrect: false, correctIndex: 1, addedToVault: true });
    const vault = value<{ active: number; groups: Array<{ kind: string; titleEn: string }> }>(
      await s.call('getMyVault', student.request, {}),
    );
    expect(vault.active).toBe(1);
    expect(vault.groups[0]).toMatchObject({ kind: 'topic', titleEn: 'Sandhi' });
    const session = value<{ questions: Array<{ questionId: string }> }>(
      await s.call('getMyVaultSession', student.request, {}),
    );
    expect(session.questions.map((q) => q.questionId)).toEqual([draft.questionId]);
    expect(
      value<{ isCorrect: boolean }>(
        await s.call('answerMyVaultQuestion', student.request, {
          questionId: draft.questionId,
          chosenIndex: 1,
        }),
      ).isCorrect,
    ).toBe(true);
  });

  it('a rejection needs a note; an Admin question publishes directly', async () => {
    const author = await s.newInstructor();
    const d = value<{ questionId: string; version: number }>(
      await s.call('saveBankQuestionDraft', author.request, question()),
    );
    const sub = value<{ version: number }>(
      await s.call('reviewBankQuestionAction', author.request, {
        questionId: d.questionId,
        expectedVersion: d.version,
        action: 'submit',
      }),
    );
    expect(
      await s.call('reviewBankQuestionAction', s.admin.request, {
        questionId: d.questionId,
        expectedVersion: sub.version,
        action: 'reject',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      value<{ status: string; reviewNote: string }>(
        await s.call('reviewBankQuestionAction', s.admin.request, {
          questionId: d.questionId,
          expectedVersion: sub.version,
          action: 'reject',
          note: 'Option C is also right.',
        }),
      ),
    ).toMatchObject({ status: 'rejected', reviewNote: 'Option C is also right.' });
    expect(
      value<{ status: string }>(await s.call('saveBankQuestionDraft', s.admin.request, question()))
        .status,
    ).toBe('published');
  });

  it('measures difficulty from first attempts only, starting from the teacher difficulty', async () => {
    const q = value<{ questionId: string; effectiveDifficulty: string; firstAttempts: number }>(
      await s.call('saveBankQuestionDraft', s.admin.request, question({ difficulty: 'easy' })),
    );
    expect(q).toMatchObject({ effectiveDifficulty: 'easy', firstAttempts: 0 });
    const student = await s.newStudent();
    for (let i = 0; i < 3; i += 1)
      value(
        await s.call('answerMyPracticeQuestion', student.request, {
          questionId: q.questionId,
          chosenIndex: 0,
        }),
      );
    const after = value<{ firstAttempts: number; firstCorrectRate: number }>(
      await s.call('getBankQuestionForEditing', s.admin.request, { questionId: q.questionId }),
    );
    // Three answers by one Student: one first attempt (wrong).
    expect(after).toMatchObject({ firstAttempts: 1, firstCorrectRate: 0 });
  });

  it('Instructors list only their own drafts; a Student cannot reach the bank', async () => {
    const other = await s.newInstructor();
    const list = value<{ rows: unknown[] }>(
      await s.call('listBankQuestions', other.request, { status: 'draft' }),
    );
    expect(list.rows).toHaveLength(0);
    const student = await s.newStudent();
    expect(await s.call('listBankQuestions', student.request, {})).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
