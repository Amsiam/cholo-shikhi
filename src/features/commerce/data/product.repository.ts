// Orders and access for Practice Packs, exam packages and subscription plans. A Student's reads are
// scoped by their own user ID.
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { productAccess, productOrder } from '#src/server/schema/index.ts';

export type OrderRow = typeof productOrder.$inferSelect;
export type AccessRow = typeof productAccess.$inferSelect;
export type ProductType = OrderRow['productType'];

export function createProductOrderRepository() {
  return {
    async insertOrder(exec: Executor, row: Omit<typeof productOrder.$inferInsert, 'orderId'>) {
      const [created] = await exec.insert(productOrder).values(row).returning();
      return created as OrderRow;
    },
    async orderOfUser(exec: Executor, orderId: string, userId: string): Promise<OrderRow | null> {
      const rows = await exec
        .select()
        .from(productOrder)
        .where(and(eq(productOrder.orderId, orderId), eq(productOrder.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async lockOrderOfUser(
      exec: Executor,
      orderId: string,
      userId: string,
    ): Promise<OrderRow | null> {
      const rows = await exec
        .select()
        .from(productOrder)
        .where(and(eq(productOrder.orderId, orderId), eq(productOrder.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async settleOrder(
      exec: Executor,
      orderId: string,
      status: 'succeeded' | 'failed',
      ref: string,
    ) {
      await exec
        .update(productOrder)
        .set({ status, gatewayRef: ref, settledAt: new Date() })
        .where(eq(productOrder.orderId, orderId));
    },
    async ordersOf(exec: Executor, userId: string, limit: number): Promise<OrderRow[]> {
      return exec
        .select()
        .from(productOrder)
        .where(eq(productOrder.userId, userId))
        .orderBy(desc(productOrder.createdAt))
        .limit(limit);
    },
    async insertAccess(exec: Executor, row: Omit<typeof productAccess.$inferInsert, 'accessId'>) {
      const [created] = await exec.insert(productAccess).values(row).returning();
      return created as AccessRow;
    },
    async accessOfOrder(exec: Executor, orderId: string): Promise<AccessRow | null> {
      const rows = await exec
        .select()
        .from(productAccess)
        .where(eq(productAccess.orderId, orderId))
        .limit(1);
      return rows[0] ?? null;
    },
    /** The latest-ending access the Student holds now for one product. */
    async latestActive(
      exec: Executor,
      userId: string,
      productType: ProductType,
      productId: string,
      now: Date,
    ): Promise<AccessRow | null> {
      const rows = await exec
        .select()
        .from(productAccess)
        .where(
          and(
            eq(productAccess.userId, userId),
            eq(productAccess.productType, productType),
            eq(productAccess.productId, productId),
            gt(productAccess.endsAt, now),
          ),
        )
        .orderBy(desc(productAccess.endsAt))
        .limit(1);
      return rows[0] ?? null;
    },
    /** Everything the Student can use now. */
    async activeOf(exec: Executor, userId: string, now: Date): Promise<AccessRow[]> {
      return exec
        .select()
        .from(productAccess)
        .where(and(eq(productAccess.userId, userId), gt(productAccess.endsAt, now)));
    },
  };
}
