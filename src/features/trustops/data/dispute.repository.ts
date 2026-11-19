// Payment disputes and their locked evidence packs (Finance or Admin; the services check the role).
// Packs are only ever inserted: a database trigger refuses any update or delete.
import { desc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { disputeEvidencePack, paymentDispute } from '#src/server/schema/index.ts';

export type DisputeRow = typeof paymentDispute.$inferSelect;
export type PackRow = typeof disputeEvidencePack.$inferSelect;

export function createDisputeRepository() {
  return {
    async list(exec: Executor, limit: number) {
      return exec
        .select({ dispute: paymentDispute, lockedAt: disputeEvidencePack.lockedAt })
        .from(paymentDispute)
        .leftJoin(disputeEvidencePack, eq(disputeEvidencePack.disputeId, paymentDispute.disputeId))
        .orderBy(desc(paymentDispute.recordedAt))
        .limit(limit);
    },
    async disputeOfPayment(exec: Executor, paymentId: string): Promise<DisputeRow | null> {
      const rows = await exec
        .select()
        .from(paymentDispute)
        .where(eq(paymentDispute.paymentId, paymentId))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertDispute(
      exec: Executor,
      row: typeof paymentDispute.$inferInsert,
    ): Promise<DisputeRow> {
      const [created] = await exec.insert(paymentDispute).values(row).returning();
      return created as DisputeRow;
    },
    async insertPack(exec: Executor, row: typeof disputeEvidencePack.$inferInsert): Promise<void> {
      await exec.insert(disputeEvidencePack).values(row);
    },
    async packOf(
      exec: Executor,
      disputeId: string,
    ): Promise<{ dispute: DisputeRow; pack: PackRow } | null> {
      const rows = await exec
        .select({ dispute: paymentDispute, pack: disputeEvidencePack })
        .from(paymentDispute)
        .innerJoin(disputeEvidencePack, eq(disputeEvidencePack.disputeId, paymentDispute.disputeId))
        .where(eq(paymentDispute.disputeId, disputeId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
