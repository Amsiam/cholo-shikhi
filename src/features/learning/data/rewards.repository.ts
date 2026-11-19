// Streak-token ledger, streak-shields and extra qualifying activity. Every query is scoped by the
// Student's own user ID. Token changes lock the Student's account row, so concurrent requests (two
// tabs) are applied one after the other and the balance can never go below 0.
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  streakActivity,
  streakShield,
  type TokenReason,
  tokenAccount,
  tokenEntry,
} from '#src/server/schema/index.ts';

export type TokenEntryRow = typeof tokenEntry.$inferSelect;
export type ShieldRow = typeof streakShield.$inferSelect;

export type TokenChange =
  | { applied: true; balance: number }
  | { applied: false; reason: 'already_applied' | 'insufficient'; balance: number };

export function createRewardsRepository() {
  /** Creates the account row if missing and locks it for the rest of the transaction. */
  async function lockAccount(exec: Executor, userId: string): Promise<number> {
    await exec.insert(tokenAccount).values({ userId }).onConflictDoNothing();
    const rows = await exec
      .select({ balance: tokenAccount.balance })
      .from(tokenAccount)
      .where(eq(tokenAccount.userId, userId))
      .for('update');
    return rows[0]?.balance ?? 0;
  }

  async function entryOf(exec: Executor, userId: string, reason: TokenReason, ref: string) {
    const rows = await exec
      .select()
      .from(tokenEntry)
      .where(
        and(eq(tokenEntry.userId, userId), eq(tokenEntry.reason, reason), eq(tokenEntry.ref, ref)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    lockAccount,
    entryOf,

    async balance(exec: Executor, userId: string): Promise<number> {
      const rows = await exec
        .select({ balance: tokenAccount.balance })
        .from(tokenAccount)
        .where(eq(tokenAccount.userId, userId));
      return rows[0]?.balance ?? 0;
    },

    /**
     * Applies one credit (delta > 0) or debit (delta < 0) at most once per (reason, ref). Must run
     * inside a transaction. A debit larger than the balance is refused and changes nothing.
     */
    async change(
      exec: Executor,
      input: { userId: string; delta: number; reason: TokenReason; ref: string; at: Date },
    ): Promise<TokenChange> {
      const balance = await lockAccount(exec, input.userId);
      if (await entryOf(exec, input.userId, input.reason, input.ref))
        return { applied: false, reason: 'already_applied', balance };
      const after = balance + input.delta;
      if (after < 0) return { applied: false, reason: 'insufficient', balance };
      await exec
        .update(tokenAccount)
        .set({ balance: after, updatedAt: input.at })
        .where(eq(tokenAccount.userId, input.userId));
      await exec.insert(tokenEntry).values({
        userId: input.userId,
        delta: input.delta,
        reason: input.reason,
        ref: input.ref,
        balanceAfter: after,
        createdAt: input.at,
      });
      return { applied: true, balance: after };
    },

    async recentEntries(exec: Executor, userId: string, limit: number): Promise<TokenEntryRow[]> {
      return exec
        .select()
        .from(tokenEntry)
        .where(eq(tokenEntry.userId, userId))
        .orderBy(desc(tokenEntry.createdAt), desc(tokenEntry.entryId))
        .limit(limit);
    },

    /** The days (YYYY-MM-DD) already credited with daily tokens, from `sinceDay`. */
    async creditedDays(exec: Executor, userId: string, sinceDay: string): Promise<Set<string>> {
      const rows = await exec
        .select({ ref: tokenEntry.ref })
        .from(tokenEntry)
        .where(
          and(
            eq(tokenEntry.userId, userId),
            eq(tokenEntry.reason, 'daily'),
            sql`${tokenEntry.ref} >= ${sinceDay}`,
          ),
        );
      return new Set(rows.map((r) => r.ref));
    },

    async shieldsOf(exec: Executor, userId: string): Promise<ShieldRow[]> {
      return exec
        .select()
        .from(streakShield)
        .where(eq(streakShield.userId, userId))
        .orderBy(asc(streakShield.earnedAt), asc(streakShield.shieldId));
    },

    /** Records shield uses; a shield already used, or a day already forgiven, is left alone. */
    async recordShieldUses(
      exec: Executor,
      userId: string,
      uses: ReadonlyArray<{ shieldId: string; day: string }>,
      at: Date,
    ): Promise<number> {
      let used = 0;
      for (const u of uses) {
        const forgiven = await exec
          .select({ id: streakShield.shieldId })
          .from(streakShield)
          .where(and(eq(streakShield.userId, userId), eq(streakShield.usedForDay, u.day)))
          .limit(1);
        if (forgiven.length > 0) continue;
        const rows = await exec
          .update(streakShield)
          .set({ usedForDay: u.day, usedAt: at })
          .where(
            and(
              eq(streakShield.shieldId, u.shieldId),
              eq(streakShield.userId, userId),
              isNull(streakShield.usedForDay),
            ),
          )
          .returning({ id: streakShield.shieldId });
        used += rows.length;
      }
      return used;
    },

    /** Awards one shield per Student for a source (a live quiz); a repeat award is ignored. */
    async awardShields(
      exec: Executor,
      userIds: readonly string[],
      source: 'live_quiz' | 'admin',
      sourceRef: string,
      at: Date,
    ): Promise<number> {
      if (userIds.length === 0) return 0;
      const rows = await exec
        .insert(streakShield)
        .values(userIds.map((userId) => ({ userId, source, sourceRef, earnedAt: at })))
        .onConflictDoNothing()
        .returning({ id: streakShield.shieldId });
      return rows.length;
    },

    async usedShieldCount(exec: Executor, userId: string): Promise<number> {
      const rows = await exec
        .select({ n: sql<number>`count(*)::int` })
        .from(streakShield)
        .where(and(eq(streakShield.userId, userId), isNotNull(streakShield.usedForDay)));
      return rows[0]?.n ?? 0;
    },

    /** One row per Student, course, kind and Dhaka day; repeats are ignored. */
    async recordActivity(
      exec: Executor,
      row: { userId: string; courseId: string; kind: 'live'; day: string; at: Date },
    ): Promise<void> {
      await exec.insert(streakActivity).values(row).onConflictDoNothing();
    },
  };
}
