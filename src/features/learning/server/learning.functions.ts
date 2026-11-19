// Learning server functions. Every one needs a signed-in user; course and lesson reads also need
// the caller's active enrolment (checked in the service; NOT_FOUND otherwise).

import { createServerFn } from '@tanstack/react-start';
import {
  AttemptRef,
  CreateCustomExamInput,
  ExamRef,
  ExploreInput,
  SaveExamAnswerInput,
} from '#src/features/assessment/index.ts';
import { listActiveEnrolments } from '#src/features/commerce/index.ts';
import { ok } from '#src/lib/result.ts';
import { authedFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  exploreMyQuestions,
  getExamResult,
  listMyExams,
  makeCustomExam,
  myExamResults,
  saveAnswer,
  startExam,
  submitExam,
} from './exams.server.ts';
import {
  CourseNpsInput,
  CourseRefInput,
  LessonRefInput,
  NoInput,
  PracticeAnswerInput,
  StartPracticeInput,
  SubmitQuizInput,
  VaultAnswerInput,
} from './learning.schema.ts';
import {
  answerCourseNps,
  completeLesson,
  countWrongAnswers,
  dismissBadgeNotice,
  getLearningCourse,
  getLesson,
  listMyCourses,
  listMyQuizResults,
  submitQuiz,
} from './learning.server.ts';
import { answerPractice, getPracticeCatalog, startPractice } from './practice.server.ts';
import {
  battleEntryTokens,
  buddyRounding,
  dailyTokenAmount,
  getGoalStreak,
  getMyRewards,
  shieldTopN,
} from './streak.server.ts';
import { answerVaultQuestion, getVaultSession, getVaultSummary } from './vault.server.ts';

export const listMyLearningCourses = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => listMyCourses(actor)));

export const getMyLearningCourse = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CourseRefInput>())
  .handler(authedFn(CourseRefInput, async ({ actor, input }) => getLearningCourse(actor, input)));

export const getMyLesson = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof LessonRefInput>())
  .handler(authedFn(LessonRefInput, async ({ actor, input }) => getLesson(actor, input)));

export const completeMyLesson = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LessonRefInput>())
  .handler(authedFn(LessonRefInput, async ({ actor, input }) => completeLesson(actor, input)));

export const submitMyQuiz = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SubmitQuizInput>())
  .handler(authedFn(SubmitQuizInput, async ({ actor, input }) => submitQuiz(actor, input)));

/** The dashboard's learning counts: active enrolments and distinct wrongly answered questions. */
export const getMyLearningSummary = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor }) => {
      const [enrolments, wrongAnswers] = await Promise.all([
        listActiveEnrolments(actor.userId),
        countWrongAnswers(actor.userId),
      ]);
      return ok({ enrolled: enrolments.length, wrongAnswers });
    }),
  );

// Mistake Vault (FR-ADP-1): the Student's own vault only.
export const getMyVault = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getVaultSummary(actor)));

export const getMyVaultSession = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getVaultSession(actor)));

export const answerMyVaultQuestion = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof VaultAnswerInput>())
  .handler(
    authedFn(VaultAnswerInput, async ({ actor, input }) => answerVaultQuestion(actor, input)),
  );

/** Goal streak (FR-RTN-1) for the caller's current Goal. */
export const getMyGoalStreak = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getGoalStreak(actor)));

/** US3.12: dismiss the one-time viewer-badge explanation. */
export const dismissMyBadgeNotice = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => dismissBadgeNotice(actor)));

/** US7.18: answer (or skip) the course NPS question once the course is complete. */
export const answerMyCourseNps = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CourseNpsInput>())
  .handler(authedFn(CourseNpsInput, async ({ actor, input }) => answerCourseNps(actor, input)));

/** Admin: the current streak-token and streak-shield amounts (saved through the settings API). */
export const getRewardSettings = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    roleFn('admin', NoInput, async () =>
      ok({
        dailyTokens: await dailyTokenAmount(),
        battleEntryTokens: await battleEntryTokens(),
        shieldTopN: await shieldTopN(),
        buddyRounding: await buddyRounding(),
      }),
    ),
  );

/** Me → Streak (S8): streak, shields, token balance and history. */
export const getMyStreakRewards = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getMyRewards(actor)));

export const getMyPracticeTopics = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => getPracticeCatalog(actor)));

export const startMyPractice = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof StartPracticeInput>())
  .handler(authedFn(StartPracticeInput, async ({ actor, input }) => startPractice(actor, input)));

export const answerMyPracticeQuestion = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof PracticeAnswerInput>())
  .handler(authedFn(PracticeAnswerInput, async ({ actor, input }) => answerPractice(actor, input)));

// Exams: mock tests, live exams and the Student's own practice exams.
export const getMyExams = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => listMyExams(actor)));

export const createMyPracticeExam = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CreateCustomExamInput>())
  .handler(
    authedFn(CreateCustomExamInput, async ({ actor, input }) => makeCustomExam(actor, input)),
  );

export const startMyExam = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamRef>())
  .handler(authedFn(ExamRef, async ({ actor, input }) => startExam(actor, input)));

export const saveMyExamAnswer = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveExamAnswerInput>())
  .handler(authedFn(SaveExamAnswerInput, async ({ actor, input }) => saveAnswer(actor, input)));

export const submitMyExam = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AttemptRef>())
  .handler(authedFn(AttemptRef, async ({ actor, input }) => submitExam(actor, input)));

export const getMyExamResult = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof AttemptRef>())
  .handler(authedFn(AttemptRef, async ({ actor, input }) => getExamResult(actor, input)));

export const exploreQuestionBank = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ExploreInput>())
  .handler(authedFn(ExploreInput, async ({ actor, input }) => exploreMyQuestions(actor, input)));

/** The Student's results: lesson quizzes and exams. */
export const getMyResults = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor }) => {
      const [quizzes, exams] = await Promise.all([listMyQuizResults(actor), myExamResults(actor)]);
      return ok({ quizzes: quizzes.ok ? quizzes.value : [], exams });
    }),
  );
