// Lesson progress, quiz questions and quiz attempts. Every Student read and write is scoped by the
// caller's user ID; the service has already checked the enrolment for the course.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  lessonProgress,
  quizAttempt,
  quizAttemptAnswer,
  quizQuestion,
} from '#src/server/schema/index.ts';

export type QuestionRow = typeof quizQuestion.$inferSelect;

export function createLearningRepository() {
  return {
    /** When the Student last finished a lesson or took a quiz, per course. */
    async lastActivityByCourse(exec: Executor, userId: string): Promise<Map<string, Date>> {
      const result = await exec.execute(sql`
        select course_id, max(at) as at from (
          select course_id, completed_at as at from lesson_progress where user_id = ${userId}
          union all
          select course_id, submitted_at as at from quiz_attempt where user_id = ${userId}
        ) a group by course_id`);
      const rows = result.rows as Array<{ course_id: string; at: string | Date }>;
      return new Map(rows.map((r) => [r.course_id, new Date(r.at)]));
    },

    /** The Student's lesson-quiz attempts, newest first. */
    async quizAttemptsOf(exec: Executor, userId: string, limit: number) {
      return exec
        .select()
        .from(quizAttempt)
        .where(eq(quizAttempt.userId, userId))
        .orderBy(desc(quizAttempt.submittedAt))
        .limit(limit);
    },

    async completedLessonIds(
      exec: Executor,
      userId: string,
      courseId: string,
    ): Promise<Set<string>> {
      const rows = await exec
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.courseId, courseId)))
        .limit(5000);
      return new Set(rows.map((r) => r.lessonId));
    },

    /** Idempotent: completing a lesson twice keeps the first completion time. */
    async markComplete(
      exec: Executor,
      input: { userId: string; courseId: string; lessonId: string },
    ): Promise<void> {
      await exec.insert(lessonProgress).values(input).onConflictDoNothing();
    },

    /** The questions of one lesson version (the live one: what the Student answers). */
    async questions(exec: Executor, lessonVersionId: string): Promise<QuestionRow[]> {
      return exec
        .select()
        .from(quizQuestion)
        .where(eq(quizQuestion.lessonVersionId, lessonVersionId))
        .orderBy(asc(quizQuestion.position))
        .limit(200);
    },

    async insertAttempt(
      exec: Executor,
      input: {
        userId: string;
        courseId: string;
        lessonId: string;
        score: number;
        total: number;
        answers: Array<{ questionId: string; chosenIndex: number | null; isCorrect: boolean }>;
      },
    ): Promise<{ attemptId: string; submittedAt: Date }> {
      const rows = await exec
        .insert(quizAttempt)
        .values({
          userId: input.userId,
          courseId: input.courseId,
          lessonId: input.lessonId,
          score: input.score,
          total: input.total,
        })
        .returning({ attemptId: quizAttempt.attemptId, submittedAt: quizAttempt.submittedAt });
      const attempt = rows[0] as { attemptId: string; submittedAt: Date };
      if (input.answers.length > 0) {
        await exec
          .insert(quizAttemptAnswer)
          .values(input.answers.map((a) => ({ ...a, attemptId: attempt.attemptId })));
      }
      return attempt;
    },

    async latestAttempt(
      exec: Executor,
      userId: string,
      lessonId: string,
    ): Promise<{
      attemptId: string;
      score: number;
      total: number;
      submittedAt: Date;
      answers: Array<{ questionId: string; chosenIndex: number | null; isCorrect: boolean }>;
    } | null> {
      const rows = await exec
        .select()
        .from(quizAttempt)
        .where(and(eq(quizAttempt.userId, userId), eq(quizAttempt.lessonId, lessonId)))
        .orderBy(desc(quizAttempt.submittedAt))
        .limit(1);
      const attempt = rows[0];
      if (!attempt) return null;
      const answers = await exec
        .select({
          questionId: quizAttemptAnswer.questionId,
          chosenIndex: quizAttemptAnswer.chosenIndex,
          isCorrect: quizAttemptAnswer.isCorrect,
        })
        .from(quizAttemptAnswer)
        .where(eq(quizAttemptAnswer.attemptId, attempt.attemptId));
      return {
        attemptId: attempt.attemptId,
        score: attempt.score,
        total: attempt.total,
        submittedAt: attempt.submittedAt,
        answers,
      };
    },

    /** How many quiz answers the Student got wrong overall: the future Mistake Vault's size. */
    async wrongAnswerCount(exec: Executor, userId: string): Promise<number> {
      const rows = await exec
        .select({ n: sql<number>`count(distinct ${quizAttemptAnswer.questionId})::int` })
        .from(quizAttemptAnswer)
        .innerJoin(quizAttempt, eq(quizAttempt.attemptId, quizAttemptAnswer.attemptId))
        .where(and(eq(quizAttempt.userId, userId), eq(quizAttemptAnswer.isCorrect, false)));
      return rows[0]?.n ?? 0;
    },
  };
}

export type LearningRepository = ReturnType<typeof createLearningRepository>;
