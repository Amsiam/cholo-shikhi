// Fraud review flags (Admin; the services check the role). Holds read open flags only.
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { fraudFlag } from '#src/server/schema/index.ts';

export type FlagRow = typeof fraudFlag.$inferSelect;
type Kind = FlagRow['kind'];

export function createFraudRepository() {
  return {
    async open(exec: Executor, kind?: Kind): Promise<FlagRow[]> {
      return exec
        .select()
        .from(fraudFlag)
        .where(
          kind
            ? and(eq(fraudFlag.state, 'open'), eq(fraudFlag.kind, kind))
            : eq(fraudFlag.state, 'open'),
        )
        .orderBy(fraudFlag.flaggedAt)
        .limit(500);
    },
    async recentlyDecided(exec: Executor, limit: number): Promise<FlagRow[]> {
      return exec
        .select()
        .from(fraudFlag)
        .where(ne(fraudFlag.state, 'open'))
        .orderBy(desc(fraudFlag.decidedAt))
        .limit(limit);
    },
    async banned(exec: Executor, limit: number): Promise<FlagRow[]> {
      return exec
        .select()
        .from(fraudFlag)
        .where(eq(fraudFlag.state, 'banned'))
        .orderBy(desc(fraudFlag.decidedAt))
        .limit(limit);
    },
    async openOf(exec: Executor, userId: string, kind: Kind): Promise<FlagRow | null> {
      const rows = await exec
        .select()
        .from(fraudFlag)
        .where(
          and(eq(fraudFlag.userId, userId), eq(fraudFlag.kind, kind), eq(fraudFlag.state, 'open')),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async openUsersOf(exec: Executor, userIds: readonly string[], kind: Kind): Promise<string[]> {
      if (userIds.length === 0) return [];
      const rows = await exec
        .select({ userId: fraudFlag.userId })
        .from(fraudFlag)
        .where(
          and(
            inArray(fraudFlag.userId, [...userIds]),
            eq(fraudFlag.kind, kind),
            eq(fraudFlag.state, 'open'),
          ),
        );
      return rows.map((r) => r.userId);
    },
    async forUpdate(exec: Executor, flagId: string): Promise<FlagRow | null> {
      const rows = await exec
        .select()
        .from(fraudFlag)
        .where(eq(fraudFlag.flagId, flagId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(exec: Executor, row: typeof fraudFlag.$inferInsert): Promise<FlagRow> {
      const [created] = await exec.insert(fraudFlag).values(row).returning();
      return created as FlagRow;
    },
    async decide(
      exec: Executor,
      flagId: string,
      patch: Pick<FlagRow, 'state' | 'decisionReason' | 'decidedBy' | 'decidedAt'>,
    ): Promise<void> {
      await exec.update(fraudFlag).set(patch).where(eq(fraudFlag.flagId, flagId));
    },
    async reinstate(
      exec: Executor,
      flagId: string,
      patch: Pick<FlagRow, 'reinstateReason' | 'reinstatedBy' | 'reinstatedAt'>,
    ): Promise<void> {
      await exec
        .update(fraudFlag)
        .set({ ...patch, state: 'reinstated' })
        .where(eq(fraudFlag.flagId, flagId));
    },
  };
}
