// Pay-policy versions, employee records and the leave ledger (Finance or Admin; the services
// check the role).
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { employeeRecord, leaveEntry, payPolicyVersion } from '#src/server/schema/index.ts';

export type PolicyRow = typeof payPolicyVersion.$inferSelect;
export type RecordRow = typeof employeeRecord.$inferSelect;
export type LeaveRow = typeof leaveEntry.$inferSelect;

export function createHrRepository() {
  return {
    async policiesOf(exec: Executor, instructorId: string): Promise<PolicyRow[]> {
      return exec
        .select()
        .from(payPolicyVersion)
        .where(eq(payPolicyVersion.instructorId, instructorId))
        .orderBy(desc(payPolicyVersion.version));
    },
    /** Serialises version numbers per instructor for the rest of the transaction. */
    async lockInstructor(exec: Executor, instructorId: string): Promise<void> {
      await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${`hr:${instructorId}`}))`);
    },
    async insertPolicy(
      exec: Executor,
      row: typeof payPolicyVersion.$inferInsert,
    ): Promise<PolicyRow> {
      const [created] = await exec.insert(payPolicyVersion).values(row).returning();
      return created as PolicyRow;
    },
    async recordOf(exec: Executor, instructorId: string): Promise<RecordRow | null> {
      const rows = await exec
        .select()
        .from(employeeRecord)
        .where(eq(employeeRecord.instructorId, instructorId))
        .limit(1);
      return rows[0] ?? null;
    },
    async upsertRecord(exec: Executor, row: typeof employeeRecord.$inferInsert): Promise<void> {
      const { instructorId: _id, ...patch } = row;
      await exec
        .insert(employeeRecord)
        .values(row)
        .onConflictDoUpdate({ target: employeeRecord.instructorId, set: patch });
    },
    async leaveOf(exec: Executor, instructorId: string, limit: number): Promise<LeaveRow[]> {
      return exec
        .select()
        .from(leaveEntry)
        .where(eq(leaveEntry.instructorId, instructorId))
        .orderBy(desc(leaveEntry.startsOn))
        .limit(limit);
    },
    async insertLeave(exec: Executor, row: typeof leaveEntry.$inferInsert): Promise<LeaveRow> {
      const [created] = await exec.insert(leaveEntry).values(row).returning();
      return created as LeaveRow;
    },
    /** Instructors with any HR record or policy, for the A8 list. */
    async knownInstructors(exec: Executor): Promise<string[]> {
      const rows = await exec.execute<{ instructor_id: string }>(
        sql`select instructor_id from employee_record union select instructor_id from pay_policy_version limit 500`,
      );
      return rows.rows.map((r) => r.instructor_id);
    },
    /** US7.16: every policy version of these instructors. */
    async policiesOfMany(exec: Executor, instructorIds: readonly string[]): Promise<PolicyRow[]> {
      if (instructorIds.length === 0) return [];
      return exec
        .select()
        .from(payPolicyVersion)
        .where(inArray(payPolicyVersion.instructorId, [...instructorIds]));
    },
    async recordsOfMany(exec: Executor, instructorIds: readonly string[]): Promise<RecordRow[]> {
      if (instructorIds.length === 0) return [];
      return exec
        .select()
        .from(employeeRecord)
        .where(inArray(employeeRecord.instructorId, [...instructorIds]));
    },
    /** US7.16: leave and absence entries overlapping [from, to] (calendar dates). */
    async leaveOverlapping(exec: Executor, from: string, to: string): Promise<LeaveRow[]> {
      return exec
        .select()
        .from(leaveEntry)
        .where(and(lte(leaveEntry.startsOn, to), gte(leaveEntry.endsOn, from)));
    },
  };
}
