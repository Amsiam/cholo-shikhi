// Course learning statistics (for the course's instructors and admins; the caller authorizes).
// Progress counts only the course's current published lessons, so a removed lesson never pushes a
// student past 100%.
import { getDb } from '#src/server/db.ts';
import { createLearningStatsRepository } from '../data/learning-stats.repository.ts';

const repo = createLearningStatsRepository();

export type CourseLearningStats = {
  lessonCount: number;
  /** Per student: completed lessons and last activity (lesson or quiz). */
  students: Array<{ userId: string; completed: number; lastActiveAt: string | null }>;
  completionsByLesson: Record<string, number>;
  quizzes: Array<{ lessonId: string; attempts: number; students: number; averageBps: number }>;
  hardestQuestions: Array<{
    questionId: string;
    lessonId: string;
    answers: number;
    wrong: number;
    promptBn: string;
    promptEn: string;
  }>;
};

export async function courseLearningStats(
  courseId: string,
  lessonIds: readonly string[],
): Promise<CourseLearningStats> {
  const db = getDb();
  const [progress, byLesson, lastQuiz, quizzes, hardest] = await Promise.all([
    repo.progressByStudent(db, courseId, lessonIds),
    repo.completionsByLesson(db, courseId),
    repo.lastQuizAt(db, courseId),
    repo.quizSummary(db, courseId),
    repo.hardestQuestions(db, courseId, 8),
  ]);
  const later = (a: Date | null | undefined, b: Date | null | undefined) =>
    a && b ? (a > b ? a : b) : (a ?? b ?? null);
  const ids = new Set([...progress.map((p) => p.userId), ...lastQuiz.keys()]);
  const progressOf = new Map(progress.map((p) => [p.userId, p]));
  return {
    lessonCount: lessonIds.length,
    students: [...ids].map((userId) => {
      const p = progressOf.get(userId);
      const last = later(p?.lastAt, lastQuiz.get(userId));
      return { userId, completed: p?.completed ?? 0, lastActiveAt: last?.toISOString() ?? null };
    }),
    completionsByLesson: Object.fromEntries(lessonIds.map((id) => [id, byLesson.get(id) ?? 0])),
    quizzes,
    hardestQuestions: hardest,
  };
}
