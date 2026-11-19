// KYC submissions and payout accounts. A person's own rows are read by their user ID; the Finance
// queue reads pending rows only. Sealed (encrypted) numbers never leave this feature's server code.
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { kycSubmission, payoutAccount } from '#src/server/schema/index.ts';

export type KycRow = typeof kycSubmission.$inferSelect;
export type AccountRow = typeof payoutAccount.$inferSelect;

export function createKycRepository() {
  return {
    async latestKyc(exec: Executor, userId: string): Promise<KycRow | null> {
      const rows = await exec
        .select()
        .from(kycSubmission)
        .where(eq(kycSubmission.userId, userId))
        .orderBy(desc(kycSubmission.submittedAt))
        .limit(1);
      return rows[0] ?? null;
    },
    async kycById(exec: Executor, submissionId: string): Promise<KycRow | null> {
      const rows = await exec
        .select()
        .from(kycSubmission)
        .where(eq(kycSubmission.submissionId, submissionId))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertKyc(exec: Executor, row: typeof kycSubmission.$inferInsert): Promise<KycRow> {
      const [created] = await exec.insert(kycSubmission).values(row).returning();
      return created as KycRow;
    },
    /** Decides a submission still waiting; false when it was already decided. */
    async decideKyc(
      exec: Executor,
      submissionId: string,
      patch: { status: 'verified' | 'rejected'; reason: string | null; at: Date; by: string },
    ): Promise<KycRow | null> {
      const rows = await exec
        .update(kycSubmission)
        .set({
          status: patch.status,
          reason: patch.reason,
          decidedAt: patch.at,
          decidedBy: patch.by,
        })
        .where(
          and(eq(kycSubmission.submissionId, submissionId), eq(kycSubmission.status, 'submitted')),
        )
        .returning();
      return rows[0] ?? null;
    },
    async kycQueue(exec: Executor): Promise<KycRow[]> {
      return exec
        .select()
        .from(kycSubmission)
        .where(eq(kycSubmission.status, 'submitted'))
        .orderBy(asc(kycSubmission.submittedAt))
        .limit(100);
    },

    async accountById(exec: Executor, payoutAccountId: string): Promise<AccountRow | null> {
      const rows = await exec
        .select()
        .from(payoutAccount)
        .where(eq(payoutAccount.payoutAccountId, payoutAccountId))
        .limit(1);
      return rows[0] ?? null;
    },
    async currentAccount(exec: Executor, userId: string): Promise<AccountRow | null> {
      const rows = await exec
        .select()
        .from(payoutAccount)
        .where(and(eq(payoutAccount.userId, userId), eq(payoutAccount.isCurrent, true)))
        .limit(1);
      return rows[0] ?? null;
    },
    /** A new current account; the previous one stops being current (AC7.20.3). */
    async replaceAccount(
      exec: Executor,
      row: typeof payoutAccount.$inferInsert,
    ): Promise<AccountRow> {
      await exec
        .update(payoutAccount)
        .set({ isCurrent: false })
        .where(and(eq(payoutAccount.userId, row.userId), eq(payoutAccount.isCurrent, true)));
      const [created] = await exec.insert(payoutAccount).values(row).returning();
      return created as AccountRow;
    },
    async decideAccount(
      exec: Executor,
      payoutAccountId: string,
      patch: { status: 'verified' | 'rejected'; reason: string | null; at: Date; by: string },
    ): Promise<AccountRow | null> {
      const rows = await exec
        .update(payoutAccount)
        .set({
          status: patch.status,
          reason: patch.reason,
          decidedAt: patch.at,
          decidedBy: patch.by,
        })
        .where(
          and(
            eq(payoutAccount.payoutAccountId, payoutAccountId),
            eq(payoutAccount.status, 'pending'),
            eq(payoutAccount.isCurrent, true),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },
    /** A failed payout puts the current account back in Finance's queue (US7.5, US7.22). */
    async markForReverification(exec: Executor, userId: string, reason: string): Promise<boolean> {
      const rows = await exec
        .update(payoutAccount)
        .set({ status: 'pending', reason, decidedAt: null, decidedBy: null })
        .where(and(eq(payoutAccount.userId, userId), eq(payoutAccount.isCurrent, true)))
        .returning({ id: payoutAccount.payoutAccountId });
      return rows.length > 0;
    },
    async accountQueue(exec: Executor): Promise<AccountRow[]> {
      return exec
        .select()
        .from(payoutAccount)
        .where(and(eq(payoutAccount.status, 'pending'), eq(payoutAccount.isCurrent, true)))
        .orderBy(asc(payoutAccount.createdAt))
        .limit(100);
    },
  };
}
