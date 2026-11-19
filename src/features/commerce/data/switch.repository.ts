// Course switch requests (US2.17-US2.19).
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { courseSwitchRequest, enrolment, payment } from '#src/server/schema/index.ts';

export type SwitchRow = typeof courseSwitchRequest.$inferSelect;

export function createSwitchRepository() {
  return {
    /** The Student's active, paid course enrolments (what a switch may start from). */
    async paidEnrolments(exec: Executor, userId: string) {
      return exec
        .select({
          enrolmentId: enrolment.enrolmentId,
          courseId: enrolment.courseId,
          paymentId: enrolment.paymentId,
          startsAt: enrolment.startsAt,
          endsAt: enrolment.endsAt,
          paidPoisha: payment.amountPoisha,
        })
        .from(enrolment)
        .innerJoin(payment, eq(payment.paymentId, enrolment.paymentId))
        .where(
          and(
            eq(enrolment.userId, userId),
            eq(enrolment.status, 'active'),
            eq(payment.status, 'succeeded'),
          ),
        );
    },
    async pendingOf(exec: Executor, userId: string): Promise<SwitchRow | null> {
      const rows = await exec
        .select()
        .from(courseSwitchRequest)
        .where(
          and(eq(courseSwitchRequest.userId, userId), eq(courseSwitchRequest.status, 'pending')),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    /** Inserts a pending request; null when the Student already has one (unique index). */
    async insert(
      exec: Executor,
      row: typeof courseSwitchRequest.$inferInsert,
    ): Promise<SwitchRow | null> {
      const rows = await exec
        .insert(courseSwitchRequest)
        .values(row)
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },
    async forUpdate(exec: Executor, switchId: string): Promise<SwitchRow | null> {
      const rows = await exec
        .select()
        .from(courseSwitchRequest)
        .where(eq(courseSwitchRequest.switchId, switchId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async update(exec: Executor, switchId: string, patch: Partial<SwitchRow>): Promise<void> {
      await exec
        .update(courseSwitchRequest)
        .set(patch)
        .where(eq(courseSwitchRequest.switchId, switchId));
    },
    /** A2: pending requests not yet due, soonest deadline first. */
    async queue(exec: Executor, now: Date): Promise<SwitchRow[]> {
      return exec
        .select()
        .from(courseSwitchRequest)
        .where(
          and(eq(courseSwitchRequest.status, 'pending'), gt(courseSwitchRequest.deadlineAt, now)),
        )
        .orderBy(asc(courseSwitchRequest.deadlineAt))
        .limit(200);
    },
    /** Marks every pending request at or past its deadline expired; returns those rows. */
    async expireDue(exec: Executor, now: Date): Promise<SwitchRow[]> {
      return exec
        .update(courseSwitchRequest)
        .set({ status: 'expired', decidedAt: now })
        .where(
          and(eq(courseSwitchRequest.status, 'pending'), lte(courseSwitchRequest.deadlineAt, now)),
        )
        .returning();
    },
    async endEnrolmentAsSwitched(exec: Executor, enrolmentId: string): Promise<boolean> {
      const rows = await exec
        .update(enrolment)
        .set({ status: 'switched' })
        .where(and(eq(enrolment.enrolmentId, enrolmentId), eq(enrolment.status, 'active')))
        .returning({ id: enrolment.enrolmentId });
      return rows.length > 0;
    },
  };
}
