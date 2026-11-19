// Course statistics for instructors and admins: aggregate reads over lesson progress and quiz
// attempts. Only counts and averages leave this file, except the per-student progress rows that
// feed the course's own student list.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  lessonProgress,
  quizAttempt,
  quizAttemptAnswer,
  quizQuestion,
} from '#src/server/schema/index.ts';

const num = (v: string | number | null | undefined) => Number(v ?? 0);

export function createLearningStatsRepository() {
  return {
    /** How many of the course's current lessons each student has completed, and when last active. */
    async progressByStudent(exec: Executor, courseId: string, lessonIds: readonly string[]) {
      if (lessonIds.length === 0) return [];
      const rows = await exec
        .select({
          userId: lessonProgress.userId,
          completed: sql<string>`count(*)`,
          lastAt: sql<Date>`max(${lessonProgress.completedAt})`,
        })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.courseId, courseId),
            inArray(lessonProgress.lessonId, [...lessonIds]),
          ),
        )
        .groupBy(lessonProgress.userId);
      return rows.map((r) => ({
        userId: r.userId,
        completed: num(r.completed),
        lastAt: r.lastAt ? new Date(r.lastAt) : null,
      }));
    },

    /** How many students completed each lesson. */
    async completionsByLesson(exec: Executor, courseId: string) {
      const rows = await exec
        .select({ lessonId: lessonProgress.lessonId, students: sql<string>`count(*)` })
        .from(lessonProgress)
        .where(eq(lessonProgress.courseId, courseId))
        .groupBy(lessonProgress.lessonId);
      return new Map(rows.map((r) => [r.lessonId, num(r.students)]));
    },

    /** Last quiz activity per student. */
    async lastQuizAt(exec: Executor, courseId: string) {
      const rows = await exec
        .select({ userId: quizAttempt.userId, lastAt: sql<Date>`max(${quizAttempt.submittedAt})` })
        .from(quizAttempt)
        .where(eq(quizAttempt.courseId, courseId))
        .groupBy(quizAttempt.userId);
      return new Map(rows.map((r) => [r.userId, r.lastAt ? new Date(r.lastAt) : null]));
    },

    /** Per quiz lesson: attempts, students and the average score (percent ×100, integer). */
    async quizSummary(exec: Executor, courseId: string) {
      const rows = await exec
        .select({
          lessonId: quizAttempt.lessonId,
          attempts: sql<string>`count(*)`,
          students: sql<string>`count(distinct ${quizAttempt.userId})`,
          avgBps: sql<string>`coalesce(round(avg(${quizAttempt.score}::numeric * 10000 / nullif(${quizAttempt.total}, 0))), 0)`,
        })
        .from(quizAttempt)
        .where(eq(quizAttempt.courseId, courseId))
        .groupBy(quizAttempt.lessonId);
      return rows.map((r) => ({
        lessonId: r.lessonId,
        attempts: num(r.attempts),
        students: num(r.students),
        averageBps: num(r.avgBps),
      }));
    },

    /** The questions most often answered wrong (at least a few answers each). */
    async hardestQuestions(exec: Executor, courseId: string, limit: number) {
      const wrong = sql<string>`count(*) filter (where not ${quizAttemptAnswer.isCorrect})`;
      const rows = await exec
        .select({
          questionId: quizAttemptAnswer.questionId,
          lessonId: quizAttempt.lessonId,
          answers: sql<string>`count(*)`,
          wrong,
          promptBn: sql<string>`max(${quizQuestion.promptBn})`,
          promptEn: sql<string>`max(${quizQuestion.promptEn})`,
        })
        .from(quizAttemptAnswer)
        .innerJoin(quizAttempt, eq(quizAttempt.attemptId, quizAttemptAnswer.attemptId))
        .innerJoin(quizQuestion, eq(quizQuestion.questionId, quizAttemptAnswer.questionId))
        .where(eq(quizAttempt.courseId, courseId))
        .groupBy(quizAttemptAnswer.questionId, quizAttempt.lessonId)
        .having(sql`count(*) >= 3 and ${wrong} > 0`)
        .orderBy(sql`${wrong}::numeric / count(*) desc`, quizAttemptAnswer.questionId)
        .limit(limit);
      return rows.map((r) => ({
        questionId: r.questionId,
        lessonId: r.lessonId,
        answers: num(r.answers),
        wrong: num(r.wrong),
        promptBn: r.promptBn,
        promptEn: r.promptEn,
      }));
    },
  };
}
