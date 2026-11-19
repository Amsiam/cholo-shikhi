// Mistake Vault reads and writes. Every query is scoped by the caller's user ID, so one Student never
// reads or answers another's vault (object-level ownership in the query).
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { quizQuestion, vaultAnswer, vaultItem } from '#src/server/schema/index.ts';
import type { VaultItemState } from '../domain/vault.ts';

export type VaultItemRow = typeof vaultItem.$inferSelect;

const toState = (r: VaultItemRow): VaultItemState => ({
  status: r.status,
  correctRun: r.correctRun,
  wrongCount: r.wrongCount,
  lastWrongAt: r.lastWrongAt,
  lastPractisedAt: r.lastPractisedAt,
  masteredAt: r.masteredAt,
});

export function createVaultRepository() {
  return {
    toState,

    async itemsOf(exec: Executor, userId: string): Promise<VaultItemRow[]> {
      return exec.select().from(vaultItem).where(eq(vaultItem.userId, userId));
    },

    async itemForUpdate(exec: Executor, userId: string, questionId: string) {
      const rows = await exec
        .select()
        .from(vaultItem)
        .where(and(eq(vaultItem.userId, userId), eq(vaultItem.questionId, questionId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },

    async itemsForUpdate(exec: Executor, userId: string, questionIds: readonly string[]) {
      if (questionIds.length === 0) return [];
      return exec
        .select()
        .from(vaultItem)
        .where(and(eq(vaultItem.userId, userId), inArray(vaultItem.questionId, [...questionIds])))
        .for('update');
    },

    async upsert(
      exec: Executor,
      row: {
        userId: string;
        questionId: string;
        source: 'lesson' | 'bank';
        lessonId: string | null;
        courseId: string | null;
        topicId: string | null;
        difficulty: string | null;
        goalId: string | null;
        lastWrongChoice: number | null;
      } & VaultItemState & { firstWrongAt: Date },
    ): Promise<void> {
      await exec
        .insert(vaultItem)
        .values(row)
        .onConflictDoUpdate({
          target: [vaultItem.userId, vaultItem.questionId],
          set: {
            status: row.status,
            correctRun: row.correctRun,
            wrongCount: row.wrongCount,
            lastWrongAt: row.lastWrongAt,
            lastPractisedAt: row.lastPractisedAt,
            masteredAt: row.masteredAt,
            lastWrongChoice: row.lastWrongChoice,
            goalId: row.goalId,
          },
        });
    },

    async insertAnswer(
      exec: Executor,
      row: { userId: string; questionId: string; chosenIndex: number; isCorrect: boolean },
    ): Promise<void> {
      await exec.insert(vaultAnswer).values(row);
    },

    async questionsByIds(exec: Executor, questionIds: readonly string[]) {
      if (questionIds.length === 0) return [];
      return exec
        .select()
        .from(quizQuestion)
        .where(inArray(quizQuestion.questionId, [...questionIds]));
    },

    /** Active question-bank items of these Students (battle questions from their vaults). */
    async activeBankItems(exec: Executor, userIds: readonly string[]) {
      if (userIds.length === 0) return [];
      return exec
        .select({ questionId: vaultItem.questionId, topicId: vaultItem.topicId })
        .from(vaultItem)
        .where(
          and(
            inArray(vaultItem.userId, [...userIds]),
            eq(vaultItem.source, 'bank'),
            eq(vaultItem.status, 'active'),
          ),
        );
    },

    async answeredToday(exec: Executor, userId: string, since: Date): Promise<number> {
      const rows = await exec
        .select({ n: sql<number>`count(*)::int` })
        .from(vaultAnswer)
        .where(and(eq(vaultAnswer.userId, userId), sql`${vaultAnswer.answeredAt} >= ${since}`));
      return rows[0]?.n ?? 0;
    },

    async recentAnswers(exec: Executor, userId: string, limit: number) {
      return exec
        .select()
        .from(vaultAnswer)
        .where(eq(vaultAnswer.userId, userId))
        .orderBy(desc(vaultAnswer.answeredAt))
        .limit(limit);
    },
  };
}
