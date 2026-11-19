// Exam and attempt reads and writes (U4 Assessment). Attempt queries are always scoped by the
// caller's user ID, so one Student never reads or changes another's attempt.
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { bankQuestion, exam, examAttempt, topic } from '#src/server/schema/index.ts';
import type { BlueprintRow } from '../domain/exam.ts';

export type ExamRow = typeof exam.$inferSelect;
export type AttemptRow = typeof examAttempt.$inferSelect;

export function createExamRepository() {
  return {
    async examById(exec: Executor, examId: string): Promise<ExamRow | null> {
      const rows = await exec.select().from(exam).where(eq(exam.examId, examId)).limit(1);
      return rows[0] ?? null;
    },
    async examForUpdate(exec: Executor, examId: string): Promise<ExamRow | null> {
      const rows = await exec
        .select()
        .from(exam)
        .where(eq(exam.examId, examId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    /** Staff exams (not custom): all for an Admin, own for an Instructor. */
    async staffExams(exec: Executor, createdBy: string | null): Promise<ExamRow[]> {
      return exec
        .select()
        .from(exam)
        .where(
          and(sql`${exam.kind} <> 'custom'`, createdBy ? eq(exam.createdBy, createdBy) : undefined),
        )
        .orderBy(desc(exam.updatedAt))
        .limit(200);
    },
    /**
     * What a Student may take: published goal-wide mock and live exams of their Goal, exams attached
     * to courses they can open, and their own custom ones.
     */
    async studentExams(
      exec: Executor,
      userId: string,
      goalId: string | null,
      courseIds: readonly string[],
      grantedIds: readonly string[] = [],
    ): Promise<ExamRow[]> {
      return exec
        .select()
        .from(exam)
        .where(
          and(
            eq(exam.status, 'published'),
            or(
              goalId
                ? and(eq(exam.goalId, goalId), isNull(exam.courseId), sql`${exam.kind} <> 'custom'`)
                : undefined,
              courseIds.length > 0 ? inArray(exam.courseId, [...courseIds]) : undefined,
              grantedIds.length > 0 ? inArray(exam.examId, [...grantedIds]) : undefined,
              and(eq(exam.kind, 'custom'), eq(exam.createdBy, userId)),
            ),
          ),
        )
        .orderBy(asc(exam.startsAt), desc(exam.publishedAt))
        .limit(200);
    },
    async examByPackageVersion(exec: Executor, versionId: string): Promise<ExamRow | null> {
      const rows = await exec
        .select()
        .from(exam)
        .where(eq(exam.packageVersionId, versionId))
        .limit(1);
      return rows[0] ?? null;
    },
    /** Inserts a package exam once; a concurrent first open keeps the earlier row. */
    async insertPackageExam(exec: Executor, row: Omit<typeof exam.$inferInsert, 'examId'>) {
      const inserted = await exec.insert(exam).values(row).onConflictDoNothing().returning();
      if (inserted[0]) return inserted[0];
      const again = await exec
        .select()
        .from(exam)
        .where(eq(exam.packageVersionId, row.packageVersionId as string))
        .limit(1);
      return again[0] as ExamRow;
    },
    async insertExam(
      exec: Executor,
      row: Omit<typeof exam.$inferInsert, 'examId'>,
    ): Promise<ExamRow> {
      const [created] = await exec.insert(exam).values(row).returning();
      return created as ExamRow;
    },
    async updateExam(
      exec: Executor,
      examId: string,
      expectedVersion: number,
      patch: Partial<typeof exam.$inferInsert>,
    ): Promise<ExamRow | null> {
      const rows = await exec
        .update(exam)
        .set({ ...patch, version: sql`${exam.version} + 1`, updatedAt: new Date() })
        .where(and(eq(exam.examId, examId), eq(exam.version, expectedVersion)))
        .returning();
      return rows[0] ?? null;
    },

    /** IDs of a topic and its sub-topics. */
    async topicFamily(exec: Executor, topicId: string): Promise<string[]> {
      const rows = await exec
        .select({ id: topic.topicId })
        .from(topic)
        .where(or(eq(topic.topicId, topicId), eq(topic.parentTopicId, topicId)));
      return rows.map((r) => r.id);
    },
    /** How many published questions a blueprint row can draw from. */
    async available(
      exec: Executor,
      topicIds: readonly string[],
      difficulty: BlueprintRow['difficulty'],
    ) {
      if (topicIds.length === 0) return 0;
      const rows = await exec
        .select({ n: sql<number>`count(*)::int` })
        .from(bankQuestion)
        .where(
          and(
            inArray(bankQuestion.topicId, [...topicIds]),
            eq(bankQuestion.status, 'published'),
            difficulty ? eq(bankQuestion.effectiveDifficulty, difficulty) : undefined,
          ),
        );
      return rows[0]?.n ?? 0;
    },
    /** Random published questions for one blueprint row, excluding those already chosen. */
    async pick(
      exec: Executor,
      topicIds: readonly string[],
      difficulty: BlueprintRow['difficulty'],
      count: number,
      exclude: readonly string[],
    ): Promise<string[]> {
      if (topicIds.length === 0 || count === 0) return [];
      const rows = await exec
        .select({ id: bankQuestion.questionId })
        .from(bankQuestion)
        .where(
          and(
            inArray(bankQuestion.topicId, [...topicIds]),
            eq(bankQuestion.status, 'published'),
            difficulty ? eq(bankQuestion.effectiveDifficulty, difficulty) : undefined,
            exclude.length > 0
              ? sql`${bankQuestion.questionId} not in (${sql.join(
                  exclude.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : undefined,
          ),
        )
        .orderBy(sql`random()`)
        .limit(count);
      return rows.map((r) => r.id);
    },

    /** Staff exams (not drafts, not custom) that contain any of these questions. */
    async examsContaining(exec: Executor, questionIds: readonly string[]): Promise<ExamRow[]> {
      if (questionIds.length === 0) return [];
      return exec
        .select()
        .from(exam)
        .where(
          and(
            sql`${exam.kind} <> 'custom'`,
            sql`${exam.status} <> 'draft'`,
            sql`${exam.questionIds} && ARRAY[${sql.join(
              questionIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}]`,
          ),
        );
    },

    // ------------------------------------------------------------- attempts
    async attemptsOf(
      exec: Executor,
      userId: string,
      examIds: readonly string[],
    ): Promise<AttemptRow[]> {
      if (examIds.length === 0) return [];
      return exec
        .select()
        .from(examAttempt)
        .where(and(eq(examAttempt.userId, userId), inArray(examAttempt.examId, [...examIds])))
        .orderBy(desc(examAttempt.startedAt));
    },
    async attemptForUpdate(exec: Executor, userId: string, attemptId: string) {
      const rows = await exec
        .select()
        .from(examAttempt)
        .where(and(eq(examAttempt.attemptId, attemptId), eq(examAttempt.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async attemptOf(exec: Executor, userId: string, attemptId: string) {
      const rows = await exec
        .select()
        .from(examAttempt)
        .where(and(eq(examAttempt.attemptId, attemptId), eq(examAttempt.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertAttempt(exec: Executor, row: Omit<typeof examAttempt.$inferInsert, 'attemptId'>) {
      const [created] = await exec.insert(examAttempt).values(row).returning();
      return created as AttemptRow;
    },
    async updateAttempt(
      exec: Executor,
      attemptId: string,
      patch: Partial<typeof examAttempt.$inferInsert>,
    ) {
      const rows = await exec
        .update(examAttempt)
        .set(patch)
        .where(eq(examAttempt.attemptId, attemptId))
        .returning();
      return rows[0] as AttemptRow;
    },
    /** A Student's submitted attempts with their exams, newest first. */
    async submittedOf(exec: Executor, userId: string, limit: number) {
      return exec
        .select({ a: examAttempt, e: exam })
        .from(examAttempt)
        .innerJoin(exam, eq(exam.examId, examAttempt.examId))
        .where(and(eq(examAttempt.userId, userId), isNotNull(examAttempt.submittedAt)))
        .orderBy(desc(examAttempt.submittedAt))
        .limit(limit);
    },

    /** A Student's unsubmitted attempts (to close any whose time ran out). */
    async openAttemptsOf(exec: Executor, userId: string): Promise<AttemptRow[]> {
      return exec
        .select()
        .from(examAttempt)
        .where(and(eq(examAttempt.userId, userId), isNull(examAttempt.submittedAt)));
    },
    /** Submitted but unsettled attempts of a Student. */
    async unsettledOf(exec: Executor, userId: string): Promise<AttemptRow[]> {
      return exec
        .select()
        .from(examAttempt)
        .where(
          and(
            eq(examAttempt.userId, userId),
            isNotNull(examAttempt.submittedAt),
            isNull(examAttempt.settledAt),
          ),
        );
    },
    /** Every submitted attempt of an exam, for the merit list. */
    async submittedAttempts(exec: Executor, examId: string) {
      return exec
        .select({
          attemptId: examAttempt.attemptId,
          userId: examAttempt.userId,
          scoreX100: examAttempt.scoreX100,
          startedAt: examAttempt.startedAt,
          submittedAt: examAttempt.submittedAt,
        })
        .from(examAttempt)
        .where(and(eq(examAttempt.examId, examId), isNotNull(examAttempt.submittedAt)));
    },
    async attemptCounts(exec: Executor, examIds: readonly string[]) {
      if (examIds.length === 0) return [];
      return exec
        .select({
          examId: examAttempt.examId,
          n: sql<number>`count(*)::int`,
          avg: sql<number | null>`avg(${examAttempt.scoreX100})::float`,
        })
        .from(examAttempt)
        .where(and(inArray(examAttempt.examId, [...examIds]), isNotNull(examAttempt.submittedAt)))
        .groupBy(examAttempt.examId);
    },
  };
}
