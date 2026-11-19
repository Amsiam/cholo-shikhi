// A Student's own activity in one course, for a payment dispute's evidence pack (US9.3).
import { and, asc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { lessonProgress, quizAttempt } from '#src/server/schema/index.ts';

const LIMIT = 500;

export function createEvidenceRepository() {
  return {
    async completions(exec: Executor, userId: string, courseId: string) {
      return exec
        .select({ lessonId: lessonProgress.lessonId, completedAt: lessonProgress.completedAt })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.courseId, courseId)))
        .orderBy(asc(lessonProgress.completedAt))
        .limit(LIMIT);
    },
    async quizAttempts(exec: Executor, userId: string, courseId: string) {
      return exec
        .select({
          lessonId: quizAttempt.lessonId,
          score: quizAttempt.score,
          total: quizAttempt.total,
          submittedAt: quizAttempt.submittedAt,
        })
        .from(quizAttempt)
        .where(and(eq(quizAttempt.userId, userId), eq(quizAttempt.courseId, courseId)))
        .orderBy(asc(quizAttempt.submittedAt))
        .limit(LIMIT);
    },
  };
}
