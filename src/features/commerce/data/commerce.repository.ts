// Payment and enrolment reads and writes. Every read that serves a Student is scoped by user_id, so
// one Student can never see or settle another's payment (object-level ownership in the query).
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { enrolment, enrolmentRenewal, payment } from '#src/server/schema/index.ts';

export type PaymentRow = typeof payment.$inferSelect;
export type EnrolmentRow = typeof enrolment.$inferSelect;

export function createCommerceRepository() {
  return {
    /** The Student's own payments, newest first, each with the enrolment it created (if any). */
    async purchasesOfUser(exec: Executor, userId: string, limit: number) {
      return exec
        .select({ payment, enrolment, renewal: enrolmentRenewal })
        .from(payment)
        .leftJoin(enrolment, eq(enrolment.paymentId, payment.paymentId))
        .leftJoin(enrolmentRenewal, eq(enrolmentRenewal.paymentId, payment.paymentId))
        .where(eq(payment.userId, userId))
        .orderBy(desc(payment.createdAt), desc(payment.paymentId))
        .limit(limit);
    },

    /** A course's enrolments (newest first), for its statistics and student list. */
    async enrolmentsOfCourse(exec: Executor, courseId: string, limit: number) {
      return exec
        .select({
          userId: enrolment.userId,
          status: enrolment.status,
          startsAt: enrolment.startsAt,
          endsAt: enrolment.endsAt,
          amountPoisha: payment.amountPoisha,
        })
        .from(enrolment)
        .innerJoin(payment, eq(payment.paymentId, enrolment.paymentId))
        .where(eq(enrolment.courseId, courseId))
        .orderBy(desc(enrolment.startsAt))
        .limit(limit);
    },

    async succeededPayments(exec: Executor): Promise<PaymentRow[]> {
      return exec
        .select()
        .from(payment)
        .where(eq(payment.status, 'succeeded'))
        .orderBy(payment.settledAt, payment.paymentId);
    },

    async insertPayment(
      exec: Executor,
      input: {
        paymentId?: string;
        userId: string;
        courseId: string;
        amountPoisha: number;
        discountPoisha?: number;
        promoCodeId?: string | null;
        bundleOrderId?: string | null;
        accessDurationMonths: number;
        kind: 'purchase' | 'renewal';
      },
    ): Promise<PaymentRow> {
      const rows = await exec
        .insert(payment)
        .values({ ...input, gateway: 'fake', status: 'pending' })
        .returning();
      return rows[0] as PaymentRow;
    },

    async paymentOfUser(
      exec: Executor,
      paymentId: string,
      userId: string,
    ): Promise<PaymentRow | null> {
      const rows = await exec
        .select()
        .from(payment)
        .where(and(eq(payment.paymentId, paymentId), eq(payment.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Same, with the row locked for the settlement transaction. */
    async lockPaymentOfUser(
      exec: Executor,
      paymentId: string,
      userId: string,
    ): Promise<PaymentRow | null> {
      const rows = await exec
        .select()
        .from(payment)
        .where(and(eq(payment.paymentId, paymentId), eq(payment.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Pending payments created before the cutoff, locked. SKIP LOCKED: a payment being settled
     * right now is left to its settlement, which re-reads the status under the same row lock.
     */
    async lockStalePending(exec: Executor, cutoff: Date, limit: number): Promise<PaymentRow[]> {
      return exec
        .select()
        .from(payment)
        .where(and(eq(payment.status, 'pending'), lt(payment.createdAt, cutoff)))
        .orderBy(payment.createdAt)
        .for('update', { skipLocked: true })
        .limit(limit);
    },

    async settlePayment(
      exec: Executor,
      paymentId: string,
      status: 'succeeded' | 'failed',
      gatewayRef: string,
    ): Promise<void> {
      await exec
        .update(payment)
        .set({ status, gatewayRef, settledAt: sql`now()` })
        .where(and(eq(payment.paymentId, paymentId), eq(payment.status, 'pending')));
    },

    /**
     * Creates the enrolment for a succeeded payment. Access runs from now for the purchased number
     * of months; Postgres month arithmetic clamps to the month's last day (31 Aug + 6 = 28/29 Feb).
     */
    async insertEnrolment(
      exec: Executor,
      input: { userId: string; courseId: string; paymentId: string; months: number },
    ): Promise<EnrolmentRow> {
      const rows = await exec
        .insert(enrolment)
        .values({
          userId: input.userId,
          courseId: input.courseId,
          paymentId: input.paymentId,
          startsAt: sql`now()`,
          endsAt: sql`now() + make_interval(months => ${input.months})`,
          status: 'active',
        })
        .returning();
      return rows[0] as EnrolmentRow;
    },

    /** The Student's active enrolment in a course, locked for a renewal in the same transaction. */
    async activeEnrolmentForUpdate(
      exec: Executor,
      userId: string,
      courseId: string,
    ): Promise<EnrolmentRow | null> {
      const rows = await exec
        .select()
        .from(enrolment)
        .where(
          and(
            eq(enrolment.userId, userId),
            eq(enrolment.courseId, courseId),
            eq(enrolment.status, 'active'),
            gt(enrolment.endsAt, sql`now()`),
          ),
        )
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },

    /** Extends an enrolment to a new end date and records which payment did it. */
    async renewEnrolment(
      exec: Executor,
      input: { enrolment: EnrolmentRow; paymentId: string; newEndsAt: Date },
    ): Promise<EnrolmentRow> {
      const rows = await exec
        .update(enrolment)
        .set({ endsAt: input.newEndsAt })
        .where(eq(enrolment.enrolmentId, input.enrolment.enrolmentId))
        .returning();
      await exec.insert(enrolmentRenewal).values({
        paymentId: input.paymentId,
        enrolmentId: input.enrolment.enrolmentId,
        previousEndsAt: input.enrolment.endsAt,
        newEndsAt: input.newEndsAt,
      });
      return rows[0] as EnrolmentRow;
    },

    async renewalOfPayment(exec: Executor, paymentId: string) {
      const rows = await exec
        .select({ renewal: enrolmentRenewal, enrolment })
        .from(enrolmentRenewal)
        .innerJoin(enrolment, eq(enrolment.enrolmentId, enrolmentRenewal.enrolmentId))
        .where(eq(enrolmentRenewal.paymentId, paymentId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Any user's payment by ID (Finance's dispute evidence; the caller authorizes). */
    async paymentById(exec: Executor, paymentId: string): Promise<PaymentRow | null> {
      const rows = await exec
        .select()
        .from(payment)
        .where(eq(payment.paymentId, paymentId))
        .limit(1);
      return rows[0] ?? null;
    },

    async enrolmentOfPayment(exec: Executor, paymentId: string): Promise<EnrolmentRow | null> {
      const rows = await exec
        .select()
        .from(enrolment)
        .where(eq(enrolment.paymentId, paymentId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** The Student's current access to a course: active and not past its end. */
    async activeEnrolment(
      exec: Executor,
      userId: string,
      courseId: string,
    ): Promise<EnrolmentRow | null> {
      const rows = await exec
        .select()
        .from(enrolment)
        .where(
          and(
            eq(enrolment.userId, userId),
            eq(enrolment.courseId, courseId),
            eq(enrolment.status, 'active'),
            gt(enrolment.endsAt, sql`now()`),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async activeEnrolments(exec: Executor, userId: string): Promise<EnrolmentRow[]> {
      return exec
        .select()
        .from(enrolment)
        .where(
          and(
            eq(enrolment.userId, userId),
            eq(enrolment.status, 'active'),
            gt(enrolment.endsAt, sql`now()`),
          ),
        )
        .orderBy(desc(enrolment.startsAt))
        .limit(200);
    },
  };
}

export type CommerceRepository = ReturnType<typeof createCommerceRepository>;
