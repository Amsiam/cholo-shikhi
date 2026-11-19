// The learning service: the Student's purchased courses, a course's learning home, the lesson
// player (video, reading, quiz), lesson completion and quiz grading. Every course and lesson read
// first checks that the caller holds an active enrolment; without one the answer is NOT_FOUND, the
// same as a missing course, so access cannot be probed. Correct quiz answers are only returned for
// a submission the caller made.

import type { CoursePage } from '#src/features/catalog/index.ts';
import { getPublishedCourse, getPublishedLesson } from '#src/features/catalog/index.ts';
import {
  courseAccessOf,
  entitlementsOf,
  listActiveEnrolments,
  listTrialsOf,
} from '#src/features/commerce/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { trialLessonIds, trialState } from '#src/lib/trial.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createLearningRepository, type QuestionRow } from '../data/learning.repository.ts';
import { createNoticeRepository } from '../data/notice.repository.ts';
import { createNpsRepository } from '../data/nps.repository.ts';
import { courseProgress, lessonNeighbours } from '../domain/progress.ts';
import { gradeQuiz } from '../domain/quiz.ts';
import { viewerBadge } from '../domain/viewer-badge.ts';
import {
  CourseNpsInput,
  CourseRefInput,
  LessonRefInput,
  SubmitQuizInput,
} from './learning.schema.ts';
import type {
  LearningCourse,
  LessonView,
  MyCourse,
  QuizQuestionView,
  QuizResult,
  TrialView,
} from './learning.types.ts';
import { syncStreak, videoBadgeSeconds } from './streak.server.ts';
import { countActiveVaultItems, recordQuizMistakes } from './vault.server.ts';

type LearningError = AppError<'NOT_FOUND' | 'INVALID_STATE'>;

const repo = createLearningRepository();
const notFound = (): LearningError => appError('NOT_FOUND');
const nps = createNpsRepository();
const notices = createNoticeRepository();
const bonusLocked = (): LearningError => ({
  ...appError('INVALID_STATE'),
  i18nKey: 'errors.learning.bonusLocked',
});
const invalidState = (): LearningError => appError('INVALID_STATE');

function orderedLessonIds(course: CoursePage): string[] {
  return course.outline.flatMap((s) => s.lessons.map((l) => l.lessonId));
}

type CourseAccessView = {
  course: CoursePage;
  endsAt: string;
  /** For a free trial: which lessons are open and the trial's state; null for a paid enrolment. */
  trial: { open: ReadonlySet<string>; view: TrialView } | null;
};

/** The trial's open lessons and state, from the course order and the Student's progress. */
function trialOf(
  course: CoursePage,
  endsAt: string,
  completed: ReadonlySet<string>,
  lessonCap: number,
): CourseAccessView['trial'] {
  const open = trialLessonIds(orderedLessonIds(course), lessonCap);
  const view = trialState(new Date(endsAt), open, completed, new Date());
  // Once the trial has run out, nothing stays open (FR-DIST-1: content is locked).
  return { open: new Set(view.isExpired ? [] : open), view };
}

/**
 * The course for a Student who may study it: a paid enrolment, or a free trial (caps applied).
 * Anyone else gets NOT_FOUND, like a missing course.
 */
async function accessibleCourse(
  actor: Actor,
  courseId: string,
): Promise<Result<CourseAccessView, LearningError>> {
  const access = await courseAccessOf(actor.userId, courseId);
  if (!access) return err(notFound());
  const course = await getPublishedCourse(courseId);
  if (!course.ok) return err(notFound());
  if (access.kind === 'enrolled')
    return ok({ course: course.value, endsAt: access.endsAt, trial: null });
  const completed = await repo.completedLessonIds(getDb(), actor.userId, courseId);
  return ok({
    course: course.value,
    endsAt: access.endsAt,
    trial: trialOf(course.value, access.endsAt, completed, access.lessonCap),
  });
}

const trialLocked = (): LearningError => ({
  ...appError('INVALID_STATE'),
  i18nKey: 'errors.learning.trialLocked',
});

/** Refuses a lesson outside the trial's open lessons. */
async function lessonOpenFor(
  actor: Actor,
  courseId: string,
  lessonId: string,
): Promise<Result<CourseAccessView, LearningError>> {
  const found = await accessibleCourse(actor, courseId);
  if (!found.ok) return found;
  if (found.value.trial && !found.value.trial.open.has(lessonId)) return err(trialLocked());
  return found;
}

function toQuestionView(q: QuestionRow): QuizQuestionView {
  return {
    questionId: q.questionId,
    position: q.position,
    promptBn: q.promptBn,
    promptEn: q.promptEn,
    optionsBn: q.optionsBn,
    optionsEn: q.optionsEn,
  };
}

function toResult(
  questions: readonly QuestionRow[],
  attempt: {
    score: number;
    total: number;
    submittedAt: Date;
    answers: ReadonlyArray<{ questionId: string; chosenIndex: number | null; isCorrect: boolean }>;
  },
): QuizResult {
  const byId = new Map(attempt.answers.map((a) => [a.questionId, a]));
  return {
    score: attempt.score,
    total: attempt.total,
    submittedAt: attempt.submittedAt.toISOString(),
    answers: questions.map((q) => {
      const answer = byId.get(q.questionId);
      return {
        questionId: q.questionId,
        chosenIndex: answer?.chosenIndex ?? null,
        correctIndex: q.correctIndex,
        isCorrect: answer?.isCorrect ?? false,
        explanationBn: q.explanationBn,
        explanationEn: q.explanationEn,
      };
    }),
  };
}

/** Every course the Student may study (paid enrolments, then free trials), newest first. */
/** The first unfinished lesson in course order, with its title. */
function nextLessonOf(
  course: {
    outline: ReadonlyArray<{
      lessons: ReadonlyArray<{
        lessonId: string;
        kind: 'video' | 'text' | 'quiz';
        titleBn: string | null;
        titleEn: string | null;
      }>;
    }>;
  },
  completed: ReadonlySet<string>,
): MyCourse['nextLesson'] {
  for (const section of course.outline)
    for (const l of section.lessons)
      if (!completed.has(l.lessonId))
        return {
          lessonId: l.lessonId,
          kind: l.kind,
          titleBn: l.titleBn ?? '',
          titleEn: l.titleEn ?? '',
        };
  return null;
}

export async function listMyCourses(actor: Actor): Promise<Result<MyCourse[], LearningError>> {
  const [enrolments, trials, ent] = await Promise.all([
    listActiveEnrolments(actor.userId),
    listTrialsOf(actor.userId),
    entitlementsOf(actor.userId),
  ]);
  const enrolled = new Set(enrolments.map((e) => e.courseId));
  const viaPlan = ent.planCourses.filter((c) => !enrolled.has(c.courseId));
  for (const c of viaPlan) enrolled.add(c.courseId);
  const entries = [
    ...enrolments.map((e) => ({
      courseId: e.courseId,
      endsAt: e.endsAt,
      isTrial: false,
      lessonCap: 0,
    })),
    ...viaPlan.map((c) => ({
      courseId: c.courseId,
      endsAt: c.endsAt,
      isTrial: false,
      lessonCap: 0,
    })),
    ...trials
      .filter((t) => !enrolled.has(t.courseId))
      .map((t) => ({
        courseId: t.courseId,
        endsAt: t.endsAt,
        isTrial: true,
        lessonCap: t.lessonCap,
      })),
  ];
  const db = getDb();
  const lastActive = await repo.lastActivityByCourse(db, actor.userId);
  const courses = await Promise.all(
    entries.map(async (e): Promise<MyCourse | null> => {
      const course = await getPublishedCourse(e.courseId);
      if (!course.ok) return null;
      const completed = await repo.completedLessonIds(db, actor.userId, e.courseId);
      return {
        courseId: e.courseId,
        titleBn: course.value.titleBn,
        titleEn: course.value.titleEn,
        goal: { nameBn: course.value.goal.nameBn, nameEn: course.value.goal.nameEn },
        endsAt: e.endsAt,
        progress: courseProgress(orderedLessonIds(course.value), completed),
        trial: e.isTrial
          ? (trialOf(course.value, e.endsAt, completed, e.lessonCap)?.view ?? null)
          : null,
        lastActiveAt: lastActive.get(e.courseId)?.toISOString() ?? null,
        nextLesson: nextLessonOf(course.value, completed),
      };
    }),
  );
  return ok(courses.filter((c): c is MyCourse => c !== null));
}

/** The course's learning home: progress, the outline with completion marks, the instructors. */
export async function getLearningCourse(
  actor: Actor,
  raw: CourseRefInput,
): Promise<Result<LearningCourse, LearningError>> {
  const input = CourseRefInput.parse(raw);
  const found = await accessibleCourse(actor, input.courseId);
  if (!found.ok) return found;
  const { course, endsAt, trial } = found.value;
  const completed = await repo.completedLessonIds(getDb(), actor.userId, course.courseId);
  const progress = courseProgress(orderedLessonIds(course), completed);
  // US4.13: the streak is read only when the course has a streak-only bonus quiz.
  const hasBonus = course.outline.some((sec) => sec.lessons.some((l) => l.streakBonusDays));
  const streak = hasBonus ? (await syncStreak(actor.userId)).current : 0;
  const askNps =
    trial === null &&
    progress.percent === 100 &&
    !(await nps.hasAnswered(getDb(), actor.userId, course.courseId));
  return ok({
    courseId: course.courseId,
    titleBn: course.titleBn,
    titleEn: course.titleEn,
    goal: { nameBn: course.goal.nameBn, nameEn: course.goal.nameEn },
    endsAt,
    trial: trial?.view ?? null,
    progress,
    askNps,
    instructors: course.instructors.map((i) => ({
      instructorId: i.instructorId,
      displayName: i.displayName,
      role: i.role,
    })),
    sections: course.outline.map((s) => ({
      sectionId: s.sectionId,
      titleBn: s.titleBn,
      titleEn: s.titleEn,
      lessons: s.lessons.map((l) => ({
        lessonId: l.lessonId,
        kind: l.kind,
        titleBn: l.titleBn,
        titleEn: l.titleEn,
        isCompleted: completed.has(l.lessonId),
        isLocked: trial !== null && !trial.open.has(l.lessonId),
        streakBonusDays: l.streakBonusDays,
        isBonusLocked: l.streakBonusDays !== null && streak < l.streakBonusDays,
      })),
    })),
  });
}

/**
 * US7.18: the one "would you recommend" question once the course is complete. A paid Student who
 * finished the course answers 0–10 or skips (null); either way they are not asked again.
 */
export async function answerCourseNps(
  actor: Actor,
  raw: CourseNpsInput,
): Promise<Result<{ saved: boolean }, LearningError>> {
  const input = CourseNpsInput.parse(raw);
  const found = await accessibleCourse(actor, input.courseId);
  if (!found.ok) return found;
  const { course, trial } = found.value;
  if (trial) return err(invalidState());
  const completed = await repo.completedLessonIds(getDb(), actor.userId, course.courseId);
  if (courseProgress(orderedLessonIds(course), completed).percent < 100) return err(invalidState());
  const saved = await nps.answer(getDb(), {
    userId: actor.userId,
    courseId: course.courseId,
    score: input.score,
    answeredAt: new Date(),
  });
  return ok({ saved });
}

/** The NPS scores of some courses (skips excluded), for the instructor dashboard. */
export function courseNpsScores(courseIds: readonly string[]): Promise<Map<string, number[]>> {
  return nps.scoresOf(getDb(), courseIds);
}

/** One lesson for the player, with its neighbours, completion and (for a quiz) its questions. */
export async function getLesson(
  actor: Actor,
  raw: LessonRefInput,
): Promise<Result<LessonView, LearningError>> {
  const input = LessonRefInput.parse(raw);
  const found = await lessonOpenFor(actor, input.courseId, input.lessonId);
  if (!found.ok) return found;
  const { course } = found.value;
  const lesson = await getPublishedLesson(input.courseId, input.lessonId);
  if (!lesson.ok) return err(notFound());
  const order = orderedLessonIds(course);
  const section = course.outline.find((s) => s.sectionId === lesson.value.sectionId);
  const db = getDb();
  const completed = await repo.completedLessonIds(db, actor.userId, course.courseId);
  const isQuiz = lesson.value.kind === 'quiz';
  const needed = isQuiz ? lesson.value.streakBonusDays : null;
  const current = needed ? (await syncStreak(actor.userId)).current : 0;
  const bonusLock = needed && current < needed ? { needed, current } : null;
  const viewer =
    lesson.value.kind === 'video'
      ? {
          badge: viewerBadge(actor.userId),
          badgeSeconds: await videoBadgeSeconds(),
          showNotice: !(await notices.hasSeen(db, actor.userId, 'video_badge')),
        }
      : null;
  const questions =
    isQuiz && !bonusLock ? await repo.questions(db, lesson.value.lessonVersionId) : [];
  const attempt = isQuiz ? await repo.latestAttempt(db, actor.userId, lesson.value.lessonId) : null;
  return ok({
    courseId: course.courseId,
    courseTitleBn: course.titleBn,
    courseTitleEn: course.titleEn,
    lessonId: lesson.value.lessonId,
    kind: lesson.value.kind,
    titleBn: lesson.value.titleBn,
    titleEn: lesson.value.titleEn,
    sectionTitleBn: section?.titleBn ?? '',
    sectionTitleEn: section?.titleEn ?? '',
    number: order.indexOf(lesson.value.lessonId) + 1,
    lessonCount: order.length,
    bodyBn: lesson.value.bodyBn,
    bodyEn: lesson.value.bodyEn,
    youtubeVideoId: lesson.value.youtubeVideoId,
    isCompleted: completed.has(lesson.value.lessonId),
    ...lessonNeighbours(order, lesson.value.lessonId),
    questions: questions.map(toQuestionView),
    lastResult: attempt ? toResult(questions, attempt) : null,
    progress: courseProgress(order, completed),
    viewer,
    bonusLock,
  });
}

/** US3.12: the viewer-badge explanation was dismissed; it never shows again on any device. */
export async function dismissBadgeNotice(
  actor: Actor,
): Promise<Result<{ dismissed: true }, never>> {
  await notices.markSeen(getDb(), actor.userId, 'video_badge', new Date());
  return ok({ dismissed: true as const });
}

/** Marks a video or reading lesson done. A quiz is completed by submitting it instead. */
export async function completeLesson(
  actor: Actor,
  raw: LessonRefInput,
): Promise<Result<{ isCompleted: true }, LearningError>> {
  const input = LessonRefInput.parse(raw);
  const open = await lessonOpenFor(actor, input.courseId, input.lessonId);
  if (!open.ok) return open;
  const lesson = await getPublishedLesson(input.courseId, input.lessonId);
  if (!lesson.ok) return err(notFound());
  if (lesson.value.kind === 'quiz') return err(invalidState());
  await repo.markComplete(getDb(), {
    userId: actor.userId,
    courseId: input.courseId,
    lessonId: input.lessonId,
  });
  return ok({ isCompleted: true });
}

/** Grades a quiz on the server, records the attempt and every answer, and completes the lesson. */
export async function submitQuiz(
  actor: Actor,
  raw: SubmitQuizInput,
): Promise<Result<QuizResult, LearningError>> {
  const input = SubmitQuizInput.parse(raw);
  const open = await lessonOpenFor(actor, input.courseId, input.lessonId);
  if (!open.ok) return open;
  const lesson = await getPublishedLesson(input.courseId, input.lessonId);
  if (!lesson.ok) return err(notFound());
  if (lesson.value.kind !== 'quiz') return err(invalidState());
  // AC4.13.2: a locked streak-only bonus quiz refuses a direct submission too.
  const needed = lesson.value.streakBonusDays;
  if (needed && (await syncStreak(actor.userId)).current < needed) return err(bonusLocked());
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const questions = await repo.questions(exec, lesson.value.lessonVersionId);
    if (questions.length === 0) return err(invalidState());
    const grade = gradeQuiz(questions, input.answers);
    const course = await getPublishedCourse(input.courseId);
    const attempt = await repo.insertAttempt(exec, {
      userId: actor.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      score: grade.score,
      total: grade.total,
      answers: grade.answers.map((a) => ({
        questionId: a.questionId,
        chosenIndex: a.chosenIndex,
        isCorrect: a.isCorrect,
      })),
    });
    await repo.markComplete(exec, {
      userId: actor.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
    });
    // Mistake Vault (FR-ADP-1): every wrong answer enters the vault in the same transaction.
    await recordQuizMistakes(exec, {
      userId: actor.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      goalId: course.ok ? course.value.goal.goalId : null,
      at: attempt.submittedAt,
      wrong: grade.answers
        .filter((a) => !a.isCorrect)
        .map((a) => ({ questionId: a.questionId, chosenIndex: a.chosenIndex })),
    });
    return ok(toResult(questions, { ...grade, submittedAt: attempt.submittedAt }));
  });
}

/** The Student's active Mistake Vault items, for the dashboard's vault count. */
export async function countWrongAnswers(userId: string): Promise<number> {
  return countActiveVaultItems(userId);
}

export type QuizHistoryItem = {
  attemptId: string;
  courseId: string;
  lessonId: string;
  courseTitleBn: string;
  courseTitleEn: string;
  lessonTitleBn: string;
  lessonTitleEn: string;
  score: number;
  total: number;
  submittedAt: string;
};

/** The Student's lesson-quiz attempts, newest first, with course and lesson titles. */
export async function listMyQuizResults(actor: Actor): Promise<Result<QuizHistoryItem[], never>> {
  const rows = await repo.quizAttemptsOf(getDb(), actor.userId, 200);
  const courseIds = [...new Set(rows.map((r) => r.courseId))];
  const pages = new Map(
    await Promise.all(courseIds.map(async (id) => [id, await getPublishedCourse(id)] as const)),
  );
  return ok(
    rows.map((r) => {
      const page = pages.get(r.courseId);
      const course = page?.ok ? page.value : null;
      const lesson = course?.outline
        .flatMap((x) => x.lessons)
        .find((l) => l.lessonId === r.lessonId);
      return {
        attemptId: r.attemptId,
        courseId: r.courseId,
        lessonId: r.lessonId,
        courseTitleBn: course?.titleBn ?? '',
        courseTitleEn: course?.titleEn ?? '',
        lessonTitleBn: lesson?.titleBn ?? '',
        lessonTitleEn: lesson?.titleEn ?? '',
        score: r.score,
        total: r.total,
        submittedAt: r.submittedAt.toISOString(),
      };
    }),
  );
}
