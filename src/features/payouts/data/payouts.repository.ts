// Payout cycles and lines. A cycle and its lines are written once at commit; afterwards only a line's
// payment state moves forward (the database trigger refuses anything else). Instructors read their
// own lines by their user ID.
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { payoutCycle, payoutLine, payoutStatement } from '#src/server/schema/index.ts';

export type CycleRow = typeof payoutCycle.$inferSelect;
export type LineRow = typeof payoutLine.$inferSelect;
export type StatementRow = typeof payoutStatement.$inferSelect;

export function createPayoutsRepository() {
  return {
    async statementsOf(exec: Executor, lineId: string): Promise<StatementRow[]> {
      return exec.select().from(payoutStatement).where(eq(payoutStatement.lineId, lineId));
    },
    /** Records a stored statement once per line, language and format. */
    async insertStatement(
      exec: Executor,
      row: typeof payoutStatement.$inferInsert,
    ): Promise<boolean> {
      const rows = await exec
        .insert(payoutStatement)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: payoutStatement.statementId });
      return rows.length > 0;
    },
    async cycleByMonth(exec: Executor, month: string): Promise<CycleRow | null> {
      const rows = await exec
        .select()
        .from(payoutCycle)
        .where(eq(payoutCycle.month, month))
        .limit(1);
      return rows[0] ?? null;
    },
    /** The newest committed cycle before `month` (its cut-off and carry-outs feed the next one). */
    async previousCycle(exec: Executor, month: string): Promise<CycleRow | null> {
      const rows = await exec
        .select()
        .from(payoutCycle)
        .where(lt(payoutCycle.month, month))
        .orderBy(desc(payoutCycle.month))
        .limit(1);
      return rows[0] ?? null;
    },
    async latestCycle(exec: Executor): Promise<CycleRow | null> {
      const rows = await exec.select().from(payoutCycle).orderBy(desc(payoutCycle.month)).limit(1);
      return rows[0] ?? null;
    },
    async cycles(exec: Executor, limit: number): Promise<CycleRow[]> {
      return exec.select().from(payoutCycle).orderBy(desc(payoutCycle.month)).limit(limit);
    },
    async linesOf(exec: Executor, cycleId: string): Promise<LineRow[]> {
      return exec
        .select()
        .from(payoutLine)
        .where(eq(payoutLine.cycleId, cycleId))
        .orderBy(payoutLine.instructorId);
    },
    async lineById(exec: Executor, lineId: string, forUpdate = false): Promise<LineRow | null> {
      const q = exec.select().from(payoutLine).where(eq(payoutLine.lineId, lineId)).limit(1);
      const rows = forUpdate ? await q.for('update') : await q;
      return rows[0] ?? null;
    },
    async lineByIdempotencyKey(exec: Executor, key: string): Promise<LineRow | null> {
      const rows = await exec
        .select()
        .from(payoutLine)
        .where(eq(payoutLine.idempotencyKey, key))
        .limit(1);
      return rows[0] ?? null;
    },
    async insertCycle(
      exec: Executor,
      cycle: typeof payoutCycle.$inferInsert,
      lines: ReadonlyArray<Omit<typeof payoutLine.$inferInsert, 'cycleId'>>,
    ): Promise<CycleRow> {
      const [created] = await exec.insert(payoutCycle).values(cycle).returning();
      const row = created as CycleRow;
      if (lines.length > 0)
        await exec.insert(payoutLine).values(lines.map((l) => ({ ...l, cycleId: row.cycleId })));
      return row;
    },
    /** Moves a line's payment state; the trigger refuses any amount change. */
    async updateLine(
      exec: Executor,
      lineId: string,
      patch: Partial<
        Pick<
          LineRow,
          | 'state'
          | 'holdReason'
          | 'holdNote'
          | 'providerRef'
          | 'idempotencyKey'
          | 'disbursedAt'
          | 'disbursedBy'
          | 'releasedAt'
          | 'updatedAt'
        >
      >,
    ): Promise<void> {
      await exec.update(payoutLine).set(patch).where(eq(payoutLine.lineId, lineId));
    },
    /** An instructor's own lines with their cycle month and cut-off, newest first. */
    async linesOfInstructor(exec: Executor, instructorId: string) {
      return exec
        .select({
          line: payoutLine,
          month: payoutCycle.month,
          periodEnd: payoutCycle.periodEnd,
          committedAt: payoutCycle.committedAt,
        })
        .from(payoutLine)
        .innerJoin(payoutCycle, eq(payoutCycle.cycleId, payoutLine.cycleId))
        .where(eq(payoutLine.instructorId, instructorId))
        .orderBy(desc(payoutCycle.month));
    },
    async lineOfInstructorInMonth(exec: Executor, instructorId: string, month: string) {
      const rows = await exec
        .select({
          line: payoutLine,
          month: payoutCycle.month,
          periodEnd: payoutCycle.periodEnd,
          committedAt: payoutCycle.committedAt,
        })
        .from(payoutLine)
        .innerJoin(payoutCycle, eq(payoutCycle.cycleId, payoutLine.cycleId))
        .where(and(eq(payoutLine.instructorId, instructorId), eq(payoutCycle.month, month)))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
