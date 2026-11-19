// Refund request reads and writes. A Student's reads are scoped by their own user ID.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { enrolment, enrolmentRenewal, payment, refundRequest } from '#src/server/schema/index.ts';

export type RefundRow = typeof refundRequest.$inferSelect;

export function createRefundRepository() {
  return {
    /** A payment with its enrolment, whether a renewal extended it, and its open or approved request. */
    async paymentContext(exec: Executor, paymentId: string) {
      const rows = await exec
        .select({ payment, enrolment })
        .from(payment)
        .leftJoin(enrolment, eq(enrolment.paymentId, payment.paymentId))
        .where(eq(payment.paymentId, paymentId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const [renewals, requests] = await Promise.all([
        row.enrolment
          ? exec
              .select({ n: sql<number>`count(*)::int` })
              .from(enrolmentRenewal)
              .where(eq(enrolmentRenewal.enrolmentId, row.enrolment.enrolmentId))
          : Promise.resolve([{ n: 0 }]),
        exec
          .select()
          .from(refundRequest)
          .where(eq(refundRequest.paymentId, paymentId))
          .orderBy(desc(refundRequest.requestedAt)),
      ]);
      return { ...row, renewals: renewals[0]?.n ?? 0, requests };
    },
    async requestsForPayments(exec: Executor, paymentIds: readonly string[]): Promise<RefundRow[]> {
      if (paymentIds.length === 0) return [];
      return exec
        .select()
        .from(refundRequest)
        .where(inArray(refundRequest.paymentId, [...paymentIds]))
        .orderBy(desc(refundRequest.requestedAt));
    },
    async renewedEnrolments(exec: Executor, enrolmentIds: readonly string[]): Promise<Set<string>> {
      if (enrolmentIds.length === 0) return new Set();
      const rows = await exec
        .selectDistinct({ id: enrolmentRenewal.enrolmentId })
        .from(enrolmentRenewal)
        .where(inArray(enrolmentRenewal.enrolmentId, [...enrolmentIds]));
      return new Set(rows.map((r) => r.id));
    },
    async insert(exec: Executor, row: { paymentId: string; userId: string; reason: string }) {
      const [created] = await exec.insert(refundRequest).values(row).returning();
      return created as RefundRow;
    },
    async forUpdate(exec: Executor, refundId: string): Promise<RefundRow | null> {
      const rows = await exec
        .select()
        .from(refundRequest)
        .where(eq(refundRequest.refundId, refundId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async decide(
      exec: Executor,
      refundId: string,
      patch: Partial<typeof refundRequest.$inferInsert>,
    ) {
      const [row] = await exec
        .update(refundRequest)
        .set(patch)
        .where(eq(refundRequest.refundId, refundId))
        .returning();
      return row as RefundRow;
    },
    async revokeEnrolment(exec: Executor, enrolmentId: string): Promise<void> {
      await exec
        .update(enrolment)
        .set({ status: 'revoked' })
        .where(and(eq(enrolment.enrolmentId, enrolmentId), eq(enrolment.status, 'active')));
    },
    /** The Admin queue: requests with their payment and enrolment, newest first. */
    async queue(exec: Executor, status: RefundRow['status'] | null, limit: number, offset: number) {
      const where = status ? eq(refundRequest.status, status) : undefined;
      const [rows, total] = await Promise.all([
        exec
          .select({ request: refundRequest, payment, enrolment })
          .from(refundRequest)
          .innerJoin(payment, eq(payment.paymentId, refundRequest.paymentId))
          .leftJoin(enrolment, eq(enrolment.paymentId, payment.paymentId))
          .where(where)
          .orderBy(desc(refundRequest.requestedAt))
          .limit(limit)
          .offset(offset),
        exec.select({ n: sql<number>`count(*)::int` }).from(refundRequest).where(where),
      ]);
      return { rows, total: total[0]?.n ?? 0 };
    },
  };
}
