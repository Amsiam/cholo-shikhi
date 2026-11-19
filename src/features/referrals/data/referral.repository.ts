// Referral codes and attributions. Callers pass an Executor (the database or a transaction).
import { and, asc, count, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { referralAttribution, referralCode, referralWithdrawal } from '#src/server/schema/index.ts';

export type ReferralCodeRow = typeof referralCode.$inferSelect;
export type AttributionRow = typeof referralAttribution.$inferSelect;
export type WithdrawalRow = typeof referralWithdrawal.$inferSelect;

export function createReferralRepository() {
  return {
    async codeOf(exec: Executor, userId: string): Promise<ReferralCodeRow | null> {
      const rows = await exec
        .select()
        .from(referralCode)
        .where(eq(referralCode.userId, userId))
        .limit(1);
      return rows[0] ?? null;
    },
    async byCode(exec: Executor, code: string): Promise<ReferralCodeRow | null> {
      const rows = await exec
        .select()
        .from(referralCode)
        .where(eq(referralCode.code, code))
        .limit(1);
      return rows[0] ?? null;
    },
    /** Inserts the user's code; null when the user already has one or the code is taken. */
    async insertCode(exec: Executor, userId: string, code: string) {
      const rows = await exec
        .insert(referralCode)
        .values({ userId, code })
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },
    async attributionOf(exec: Executor, referredUserId: string): Promise<AttributionRow | null> {
      const rows = await exec
        .select()
        .from(referralAttribution)
        .where(eq(referralAttribution.referredUserId, referredUserId))
        .limit(1);
      return rows[0] ?? null;
    },
    /** Records who referred the account; false when it was already attributed. */
    async insertAttribution(
      exec: Executor,
      row: { referredUserId: string; referrerUserId: string; code: string },
    ): Promise<boolean> {
      const rows = await exec
        .insert(referralAttribution)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: referralAttribution.referredUserId });
      return rows.length === 1;
    },
    /** AC8.9.2: records the adult declaration once. */
    async declareAdult(exec: Executor, userId: string, at: Date): Promise<void> {
      await exec
        .update(referralCode)
        .set({ adultDeclaredAt: at })
        .where(and(eq(referralCode.userId, userId), isNull(referralCode.adultDeclaredAt)));
    },
    async openWithdrawalOf(exec: Executor, userId: string): Promise<WithdrawalRow | null> {
      const rows = await exec
        .select()
        .from(referralWithdrawal)
        .where(
          and(eq(referralWithdrawal.userId, userId), eq(referralWithdrawal.status, 'requested')),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async withdrawalsOf(exec: Executor, userId: string, limit: number): Promise<WithdrawalRow[]> {
      return exec
        .select()
        .from(referralWithdrawal)
        .where(eq(referralWithdrawal.userId, userId))
        .orderBy(desc(referralWithdrawal.requestedAt))
        .limit(limit);
    },
    /** Inserts a request; null when the referrer already has one open. */
    async insertWithdrawal(
      exec: Executor,
      row: typeof referralWithdrawal.$inferInsert,
    ): Promise<WithdrawalRow | null> {
      const rows = await exec
        .insert(referralWithdrawal)
        .values(row)
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },
    async withdrawalForUpdate(exec: Executor, withdrawalId: string): Promise<WithdrawalRow | null> {
      const rows = await exec
        .select()
        .from(referralWithdrawal)
        .where(eq(referralWithdrawal.withdrawalId, withdrawalId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async decideWithdrawal(
      exec: Executor,
      withdrawalId: string,
      patch: Pick<WithdrawalRow, 'status' | 'decidedBy' | 'decidedAt' | 'reason' | 'providerRef'>,
    ): Promise<void> {
      await exec
        .update(referralWithdrawal)
        .set(patch)
        .where(
          and(
            eq(referralWithdrawal.withdrawalId, withdrawalId),
            eq(referralWithdrawal.status, 'requested'),
          ),
        );
    },
    async withdrawalQueue(exec: Executor, limit: number) {
      const [open, decided] = await Promise.all([
        exec
          .select()
          .from(referralWithdrawal)
          .where(eq(referralWithdrawal.status, 'requested'))
          .orderBy(asc(referralWithdrawal.requestedAt))
          .limit(limit),
        exec
          .select()
          .from(referralWithdrawal)
          .where(ne(referralWithdrawal.status, 'requested'))
          .orderBy(desc(referralWithdrawal.decidedAt))
          .limit(20),
      ]);
      return { open, decided };
    },
    async referredCount(exec: Executor, referrerUserId: string): Promise<number> {
      const [row] = await exec
        .select({ n: count() })
        .from(referralAttribution)
        .where(eq(referralAttribution.referrerUserId, referrerUserId));
      return Number(row?.n ?? 0);
    },
  };
}
