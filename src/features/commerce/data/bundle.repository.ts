// US8.5 bundle orders and their items. Callers pass an Executor (the database or a transaction);
// every read of an order is scoped by the buyer's user ID.
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { bundleOrder, bundleOrderItem } from '#src/server/schema/index.ts';

export type BundleOrderRow = typeof bundleOrder.$inferSelect;
export type BundleOrderItemRow = typeof bundleOrderItem.$inferSelect;

export function createBundleOrderRepository() {
  return {
    async insertOrder(
      exec: Executor,
      order: {
        userId: string;
        bundleId: string;
        nameBn: string;
        nameEn: string;
        amountPoisha: number;
      },
      items: ReadonlyArray<Omit<BundleOrderItemRow, 'orderId' | 'paymentId'>>,
    ): Promise<BundleOrderRow> {
      const [row] = await exec.insert(bundleOrder).values(order).returning();
      const created = row as BundleOrderRow;
      await exec
        .insert(bundleOrderItem)
        .values(items.map((i) => ({ ...i, orderId: created.orderId })));
      return created;
    },

    async orderOfUser(
      exec: Executor,
      orderId: string,
      userId: string,
    ): Promise<BundleOrderRow | null> {
      const rows = await exec
        .select()
        .from(bundleOrder)
        .where(and(eq(bundleOrder.orderId, orderId), eq(bundleOrder.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Same, locked for the settlement transaction. */
    async lockOrderOfUser(
      exec: Executor,
      orderId: string,
      userId: string,
    ): Promise<BundleOrderRow | null> {
      const rows = await exec
        .select()
        .from(bundleOrder)
        .where(and(eq(bundleOrder.orderId, orderId), eq(bundleOrder.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Pending bundle orders created before the cutoff, locked. SKIP LOCKED: an order being settled
     * right now is left to its settlement, which re-reads the status under the same row lock.
     */
    async lockStalePending(exec: Executor, cutoff: Date, limit: number): Promise<BundleOrderRow[]> {
      return exec
        .select()
        .from(bundleOrder)
        .where(and(eq(bundleOrder.status, 'pending'), lt(bundleOrder.createdAt, cutoff)))
        .orderBy(bundleOrder.createdAt)
        .for('update', { skipLocked: true })
        .limit(limit);
    },

    async itemsOf(exec: Executor, orderId: string): Promise<BundleOrderItemRow[]> {
      return exec
        .select()
        .from(bundleOrderItem)
        .where(eq(bundleOrderItem.orderId, orderId))
        .orderBy(asc(bundleOrderItem.position));
    },

    async settleOrder(
      exec: Executor,
      orderId: string,
      status: 'succeeded' | 'failed',
      gatewayRef: string,
    ): Promise<void> {
      await exec
        .update(bundleOrder)
        .set({ status, gatewayRef, settledAt: sql`now()` })
        .where(and(eq(bundleOrder.orderId, orderId), eq(bundleOrder.status, 'pending')));
    },

    async linkItemPayment(
      exec: Executor,
      orderId: string,
      position: number,
      paymentId: string,
    ): Promise<void> {
      await exec
        .update(bundleOrderItem)
        .set({ paymentId })
        .where(and(eq(bundleOrderItem.orderId, orderId), eq(bundleOrderItem.position, position)));
    },
  };
}
