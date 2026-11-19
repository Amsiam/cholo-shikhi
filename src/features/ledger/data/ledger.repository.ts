// Ledger reads and writes. Writes only append (the table triggers refuse updates and deletes, and
// check that every transaction balances at commit). Reads group by month in Asia/Dhaka time.
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { ledgerPosting, ledgerTransaction } from '#src/server/schema/index.ts';
import type { ReferralKind, ReferralPosting } from '../domain/referral-postings.ts';
import type { Posting } from '../domain/revenue-split.ts';
import type { StatementLineKind } from '../domain/statement.ts';

const month = sql<string>`to_char(date_trunc('month', ${ledgerTransaction.occurredAt} at time zone 'Asia/Dhaka'), 'YYYY-MM')`;
const sum = (expr: ReturnType<typeof sql>) => sql<string>`coalesce(sum(${expr}), 0)`;
/** Gross: a sale adds its amount, a refund takes its amount away. */
/** A reassignment of unassigned money (US7.13) moves money already collected: no gross of its own. */
const signedAmount = sql`case when ${ledgerTransaction.kind} = 'course_refund' then -${ledgerTransaction.amountPoisha} when ${ledgerTransaction.kind} = 'attribution_reassignment' then 0 else ${ledgerTransaction.amountPoisha} end`;
/** Sales counted, refunds not. */
const saleCount = sql<string>`count(*) filter (where ${ledgerTransaction.kind} = 'course_sale')`;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
/** Earnings and revenue views leave payouts out; only the statements of what is owed include them. */
/**
 * Sales, refunds and platform sales only: no instructor payouts, no referral money (US8.7), no
 * salary accruals (US7.16) and no pay-policy adjustments (US7.27); the payout cycle counts those
 * two itself.
 */
const notPayout = notInArray(ledgerTransaction.kind, [
  'instructor_payout',
  'salary_accrual',
  'pay_policy_adjustment',
  'referral_accrual',
  'referral_clawback',
  'referral_payout',
]);

export type MonthAmount = { month: string; amount: number; sales: number };

/**
 * The statement line kind of a ledger entry on an instructor's payable: each kind is its own line
 * (a salary or a reassignment is never shown as a sale). Referral money never touches the payable.
 */
function statementKind(kind: (typeof ledgerTransaction.$inferSelect)['kind']): StatementLineKind {
  switch (kind) {
    case 'course_refund':
    case 'instructor_payout':
    case 'attribution_reassignment':
    case 'salary_accrual':
    case 'pay_policy_adjustment':
      return kind;
    default:
      return 'course_sale';
  }
}

export function createLedgerRepository() {
  return {
    async hasSale(exec: Executor, paymentId: string): Promise<boolean> {
      const rows = await exec
        .select({ id: ledgerTransaction.transactionId })
        .from(ledgerTransaction)
        .where(
          and(
            eq(ledgerTransaction.sourcePaymentId, paymentId),
            eq(ledgerTransaction.kind, 'course_sale'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    /** A sale's transaction and postings, by payment. */
    async saleOf(exec: Executor, paymentId: string) {
      const tx = await exec
        .select()
        .from(ledgerTransaction)
        .where(
          and(
            eq(ledgerTransaction.sourcePaymentId, paymentId),
            eq(ledgerTransaction.kind, 'course_sale'),
          ),
        )
        .limit(1);
      const sale = tx[0];
      if (!sale) return null;
      const postings = await exec
        .select()
        .from(ledgerPosting)
        .where(eq(ledgerPosting.transactionId, sale.transactionId))
        .orderBy(ledgerPosting.account, ledgerPosting.instructorId);
      return {
        sale,
        postings: postings.map((p) => ({
          account: p.account,
          instructorId: p.instructorId,
          amount: Number(p.amountPoisha),
        })) as Posting[],
      };
    },

    /** Inserts a platform-only sale (no course): the gateway debit and platform revenue. */
    async insertPlatformSale(
      exec: Executor,
      sale: { paymentId: string; amount: number; occurredAt: Date },
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'platform_sale',
          sourcePaymentId: sale.paymentId,
          courseId: null,
          amountPoisha: sale.amount,
          instructorShareBps: 0,
          occurredAt: sale.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values([
        {
          transactionId: tx.id,
          account: 'gateway_clearing',
          instructorId: null,
          amountPoisha: sale.amount,
        },
        {
          transactionId: tx.id,
          account: 'platform_revenue',
          instructorId: null,
          amountPoisha: -sale.amount,
        },
      ]);
      return true;
    },

    /** Inserts a refund and its postings. A second refund of the same payment does nothing. */
    async insertRefund(
      exec: Executor,
      refund: {
        paymentId: string;
        courseId: string;
        amount: number;
        shareBps: number;
        occurredAt: Date;
      },
      postings: Posting[],
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'course_refund',
          sourcePaymentId: refund.paymentId,
          courseId: refund.courseId,
          amountPoisha: refund.amount,
          instructorShareBps: refund.shareBps,
          occurredAt: refund.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values(
        postings.map((p) => ({
          transactionId: tx.id,
          account: p.account,
          instructorId: p.instructorId,
          amountPoisha: p.amount,
        })),
      );
      return true;
    },

    /**
     * Inserts a payout to an instructor (the payout-cycle line is the source): the payable is
     * debited and the cash credited. A second insert for the same line does nothing.
     */
    async insertPayout(
      exec: Executor,
      payout: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'instructor_payout',
          sourcePaymentId: payout.lineId,
          courseId: null,
          amountPoisha: payout.amount,
          instructorShareBps: 10_000,
          occurredAt: payout.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values([
        {
          transactionId: tx.id,
          account: 'instructor_payable',
          instructorId: payout.instructorId,
          amountPoisha: payout.amount,
        },
        {
          transactionId: tx.id,
          account: 'gateway_clearing',
          instructorId: null,
          amountPoisha: -payout.amount,
        },
      ]);
      return true;
    },

    /**
     * Inserts a referral transaction (US8.7/US8.8) and its postings; the source is the referred
     * payment (accrual, clawback) or the withdrawal (payout). A repeat for the same source does
     * nothing (false).
     */
    async insertReferral(
      exec: Executor,
      entry: { kind: ReferralKind; sourceId: string; amount: number; occurredAt: Date },
      postings: ReferralPosting[],
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: entry.kind,
          sourcePaymentId: entry.sourceId,
          courseId: null,
          amountPoisha: entry.amount,
          instructorShareBps: 0,
          occurredAt: entry.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values(
        postings.map((p) => ({
          transactionId: tx.id,
          account: p.account,
          instructorId: null,
          referrerId: p.referrerId,
          amountPoisha: p.amount,
        })),
      );
      return true;
    },

    /**
     * US7.13: per payment of a course, the unassigned pool its sale credited less what its refunds
     * took back (in poisha), and when the sale happened. Only payments that touched the pool.
     */
    async unassignedSales(
      exec: Executor,
      courseId: string,
    ): Promise<Array<{ paymentId: string; saleAt: Date; netUnassigned: number }>> {
      const rows = await exec
        .select({
          paymentId: ledgerTransaction.sourcePaymentId,
          saleAt: sql<Date>`min(${ledgerTransaction.occurredAt}) filter (where ${ledgerTransaction.kind} = 'course_sale')`,
          net: sum(sql`-${ledgerPosting.amountPoisha}`),
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerTransaction.courseId, courseId),
            inArray(ledgerTransaction.kind, ['course_sale', 'course_refund']),
            eq(ledgerPosting.account, 'unassigned_instructor_pool'),
          ),
        )
        .groupBy(ledgerTransaction.sourcePaymentId);
      return rows.flatMap((r) =>
        r.saleAt
          ? [{ paymentId: r.paymentId, saleAt: new Date(r.saleAt), netUnassigned: num(r.net) }]
          : [],
      );
    },

    /**
     * US7.13: moves money from the unassigned pool to an instructor's payable, once per resolved
     * case (its ID is the source). A repeat for the same case does nothing (false).
     */
    async insertReassignment(
      exec: Executor,
      entry: {
        caseId: string;
        courseId: string;
        instructorId: string;
        amount: number;
        occurredAt: Date;
      },
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'attribution_reassignment',
          sourcePaymentId: entry.caseId,
          courseId: entry.courseId,
          amountPoisha: entry.amount,
          instructorShareBps: 10_000,
          occurredAt: entry.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values([
        {
          transactionId: tx.id,
          account: 'unassigned_instructor_pool',
          instructorId: null,
          amountPoisha: entry.amount,
        },
        {
          transactionId: tx.id,
          account: 'instructor_payable',
          instructorId: entry.instructorId,
          amountPoisha: -entry.amount,
        },
      ]);
      return true;
    },

    /**
     * US7.16: a committed salary line: salary_expense debited, the instructor's payable credited,
     * once per payout-cycle line (its ID is the source). A repeat does nothing (false).
     */
    async insertSalaryAccrual(
      exec: Executor,
      entry: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'salary_accrual',
          sourcePaymentId: entry.lineId,
          courseId: null,
          amountPoisha: entry.amount,
          instructorShareBps: 10_000,
          occurredAt: entry.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values([
        {
          transactionId: tx.id,
          account: 'salary_expense',
          instructorId: null,
          amountPoisha: entry.amount,
        },
        {
          transactionId: tx.id,
          account: 'instructor_payable',
          instructorId: entry.instructorId,
          amountPoisha: -entry.amount,
        },
      ]);
      return true;
    },

    /**
     * US7.27: a hybrid or salary policy's adjustment for a payout-cycle line (its ID is the
     * source), between the instructor's payable and platform revenue: a negative amount takes money
     * back from the payable, a positive one adds to it. Once per line (a repeat returns false).
     */
    async insertPolicyAdjustment(
      exec: Executor,
      entry: { lineId: string; instructorId: string; amount: number; occurredAt: Date },
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'pay_policy_adjustment',
          sourcePaymentId: entry.lineId,
          courseId: null,
          amountPoisha: Math.abs(entry.amount),
          instructorShareBps: 10_000,
          occurredAt: entry.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      await exec.insert(ledgerPosting).values([
        {
          transactionId: tx.id,
          account: 'instructor_payable',
          instructorId: entry.instructorId,
          amountPoisha: -entry.amount,
        },
        {
          transactionId: tx.id,
          account: 'platform_revenue',
          instructorId: null,
          amountPoisha: entry.amount,
        },
      ]);
      return true;
    },

    /**
     * US7.27: an instructor's course sales and refunds counted by a payout cycle (its window), with
     * the transaction amount, the instant of the sale, and what the instructor was credited.
     */
    async instructorSalesInCycle(
      exec: Executor,
      instructorId: string,
      cutoff: Date,
      previous: { cutoff: Date; committedAt: Date } | null,
    ) {
      const rows = await exec
        .select({
          kind: ledgerTransaction.kind,
          courseId: ledgerTransaction.courseId,
          amount: ledgerTransaction.amountPoisha,
          saleAt: sql<
            Date | string | null
          >`(select min(s.occurred_at) from ledger_transaction s where s.source_payment_id = ${ledgerTransaction.sourcePaymentId} and s.kind = 'course_sale')`,
          credited: sql<string>`-${ledgerPosting.amountPoisha}`,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            this.cycleWindow(cutoff, previous),
            eq(ledgerPosting.instructorId, instructorId),
            inArray(ledgerTransaction.kind, ['course_sale', 'course_refund']),
          ),
        );
      return rows.flatMap((r) =>
        r.saleAt && r.courseId
          ? [
              {
                kind: r.kind as 'course_sale' | 'course_refund',
                courseId: r.courseId,
                amount: r.amount,
                saleAt: new Date(r.saleAt),
                credited: num(r.credited),
              },
            ]
          : [],
      );
    },

    /** The referral accrual on a payment: who earned it and how much, or null. */
    async referralAccrualOf(exec: Executor, paymentId: string) {
      const rows = await exec
        .select({
          referrerId: ledgerPosting.referrerId,
          amount: ledgerPosting.amountPoisha,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerTransaction.sourcePaymentId, paymentId),
            eq(ledgerTransaction.kind, 'referral_accrual'),
            eq(ledgerPosting.account, 'referral_payable'),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row?.referrerId ? { referrerId: row.referrerId, amount: -num(row.amount) } : null;
    },

    /** A referrer's balance: what is owed to them (may be negative after a clawback). */
    async referralBalance(exec: Executor, referrerId: string): Promise<number> {
      const [row] = await exec
        .select({ total: sum(sql`-${ledgerPosting.amountPoisha}`) })
        .from(ledgerPosting)
        .where(
          and(
            eq(ledgerPosting.account, 'referral_payable'),
            eq(ledgerPosting.referrerId, referrerId),
          ),
        );
      return num(row?.total);
    },

    /** A referrer's referral lines, newest first: accruals (+), clawbacks and payouts (−). */
    async referralLines(exec: Executor, referrerId: string, limit: number) {
      const rows = await exec
        .select({
          kind: ledgerTransaction.kind,
          sourceId: ledgerTransaction.sourcePaymentId,
          amount: ledgerPosting.amountPoisha,
          occurredAt: ledgerTransaction.occurredAt,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'referral_payable'),
            eq(ledgerPosting.referrerId, referrerId),
          ),
        )
        .orderBy(desc(ledgerTransaction.occurredAt), desc(ledgerTransaction.transactionId))
        .limit(limit);
      return rows.map((r) => ({
        kind: r.kind as ReferralKind,
        sourceId: r.sourceId,
        amount: -num(r.amount),
        occurredAt: r.occurredAt.toISOString(),
      }));
    },

    /** Inserts a sale and its postings. A second insert for the same payment does nothing. */
    async insertSale(
      exec: Executor,
      sale: {
        paymentId: string;
        courseId: string;
        amount: number;
        shareBps: number;
        occurredAt: Date;
      },
      postings: Posting[],
    ): Promise<boolean> {
      const inserted = await exec
        .insert(ledgerTransaction)
        .values({
          kind: 'course_sale',
          sourcePaymentId: sale.paymentId,
          courseId: sale.courseId,
          amountPoisha: sale.amount,
          instructorShareBps: sale.shareBps,
          occurredAt: sale.occurredAt,
        })
        .onConflictDoNothing({
          target: [ledgerTransaction.sourcePaymentId, ledgerTransaction.kind],
        })
        .returning({ id: ledgerTransaction.transactionId });
      const tx = inserted[0];
      if (!tx) return false;
      if (postings.length > 0) {
        await exec.insert(ledgerPosting).values(
          postings.map((p) => ({
            transactionId: tx.id,
            account: p.account,
            instructorId: p.instructorId,
            amountPoisha: p.amount,
          })),
        );
      }
      return true;
    },

    /** One instructor's earnings (credits to their payable), per course. */
    async instructorByCourse(exec: Executor, instructorId: string) {
      const rows = await exec
        .select({
          courseId: ledgerTransaction.courseId,
          earned: sum(sql`-${ledgerPosting.amountPoisha}`),
          gross: sum(signedAmount),
          sales: saleCount,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            isNotNull(ledgerTransaction.courseId),
          ),
        )
        .groupBy(ledgerTransaction.courseId);
      return rows.map((r) => ({
        courseId: r.courseId as string,
        earned: num(r.earned),
        gross: num(r.gross),
        sales: num(r.sales),
      }));
    },

    async instructorByMonth(
      exec: Executor,
      instructorId: string,
      since: Date,
    ): Promise<MonthAmount[]> {
      const rows = await exec
        .select({
          month,
          amount: sum(sql`-${ledgerPosting.amountPoisha}`),
          sales: saleCount,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            gte(ledgerTransaction.occurredAt, since),
            ne(ledgerTransaction.kind, 'instructor_payout'),
          ),
        )
        .groupBy(month)
        .orderBy(month);
      return rows.map((r) => ({ month: r.month, amount: num(r.amount), sales: num(r.sales) }));
    },

    /**
     * US7.16 / US7.27: what an instructor's payable gained from entries with no course: salary
     * accruals and pay-policy adjustments (either sign), each on its own total.
     */
    async instructorNonCourseTotals(
      exec: Executor,
      instructorId: string,
    ): Promise<{ salary: number; policyAdjustment: number }> {
      const rows = await exec
        .select({ kind: ledgerTransaction.kind, amount: sum(sql`-${ledgerPosting.amountPoisha}`) })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            inArray(ledgerTransaction.kind, ['salary_accrual', 'pay_policy_adjustment']),
          ),
        )
        .groupBy(ledgerTransaction.kind);
      const of = (kind: string) => num(rows.find((r) => r.kind === kind)?.amount);
      return { salary: of('salary_accrual'), policyAdjustment: of('pay_policy_adjustment') };
    },

    /** One instructor's attribution reassignments (US7.13), all courses. */
    async instructorReassigned(exec: Executor, instructorId: string): Promise<number> {
      const rows = await exec
        .select({ amount: sum(sql`-${ledgerPosting.amountPoisha}`) })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            eq(ledgerTransaction.kind, 'attribution_reassignment'),
          ),
        );
      return num(rows[0]?.amount);
    },

    /**
     * Payout cycles: the instructor_payable postings that belong to a cycle. A posting belongs to the
     * cycle with cut-off `cutoff` if it is dated before the cut-off and the previous cycle did not
     * already count it (dated before the previous cut-off AND recorded before that cycle was
     * committed). So a late or back-dated posting is never lost: it lands in the next cycle.
     */
    cycleWindow(cutoff: Date, previous: { cutoff: Date; committedAt: Date } | null) {
      return and(
        eq(ledgerPosting.account, 'instructor_payable'),
        notPayout,
        lt(ledgerTransaction.occurredAt, cutoff),
        previous
          ? sql`not (${ledgerTransaction.occurredAt} < ${previous.cutoff} and ${ledgerTransaction.createdAt} < ${previous.committedAt})`
          : undefined,
      );
    },

    /** Per instructor: what instructor_payable gained in a payout cycle (see cycleWindow). */
    async payableForCycle(
      exec: Executor,
      cutoff: Date,
      previous: { cutoff: Date; committedAt: Date } | null,
    ): Promise<Array<{ instructorId: string; earned: number }>> {
      const rows = await exec
        .select({
          instructorId: ledgerPosting.instructorId,
          earned: sum(sql`-${ledgerPosting.amountPoisha}`),
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(and(this.cycleWindow(cutoff, previous), isNotNull(ledgerPosting.instructorId)))
        .groupBy(ledgerPosting.instructorId);
      return rows.map((r) => ({ instructorId: r.instructorId as string, earned: num(r.earned) }));
    },

    /**
     * One instructor's postings in a committed payout cycle (its statement's lines): the cycle's
     * window, limited to postings recorded before the cycle was committed, exactly what it counted.
     */
    async instructorCycleLines(
      exec: Executor,
      instructorId: string,
      cutoff: Date,
      previous: { cutoff: Date; committedAt: Date } | null,
      committedAt: Date,
    ) {
      const rows = await exec
        .select({
          occurredAt: ledgerTransaction.occurredAt,
          kind: ledgerTransaction.kind,
          courseId: ledgerTransaction.courseId,
          amount: sql<string>`-${ledgerPosting.amountPoisha}`,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            this.cycleWindow(cutoff, previous),
            eq(ledgerPosting.instructorId, instructorId),
            lt(ledgerTransaction.createdAt, committedAt),
          ),
        )
        .orderBy(ledgerTransaction.occurredAt);
      // Salary and pay-policy adjustments are shown from the cycle line itself, not as rows here.
      return rows
        .filter((r) => r.kind !== 'salary_accrual' && r.kind !== 'pay_policy_adjustment')
        .map((r) => ({
          occurredAt: r.occurredAt,
          kind:
            r.kind === 'course_refund' || r.kind === 'attribution_reassignment'
              ? r.kind
              : ('course_sale' as const),
          courseId: r.courseId,
          amount: num(r.amount),
        }));
    },

    /** The Dhaka months (YYYY-MM) in which the instructor's payable changed, newest first. */
    async instructorMonths(exec: Executor, instructorId: string): Promise<string[]> {
      const rows = await exec
        .selectDistinct({ month })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
          ),
        )
        .orderBy(desc(month));
      return rows.map((r) => r.month);
    },

    /** What the instructor was owed before `before` (credits are negative postings). */
    async instructorBalanceBefore(
      exec: Executor,
      instructorId: string,
      before: Date,
    ): Promise<number> {
      const rows = await exec
        .select({ owed: sum(sql`-${ledgerPosting.amountPoisha}`) })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            lt(ledgerTransaction.occurredAt, before),
          ),
        );
      return num(rows[0]?.owed);
    },

    /** Every change to the instructor's payable in [from, to): one line per posting. */
    async instructorLines(exec: Executor, instructorId: string, from: Date, to: Date) {
      const rows = await exec
        .select({
          occurredAt: ledgerTransaction.occurredAt,
          kind: ledgerTransaction.kind,
          courseId: ledgerTransaction.courseId,
          amount: sql<string>`-${ledgerPosting.amountPoisha}`,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            eq(ledgerPosting.account, 'instructor_payable'),
            eq(ledgerPosting.instructorId, instructorId),
            gte(ledgerTransaction.occurredAt, from),
            lt(ledgerTransaction.occurredAt, to),
          ),
        )
        .orderBy(ledgerTransaction.occurredAt);
      return rows.map((r) => ({
        occurredAt: r.occurredAt,
        kind: statementKind(r.kind),
        courseId: r.courseId,
        amount: num(r.amount),
      }));
    },

    /** A course's sales by month: gross, and what its instructors earned. */
    async courseByMonth(exec: Executor, courseId: string, since: Date) {
      const rows = await exec
        .select({
          month,
          gross: sum(signedAmount),
          sales: saleCount,
        })
        .from(ledgerTransaction)
        .where(
          and(eq(ledgerTransaction.courseId, courseId), gte(ledgerTransaction.occurredAt, since)),
        )
        .groupBy(month)
        .orderBy(month);
      return rows.map((r) => ({ month: r.month, amount: num(r.gross), sales: num(r.sales) }));
    },

    /** Balance per account (credits shown positive), optionally limited to some courses. */
    async accountTotals(exec: Executor, courseIds?: readonly string[]) {
      const rows = await exec
        .select({
          account: ledgerPosting.account,
          total: sum(sql`-${ledgerPosting.amountPoisha}`),
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(
          and(
            notPayout,
            courseIds ? inArray(ledgerTransaction.courseId, [...courseIds]) : undefined,
          ),
        )
        .groupBy(ledgerPosting.account);
      const out = {
        gross: 0,
        platform: 0,
        instructors: 0,
        unassigned: 0,
      };
      for (const r of rows) {
        const v = num(r.total);
        if (r.account === 'gateway_clearing') out.gross = -v;
        if (r.account === 'platform_revenue') out.platform = v;
        if (r.account === 'instructor_payable') out.instructors = v;
        if (r.account === 'unassigned_instructor_pool') out.unassigned = v;
      }
      return out;
    },

    async platformByMonth(exec: Executor, since: Date) {
      const rows = await exec
        .select({
          month,
          gross: sum(signedAmount),
          sales: saleCount,
        })
        .from(ledgerTransaction)
        .where(and(gte(ledgerTransaction.occurredAt, since), notPayout))
        .groupBy(month)
        .orderBy(month);
      return rows.map((r) => ({ month: r.month, amount: num(r.gross), sales: num(r.sales) }));
    },

    async byCourse(exec: Executor) {
      const gross = sql<string>`coalesce(sum(${ledgerPosting.amountPoisha}) filter (where ${ledgerPosting.account} = 'gateway_clearing'), 0)`;
      const rows = await exec
        .select({
          courseId: ledgerTransaction.courseId,
          gross,
          platform: sql<string>`coalesce(-sum(${ledgerPosting.amountPoisha}) filter (where ${ledgerPosting.account} = 'platform_revenue'), 0)`,
          sales: sql<string>`count(distinct ${ledgerTransaction.transactionId}) filter (where ${ledgerTransaction.kind} <> 'attribution_reassignment')`,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(isNotNull(ledgerTransaction.courseId))
        .groupBy(ledgerTransaction.courseId)
        .orderBy(desc(gross));
      return rows.map((r) => ({
        courseId: r.courseId as string,
        gross: num(r.gross),
        sales: num(r.sales),
        platform: num(r.platform),
      }));
    },

    async byInstructor(exec: Executor) {
      const rows = await exec
        .select({
          instructorId: ledgerPosting.instructorId,
          earned: sum(sql`-${ledgerPosting.amountPoisha}`),
          sales: sql<string>`count(distinct ${ledgerPosting.transactionId})`,
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .where(and(eq(ledgerPosting.account, 'instructor_payable'), notPayout))
        .groupBy(ledgerPosting.instructorId)
        .orderBy(desc(sum(sql`-${ledgerPosting.amountPoisha}`)));
      return rows.map((r) => ({
        instructorId: r.instructorId as string,
        earned: num(r.earned),
        sales: num(r.sales),
      }));
    },

    /** Per entry type and account, what the whole ledger moved (credits positive). */
    async totalsByKind(exec: Executor) {
      const rows = await exec
        .select({
          kind: ledgerTransaction.kind,
          account: ledgerPosting.account,
          credit: sum(sql`-${ledgerPosting.amountPoisha}`),
        })
        .from(ledgerPosting)
        .innerJoin(
          ledgerTransaction,
          eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
        )
        .groupBy(ledgerTransaction.kind, ledgerPosting.account);
      const counts = await exec
        .select({ kind: ledgerTransaction.kind, n: sql<string>`count(*)` })
        .from(ledgerTransaction)
        .groupBy(ledgerTransaction.kind);
      return {
        totals: rows.map((r) => ({ kind: r.kind, account: r.account, credit: num(r.credit) })),
        transactions: new Map(counts.map((c) => [c.kind, num(c.n)])),
      };
    },

    /** Every account's balance straight from the postings (credits positive). */
    async accountBalances(exec: Executor) {
      const rows = await exec
        .select({
          account: ledgerPosting.account,
          amount: sql<string>`coalesce(-sum(${ledgerPosting.amountPoisha}), 0)`,
        })
        .from(ledgerPosting)
        .groupBy(ledgerPosting.account);
      return rows.map((r) => ({ account: r.account, amount: num(r.amount) }));
    },

    /** Sales counted for the books: course and platform sales (refunds and other entries not). */
    async salesCount(exec: Executor): Promise<number> {
      const [row] = await exec
        .select({ n: sql<string>`count(*)` })
        .from(ledgerTransaction)
        .where(inArray(ledgerTransaction.kind, ['course_sale', 'platform_sale']));
      return num(row?.n);
    },

    /**
     * The newest ledger transactions of every kind with their postings, for the admin's journal:
     * sales, refunds, reassignments, salaries, policy adjustments, payouts and referral money.
     */
    async recentSales(exec: Executor, page: number, pageSize: number) {
      const txs = await exec
        .select()
        .from(ledgerTransaction)
        .orderBy(desc(ledgerTransaction.occurredAt), desc(ledgerTransaction.transactionId))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [count] = await exec.select({ n: sql<string>`count(*)` }).from(ledgerTransaction);
      const postings = txs.length
        ? await exec
            .select()
            .from(ledgerPosting)
            .where(
              inArray(
                ledgerPosting.transactionId,
                txs.map((t) => t.transactionId),
              ),
            )
        : [];
      return {
        total: num(count?.n),
        rows: txs.map((t) => ({
          transactionId: t.transactionId,
          kind: t.kind,
          courseId: t.courseId,
          amount: t.amountPoisha,
          shareBps: t.instructorShareBps,
          occurredAt: t.occurredAt.toISOString(),
          postings: postings
            .filter((p) => p.transactionId === t.transactionId)
            .map((p) => ({
              account: p.account,
              instructorId: p.instructorId,
              referrerId: p.referrerId,
              amount: p.amountPoisha,
            })),
        })),
      };
    },
  };
}
