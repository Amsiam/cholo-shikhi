// Question bank reads and writes (U4 Assessment).
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { bankAnswer, bankQuestion, subject, subjectGoal, topic } from '#src/server/schema/index.ts';
import type { BankStatus, CleanBankQuestion, Difficulty } from '../domain/bank.ts';

export type BankQuestionRow = typeof bankQuestion.$inferSelect;
export type TopicRow = typeof topic.$inferSelect;
export type SubjectRow = typeof subject.$inferSelect;

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createBankRepository() {
  return {
    // ------------------------------------------------------------- taxonomy
    async subjects(exec: Executor): Promise<SubjectRow[]> {
      return exec.select().from(subject).orderBy(asc(subject.sortOrder), asc(subject.nameEn));
    },
    async subjectGoals(exec: Executor) {
      return exec.select().from(subjectGoal);
    },
    async subjectsOfGoal(exec: Executor, goalId: string): Promise<SubjectRow[]> {
      return exec
        .select({ s: subject })
        .from(subject)
        .innerJoin(subjectGoal, eq(subjectGoal.subjectId, subject.subjectId))
        .where(and(eq(subjectGoal.goalId, goalId), eq(subject.isActive, true)))
        .orderBy(asc(subject.sortOrder), asc(subject.nameEn))
        .then((rows) => rows.map((r) => r.s));
    },
    async topics(exec: Executor, subjectIds?: readonly string[]): Promise<TopicRow[]> {
      return exec
        .select()
        .from(topic)
        .where(subjectIds ? inArray(topic.subjectId, [...subjectIds]) : undefined)
        .orderBy(asc(topic.sortOrder), asc(topic.nameEn));
    },
    async topicById(exec: Executor, topicId: string): Promise<TopicRow | null> {
      const rows = await exec.select().from(topic).where(eq(topic.topicId, topicId)).limit(1);
      return rows[0] ?? null;
    },
    async saveSubject(
      exec: Executor,
      row: {
        subjectId?: string;
        nameBn: string;
        nameEn: string;
        sortOrder: number;
        isActive: boolean;
      },
    ): Promise<string> {
      if (row.subjectId) {
        await exec.update(subject).set(row).where(eq(subject.subjectId, row.subjectId));
        return row.subjectId;
      }
      const [created] = await exec.insert(subject).values(row).returning({ id: subject.subjectId });
      return (created as { id: string }).id;
    },
    async setSubjectGoals(exec: Executor, subjectId: string, goalIds: readonly string[]) {
      await exec.delete(subjectGoal).where(eq(subjectGoal.subjectId, subjectId));
      if (goalIds.length > 0)
        await exec.insert(subjectGoal).values(goalIds.map((goalId) => ({ subjectId, goalId })));
    },
    async saveTopic(
      exec: Executor,
      row: {
        topicId?: string;
        subjectId: string;
        parentTopicId: string | null;
        nameBn: string;
        nameEn: string;
        sortOrder: number;
      },
    ): Promise<string> {
      if (row.topicId) {
        await exec.update(topic).set(row).where(eq(topic.topicId, row.topicId));
        return row.topicId;
      }
      const [created] = await exec.insert(topic).values(row).returning({ id: topic.topicId });
      return (created as { id: string }).id;
    },

    // ------------------------------------------------------------- questions
    async questionById(exec: Executor, questionId: string): Promise<BankQuestionRow | null> {
      const rows = await exec
        .select()
        .from(bankQuestion)
        .where(eq(bankQuestion.questionId, questionId))
        .limit(1);
      return rows[0] ?? null;
    },
    async questionsByIds(exec: Executor, ids: readonly string[]): Promise<BankQuestionRow[]> {
      if (ids.length === 0) return [];
      return exec
        .select()
        .from(bankQuestion)
        .where(inArray(bankQuestion.questionId, [...ids]));
    },
    async listQuestions(
      exec: Executor,
      filter: {
        topicIds?: readonly string[];
        difficulty?: Difficulty;
        effectiveDifficulty?: Difficulty;
        status?: BankStatus;
        authorId?: string;
        query?: string;
      },
      page: number,
      pageSize: number,
    ) {
      const where = and(
        filter.topicIds ? inArray(bankQuestion.topicId, [...filter.topicIds]) : undefined,
        filter.difficulty ? eq(bankQuestion.effectiveDifficulty, filter.difficulty) : undefined,
        filter.status ? eq(bankQuestion.status, filter.status) : undefined,
        filter.authorId ? eq(bankQuestion.authorId, filter.authorId) : undefined,
        filter.query
          ? or(
              ilike(bankQuestion.promptBn, `%${escapeLike(filter.query)}%`),
              ilike(bankQuestion.promptEn, `%${escapeLike(filter.query)}%`),
              ilike(bankQuestion.sourceNote, `%${escapeLike(filter.query)}%`),
            )
          : undefined,
      );
      const [rows, total] = await Promise.all([
        exec
          .select()
          .from(bankQuestion)
          .where(where)
          .orderBy(desc(bankQuestion.updatedAt), asc(bankQuestion.questionId))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        exec.select({ n: sql<number>`count(*)::int` }).from(bankQuestion).where(where),
      ]);
      return { rows, total: total[0]?.n ?? 0 };
    },
    async insertQuestion(
      exec: Executor,
      row: CleanBankQuestion & {
        topicId: string;
        difficulty: Difficulty;
        status: BankStatus;
        authorId: string;
      },
    ): Promise<BankQuestionRow> {
      const [created] = await exec
        .insert(bankQuestion)
        .values({ ...row, effectiveDifficulty: row.difficulty })
        .returning();
      return created as BankQuestionRow;
    },
    /** US4.7: a past-paper question, unless one with the same import key exists (then null). */
    async insertImported(
      exec: Executor,
      row: CleanBankQuestion & {
        topicId: string;
        difficulty: Difficulty;
        authorId: string;
        rightsStatus: 'public_domain' | 'rights_cleared';
        importKey: string;
      },
    ): Promise<string | null> {
      const now = new Date();
      const rows = await exec
        .insert(bankQuestion)
        .values({
          ...row,
          effectiveDifficulty: row.difficulty,
          isPastPaper: true,
          status: 'published',
          reviewedBy: row.authorId,
          reviewedAt: now,
        })
        .onConflictDoNothing({ target: bankQuestion.importKey })
        .returning({ questionId: bankQuestion.questionId });
      return rows[0]?.questionId ?? null;
    },
    async updateQuestion(
      exec: Executor,
      questionId: string,
      expectedVersion: number,
      patch: Partial<CleanBankQuestion> & {
        topicId?: string;
        difficulty?: Difficulty;
        effectiveDifficulty?: Difficulty;
        status?: BankStatus;
        reviewedBy?: string | null;
        reviewedAt?: Date | null;
        reviewNote?: string | null;
      },
    ): Promise<BankQuestionRow | null> {
      const rows = await exec
        .update(bankQuestion)
        .set({ ...patch, version: sql`${bankQuestion.version} + 1`, updatedAt: new Date() })
        .where(
          and(eq(bankQuestion.questionId, questionId), eq(bankQuestion.version, expectedVersion)),
        )
        .returning();
      return rows[0] ?? null;
    },
    /** Published counts per topic and difficulty (practice catalog). */
    async publishedCounts(exec: Executor, topicIds: readonly string[]) {
      if (topicIds.length === 0) return [];
      return exec
        .select({
          topicId: bankQuestion.topicId,
          difficulty: bankQuestion.effectiveDifficulty,
          n: sql<number>`count(*)::int`,
        })
        .from(bankQuestion)
        .where(
          and(inArray(bankQuestion.topicId, [...topicIds]), eq(bankQuestion.status, 'published')),
        )
        .groupBy(bankQuestion.topicId, bankQuestion.effectiveDifficulty);
    },
    /** Published questions for practice, least recently answered by this Student first, then random. */
    async practiceQuestions(
      exec: Executor,
      userId: string,
      topicIds: readonly string[],
      difficulty: Difficulty | null,
      limit: number,
    ): Promise<BankQuestionRow[]> {
      const lastSeen = sql`(select max(a.answered_at) from bank_answer a where a.user_id = ${userId} and a.question_id = ${bankQuestion.questionId})`;
      return exec
        .select()
        .from(bankQuestion)
        .where(
          and(
            inArray(bankQuestion.topicId, [...topicIds]),
            eq(bankQuestion.status, 'published'),
            difficulty ? eq(bankQuestion.effectiveDifficulty, difficulty) : undefined,
          ),
        )
        .orderBy(sql`${lastSeen} asc nulls first`, sql`random()`)
        .limit(limit);
    },
    /** A different published question on the same topic and difficulty (Mistake Vault similarity). */
    async similarQuestion(
      exec: Executor,
      q: { questionId: string; topicId: string; difficulty: Difficulty },
      excludeIds: readonly string[],
    ): Promise<BankQuestionRow | null> {
      const rows = await exec
        .select()
        .from(bankQuestion)
        .where(
          and(
            eq(bankQuestion.topicId, q.topicId),
            eq(bankQuestion.effectiveDifficulty, q.difficulty),
            eq(bankQuestion.status, 'published'),
            ne(bankQuestion.questionId, q.questionId),
            excludeIds.length > 0
              ? sql`${bankQuestion.questionId} not in (${sql.join(
                  excludeIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : undefined,
          ),
        )
        .orderBy(sql`random()`)
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Records a practice answer. A Student's first attempt at a question also updates its measured
     * difficulty; the question row is locked so concurrent answers count once each.
     */
    async recordAnswer(
      exec: Executor,
      row: { userId: string; questionId: string; chosenIndex: number; isCorrect: boolean },
      recompute: (q: BankQuestionRow, attempts: number, correct: number) => Difficulty,
    ): Promise<void> {
      const [q] = await exec
        .select()
        .from(bankQuestion)
        .where(eq(bankQuestion.questionId, row.questionId))
        .for('update')
        .limit(1);
      const seen = await exec
        .select({ id: bankAnswer.bankAnswerId })
        .from(bankAnswer)
        .where(and(eq(bankAnswer.userId, row.userId), eq(bankAnswer.questionId, row.questionId)))
        .limit(1);
      await exec.insert(bankAnswer).values(row);
      if (!q || seen.length > 0) return;
      const attempts = q.firstAttempts + 1;
      const correct = q.firstCorrect + (row.isCorrect ? 1 : 0);
      await exec
        .update(bankQuestion)
        .set({
          firstAttempts: attempts,
          firstCorrect: correct,
          effectiveDifficulty: recompute(q, attempts, correct),
        })
        .where(eq(bankQuestion.questionId, row.questionId));
    },
    /** Root topics only (sub-topics have a parent). */
    rootFilter: isNull(topic.parentTopicId),
  };
}
