// Ambiguous attribution cases (Finance or Admin; the services check the role).
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  attributionCase,
  attributionReassignment,
  attributionReassignmentItem,
} from '#src/server/schema/index.ts';

export type CaseRow = typeof attributionCase.$inferSelect;
export type ReassignmentRow = typeof attributionReassignment.$inferSelect;

export function createAttributionRepository() {
  return {
    async open(exec: Executor): Promise<CaseRow[]> {
      return exec
        .select()
        .from(attributionCase)
        .where(eq(attributionCase.state, 'open'))
        .orderBy(asc(attributionCase.openedAt))
        .limit(500);
    },
    async recentlyResolved(exec: Executor, limit: number): Promise<CaseRow[]> {
      return exec
        .select()
        .from(attributionCase)
        .where(eq(attributionCase.state, 'resolved'))
        .orderBy(desc(attributionCase.resolvedAt))
        .limit(limit);
    },
    async forUpdate(exec: Executor, caseId: string): Promise<CaseRow | null> {
      const rows = await exec
        .select()
        .from(attributionCase)
        .where(eq(attributionCase.caseId, caseId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(exec: Executor, row: typeof attributionCase.$inferInsert): Promise<CaseRow> {
      const [created] = await exec.insert(attributionCase).values(row).returning();
      return created as CaseRow;
    },
    async resolve(
      exec: Executor,
      caseId: string,
      patch: { ownerId: string; reason: string; resolvedBy: string; resolvedAt: Date },
    ): Promise<void> {
      await exec
        .update(attributionCase)
        .set({ ...patch, state: 'resolved' })
        .where(eq(attributionCase.caseId, caseId));
    },

    /** Serialises reassignments of one section for the rest of the transaction. */
    async lockSection(exec: Executor, sectionId: string): Promise<void> {
      await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${`attr:${sectionId}`}))`);
    },
    /** What earlier cases already moved for this section, per payment. */
    async movedFor(exec: Executor, sectionId: string): Promise<Map<string, number>> {
      const rows = await exec
        .select({
          paymentId: attributionReassignmentItem.paymentId,
          amount: attributionReassignmentItem.amountPoisha,
        })
        .from(attributionReassignmentItem)
        .where(eq(attributionReassignmentItem.sectionId, sectionId));
      return new Map(rows.map((r) => [r.paymentId, r.amount]));
    },
    async insertReassignment(
      exec: Executor,
      row: typeof attributionReassignment.$inferInsert,
      items: ReadonlyArray<{ paymentId: string; amount: number }>,
    ): Promise<void> {
      await exec.insert(attributionReassignment).values(row);
      if (items.length > 0)
        await exec.insert(attributionReassignmentItem).values(
          items.map((i) => ({
            caseId: row.caseId,
            paymentId: i.paymentId,
            sectionId: row.sectionId,
            amountPoisha: i.amount,
          })),
        );
    },
    /** Reassignments waiting for the flag and the drafts' approval, oldest first, locked. */
    async pendingForUpdate(exec: Executor): Promise<ReassignmentRow[]> {
      return exec
        .select()
        .from(attributionReassignment)
        .where(isNull(attributionReassignment.postedAt))
        .orderBy(asc(attributionReassignment.computedAt))
        .for('update')
        .limit(500);
    },
    async markPosted(exec: Executor, caseId: string, by: string, at: Date): Promise<void> {
      await exec
        .update(attributionReassignment)
        .set({ postedAt: at, postedBy: by })
        .where(
          and(eq(attributionReassignment.caseId, caseId), isNull(attributionReassignment.postedAt)),
        );
    },
    async reassignmentsOf(exec: Executor, caseIds: readonly string[]): Promise<ReassignmentRow[]> {
      if (caseIds.length === 0) return [];
      return exec
        .select()
        .from(attributionReassignment)
        .where(inArray(attributionReassignment.caseId, [...caseIds]));
    },
    async pendingCount(exec: Executor): Promise<number> {
      const rows = await exec
        .select({ n: sql<string>`count(*)` })
        .from(attributionReassignment)
        .where(isNull(attributionReassignment.postedAt));
      return Number(rows[0]?.n ?? 0);
    },
  };
}
