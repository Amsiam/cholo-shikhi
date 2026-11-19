// [LT] Instructor authoring of video and quiz lessons, end to end: the section owner sets a YouTube
// video and writes MCQs on the working copy, the course is published, a Student who bought it
// plays the video and answers the questions (never seeing the answer key before submitting). Later
// edits stay on the working copy until re-published, and a published version's questions are
// immutable in the database itself.

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import {
  streakActivity,
  streakShield,
  studentGoalSelection,
  tokenEntry,
} from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let courseId: string;
let sectionId: string;
let lead: Awaited<ReturnType<ServerFnHarness['newInstructor']>>;
let videoLessonId: string;
let quizLessonId: string;

type Lesson = {
  lessonId: string;
  version: number;
  kind: string;
  youtubeVideoId: string | null;
  quizQuestionCount: number;
  isComplete: boolean;
};
const question = (n: number, correctIndex: number) => ({
  promptBn: `প্রশ্ন ${n}`,
  promptEn: `Question ${n}?`,
  optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
  optionsEn: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  correctIndex,
  explanationBn: null,
  explanationEn: `Because of ${n}.`,
});

const lessonOf = async (lessonId: string) =>
  (await p.sectionEdit(courseId, sectionId, lead)).lessons.find(
    (l) => l.lessonId === lessonId,
  ) as unknown as Lesson;

type Readiness = {
  courseVersion: number;
  sections: Array<{ sectionId: string; workingVersion: number | null }>;
};
/** Admin publish (approves every section), acknowledging the video lesson has no captions yet. */
async function publishAcknowledgingCaptions() {
  const ready = value<Readiness>(
    await s.call('getPublishReadiness', s.admin.request, { courseId }),
  );
  return s.call('publishCourse', s.admin.request, {
    courseId,
    expectedVersion: ready.courseVersion,
    sectionVersions: ready.sections
      .filter((x) => x.workingVersion !== null)
      .map((x) => ({ sectionId: x.sectionId, expectedVersion: x.workingVersion })),
    acknowledgedMissingCaptions: [videoLessonId],
  });
}

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
  const draft = await p.draft(goalId);
  courseId = draft.courseId;
  lead = draft.lead;
  sectionId = draft.sectionIds[0] as string;
  for (const kind of ['video', 'quiz'] as const) {
    const edit = await p.sectionEdit(courseId, sectionId, lead);
    const added = value<{ lessonId: string }>(
      await s.call('addLesson', lead.request, {
        courseId,
        sectionId,
        expectedVersion: edit.editVersion,
        kind,
        titleBn: kind === 'video' ? 'লেকচার' : 'কুইজ',
        titleEn: kind === 'video' ? 'Lecture' : 'Quiz',
      }),
    );
    if (kind === 'video') videoLessonId = added.lessonId;
    else quizLessonId = added.lessonId;
  }
}, 120_000);
afterAll(async () => {
  await s?.close();
});

describe('authoring video and quiz lessons on the working copy', () => {
  it('an empty video or quiz lesson is incomplete', async () => {
    expect((await lessonOf(videoLessonId)).isComplete).toBe(false);
    expect((await lessonOf(quizLessonId)).isComplete).toBe(false);
  });

  it('refuses a link that is not a YouTube video', async () => {
    const lesson = await lessonOf(videoLessonId);
    expect(
      await s.call('setLessonVideo', lead.request, {
        courseId,
        sectionId,
        lessonId: videoLessonId,
        expectedVersion: lesson.version,
        youtube: 'https://example.com/watch?v=RGqj9z65P3Y',
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { youtube: ['errors.catalog.youtubeInvalid'] },
      },
    });
  });

  it('sets the video from a pasted link, and the lesson becomes complete', async () => {
    const lesson = await lessonOf(videoLessonId);
    const saved = value<{ youtubeVideoId: string }>(
      await s.call('setLessonVideo', lead.request, {
        courseId,
        sectionId,
        lessonId: videoLessonId,
        expectedVersion: lesson.version,
        youtube: 'https://youtu.be/RGqj9z65P3Y?si=x',
      }),
    );
    expect(saved.youtubeVideoId).toBe('RGqj9z65P3Y');
    expect(await lessonOf(videoLessonId)).toMatchObject({
      youtubeVideoId: 'RGqj9z65P3Y',
      isComplete: true,
    });
  });

  it('refuses a stale token', async () => {
    expect(
      await s.call('setLessonVideo', lead.request, {
        courseId,
        sectionId,
        lessonId: videoLessonId,
        expectedVersion: 1,
        youtube: 'RGqj9z65P3Y',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('refuses video on a quiz lesson and questions on a video lesson', async () => {
    const quiz = await lessonOf(quizLessonId);
    expect(
      await s.call('setLessonVideo', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
        expectedVersion: quiz.version,
        youtube: 'RGqj9z65P3Y',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const video = await lessonOf(videoLessonId);
    expect(
      await s.call('saveQuizQuestions', lead.request, {
        courseId,
        sectionId,
        lessonId: videoLessonId,
        expectedVersion: video.version,
        questions: [question(1, 0)],
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses invalid questions, naming the field', async () => {
    const quiz = await lessonOf(quizLessonId);
    expect(
      await s.call('saveQuizQuestions', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
        expectedVersion: quiz.version,
        questions: [{ ...question(1, 0), promptEn: '  ' }],
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'questions.0.promptEn': ['errors.catalog.quiz.promptRequired'] } },
    });
  });

  it('saves the questions and records their count', async () => {
    const quiz = await lessonOf(quizLessonId);
    const saved = value<{ questionCount: number }>(
      await s.call('saveQuizQuestions', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
        expectedVersion: quiz.version,
        questions: [question(1, 1), question(2, 3)],
      }),
    );
    expect(saved.questionCount).toBe(2);
    expect(await lessonOf(quizLessonId)).toMatchObject({ quizQuestionCount: 2, isComplete: true });
    const editorView = value<{ questions: Array<{ correctIndex: number }> }>(
      await s.call('getQuizForEditing', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
      }),
    );
    expect(editorView.questions.map((q) => q.correctIndex)).toEqual([1, 3]);
  });

  it('another instructor cannot change the section', async () => {
    const stranger = await s.newInstructor();
    const quiz = await lessonOf(quizLessonId);
    const result = await s.call('saveQuizQuestions', stranger.request, {
      courseId,
      sectionId,
      lessonId: quizLessonId,
      expectedVersion: quiz.version,
      questions: [question(9, 0)],
    });
    expect(result.ok).toBe(false);
    expect(
      await s.call('getQuizForEditing', stranger.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('after publishing: the Student learns from it, edits wait for re-publishing', () => {
  let student: Awaited<ReturnType<ServerFnHarness['newStudent']>>;

  beforeAll(async () => {
    value(await publishAcknowledgingCaptions());
    value(
      await s.call('saveFlag', s.admin.request, {
        flagKey: 'commerce.fakeGateway',
        description: 'LT',
        state: 'on',
      }),
    );
    student = await s.newStudent();
    const checkout = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', student.request, { courseId }),
    );
    value(
      await s.call('settleMyFakePayment', student.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
  }, 120_000);

  it('the Student gets the video and the questions, without the answer key', async () => {
    const video = value<{ youtubeVideoId: string }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: videoLessonId }),
    );
    expect(video.youtubeVideoId).toBe('RGqj9z65P3Y');
    const quiz = value<{ questions: Array<Record<string, unknown>> }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    expect(quiz.questions).toHaveLength(2);
    for (const q of quiz.questions) expect(q).not.toHaveProperty('correctIndex');
  });

  it('grades the Student’s answers against the published questions', async () => {
    const quiz = value<{ questions: Array<{ questionId: string }> }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    const result = value<{ score: number; total: number }>(
      await s.call('submitMyQuiz', student.request, {
        courseId,
        lessonId: quizLessonId,
        answers: [
          { questionId: quiz.questions[0]?.questionId, chosenIndex: 1 },
          { questionId: quiz.questions[1]?.questionId, chosenIndex: 0 },
        ],
      }),
    );
    expect(result).toMatchObject({ score: 1, total: 2 });
  });

  it('the wrong answer enters the Mistake Vault; two right answers in a row master it', async () => {
    const vault = value<{
      active: number;
      mastered: number;
      groups: Array<{ groupId: string; kind: string }>;
    }>(await s.call('getMyVault', student.request, {}));
    expect(vault).toMatchObject({ active: 1, mastered: 0 });
    expect(vault.groups.map((c) => c.groupId)).toEqual([courseId]);

    const session = value<{
      questions: Array<Record<string, unknown> & { questionId: string; lastWrongChoice: number }>;
    }>(await s.call('getMyVaultSession', student.request, {}));
    expect(session.questions).toHaveLength(1);
    const q = session.questions[0] as { questionId: string; lastWrongChoice: number };
    expect(session.questions[0]).not.toHaveProperty('correctIndex');

    // Another Student cannot answer this Student's vault item.
    const stranger = await s.newStudent();
    expect(
      await s.call('answerMyVaultQuestion', stranger.request, {
        questionId: q.questionId,
        chosenIndex: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const wrong = value<{ isCorrect: boolean; correctIndex: number; status: string }>(
      await s.call('answerMyVaultQuestion', student.request, {
        questionId: q.questionId,
        chosenIndex: q.lastWrongChoice,
      }),
    );
    expect(wrong).toMatchObject({ isCorrect: false, status: 'active' });
    const right = { questionId: q.questionId, chosenIndex: wrong.correctIndex };
    expect(value(await s.call('answerMyVaultQuestion', student.request, right))).toMatchObject({
      isCorrect: true,
      status: 'active',
      correctRun: 1,
    });
    expect(value(await s.call('answerMyVaultQuestion', student.request, right))).toMatchObject({
      isCorrect: true,
      status: 'mastered',
      correctRun: 2,
    });
    expect(value(await s.call('getMyVault', student.request, {}))).toMatchObject({
      active: 0,
      mastered: 1,
      answeredToday: 3,
    });
    expect(
      value<{ questions: unknown[] }>(await s.call('getMyVaultSession', student.request, {}))
        .questions,
    ).toHaveLength(0);
  });

  it('the goal streak counts today once the Student has a Goal, and only that Goal’s activity', async () => {
    // No Goal chosen yet: no streak.
    expect(value(await s.call('getMyGoalStreak', student.request, {}))).toMatchObject({
      goalId: null,
      current: 0,
    });
    const page = value<{ goal: { goalId: string } }>(
      await s.call('getPublicCoursePage', s.anonymous(), { courseId }),
    );
    value(await s.call('chooseGoal', student.request, { goalId: page.goal.goalId }));
    // Activity before the Goal was chosen does not carry over; a new quiz attempt today counts.
    const quiz = value<{ questions: Array<{ questionId: string }> }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    value(
      await s.call('submitMyQuiz', student.request, {
        courseId,
        lessonId: quizLessonId,
        answers: quiz.questions.map((q) => ({ questionId: q.questionId, chosenIndex: 0 })),
      }),
    );
    const streak = value<{ current: number; isActiveToday: boolean; week: unknown[] }>(
      await s.call('getMyGoalStreak', student.request, {}),
    );
    expect(streak).toMatchObject({ current: 1, isActiveToday: true });
    expect(streak.week).toHaveLength(7);
  });

  it('credits daily streak-tokens once per day and spends shields on missed days', async () => {
    const db = getDb();
    const dayAgo = (n: number) =>
      new Date(Date.now() + 6 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
    // US5.16: today's quiz attempt earned the daily amount (default 5), once.
    type Rewards = {
      streak: { current: number; tokens: number; shieldsAvailable: number };
      history: Array<{ reason: string; delta: number }>;
      shields: Array<{ usedForDay: string | null }>;
    };
    const first = value<Rewards>(await s.call('getMyStreakRewards', student.request, {}));
    expect(first.streak.tokens).toBe(5);
    expect(
      value<Rewards>(await s.call('getMyStreakRewards', student.request, {})).streak.tokens,
    ).toBe(5);
    // Studied 4 and 3 days ago, missed the 2 days after, studied today; 2 shields held.
    await db
      .update(studentGoalSelection)
      .set({ selectedAt: new Date(Date.now() - 10 * 86_400_000) })
      .where(eq(studentGoalSelection.userId, student.userId));
    for (const n of [4, 3])
      await db.insert(streakActivity).values({
        userId: student.userId,
        courseId,
        kind: 'live',
        day: dayAgo(n),
        at: new Date(Date.now() - n * 86_400_000),
      });
    await db.insert(streakShield).values(
      ['quiz-a', 'quiz-b'].map((ref) => ({
        userId: student.userId,
        source: 'live_quiz' as const,
        sourceRef: ref,
        earnedAt: new Date(Date.now() - 8 * 86_400_000),
      })),
    );
    // AC5.7.2: both shields are used; the streak continues (shielded days don't add).
    const after = value<Rewards>(await s.call('getMyStreakRewards', student.request, {}));
    expect(after.streak).toMatchObject({ current: 3, shieldsAvailable: 0, tokens: 15 });
    expect(after.shields.map((x) => x.usedForDay).sort()).toEqual([dayAgo(2), dayAgo(1)]);
    // Reading again changes nothing.
    expect(
      value<Rewards>(await s.call('getMyStreakRewards', student.request, {})).streak,
    ).toMatchObject({
      current: 3,
      tokens: 15,
    });
    expect(
      await db.select().from(tokenEntry).where(eq(tokenEntry.userId, student.userId)),
    ).toHaveLength(3);
  });

  it('US3.12: a video lesson carries the viewer badge; the explanation shows until dismissed', async () => {
    type Viewer = { viewer: { badge: string; badgeSeconds: number; showNotice: boolean } | null };
    const read = async () =>
      value<Viewer>(
        await s.call('getMyLesson', student.request, { courseId, lessonId: videoLessonId }),
      ).viewer;
    expect(await read()).toEqual({
      badge: `CS-${student.userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      badgeSeconds: 45,
      showNotice: true,
    });
    value(await s.call('dismissMyBadgeNotice', student.request, {}));
    expect((await read())?.showNotice).toBe(false);
    // A quiz lesson has no viewer badge.
    expect(
      value<Viewer>(
        await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
      ).viewer,
    ).toBeNull();
  });

  it('US4.13: a streak-only bonus quiz opens only with the streak it needs', async () => {
    // AC4.13.3: a threshold of 0 or below is refused on save.
    const quiz = value<{ version: number }>(
      await s.call('getQuizForEditing', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
      }),
    );
    expect(
      await s.call('saveQuizQuestions', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
        expectedVersion: quiz.version,
        questions: [question(1, 1)],
        streakBonusDays: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const setBonus = (days: number | null) =>
      getDb().execute(
        sql`UPDATE lesson_version SET streak_bonus_days = ${days} WHERE lesson_id = ${quizLessonId}`,
      );
    type Lesson = { bonusLock: { needed: number; current: number } | null; questions: unknown[] };
    // AC4.13.2: a 30-day bonus is locked for a 1-day streak, and a direct submission is refused.
    await setBonus(30);
    const locked = value<Lesson>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    expect(locked.bonusLock).toMatchObject({ needed: 30 });
    expect(locked.questions).toEqual([]);
    expect(
      await s.call('submitMyQuiz', student.request, {
        courseId,
        lessonId: quizLessonId,
        answers: [],
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.learning.bonusLocked' } });
    const outline = value<{
      sections: Array<{ lessons: Array<{ lessonId: string; isBonusLocked: boolean }> }>;
    }>(await s.call('getMyLearningCourse', student.request, { courseId }));
    expect(
      outline.sections.flatMap((x) => x.lessons).find((l) => l.lessonId === quizLessonId)
        ?.isBonusLocked,
    ).toBe(true);
    // AC4.13.1: with the streak it needs, it opens.
    await setBonus(1);
    const open = value<Lesson>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    expect(open.bonusLock).toBeNull();
    expect(open.questions.length).toBeGreaterThan(0);
    await setBonus(null);
  });

  it('a published version’s questions cannot be changed, even directly in the database', async () => {
    const failure = await getDb()
      .execute(sql`
        UPDATE quiz_question SET correct_index = 0
        WHERE lesson_version_id IN (
          SELECT lv.lesson_version_id FROM lesson_version lv JOIN section s ON s.live_version_id = lv.section_version_id
          WHERE lv.lesson_id = ${quizLessonId})`)
      .then(
        () => null,
        (error: unknown) => error as { message: string; cause?: { message?: string } },
      );
    expect(failure).not.toBeNull();
    expect(failure?.cause?.message ?? failure?.message).toMatch(
      /quiz_question in a published section version is immutable/,
    );
  });

  it('a new edit opens a working copy that keeps the video and questions, while the Student still sees the published ones', async () => {
    const before = await lessonOf(quizLessonId);
    expect(before.quizQuestionCount).toBe(2);
    const editorView = value<{ version: number; questions: unknown[] }>(
      await s.call('getQuizForEditing', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
      }),
    );
    value(
      await s.call('saveQuizQuestions', lead.request, {
        courseId,
        sectionId,
        lessonId: quizLessonId,
        expectedVersion: editorView.version,
        questions: [question(1, 1), question(2, 3), question(3, 2)],
      }),
    );
    const working = await p.sectionEdit(courseId, sectionId, lead);
    const copiedVideo = working.lessons.find(
      (l) => l.lessonId === videoLessonId,
    ) as unknown as Lesson;
    expect(copiedVideo.youtubeVideoId).toBe('RGqj9z65P3Y');
    expect(
      (working.lessons.find((l) => l.lessonId === quizLessonId) as unknown as Lesson)
        .quizQuestionCount,
    ).toBe(3);
    const live = value<{ questions: unknown[] }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    expect(live.questions).toHaveLength(2);
  });

  it('re-publishing puts the edited questions live', async () => {
    value(await publishAcknowledgingCaptions());
    const live = value<{ questions: unknown[] }>(
      await s.call('getMyLesson', student.request, { courseId, lessonId: quizLessonId }),
    );
    expect(live.questions).toHaveLength(3);
  });
});
