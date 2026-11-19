// Ledger (double-entry). One transaction per money event (today: a course sale), with signed
// postings: a debit is positive, a credit negative, and every transaction's postings sum to zero
// (deferred constraint trigger, migration 0014). Rows are append-only: an update or delete is
// refused by a trigger, so a correction is always a new, reversing transaction.
// Data class per column (NFR5.201): C2 internal. Money is integer poisha in bigint columns.
// Cross-unit IDs (payment, course, instructor) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A refund reverses part or all of a sale; both point at the same payment. */
/** platform_sale: an exam package or subscription, all platform revenue, no course. */
/**
 * instructor_payout: money paid out to an instructor for a payout-cycle line (its line ID is the
 * source): the payable is debited and the cash (gateway_clearing) credited; no course.
 */
/**
 * attribution_reassignment (US7.13; source: the resolved attribution case): the disputed section's
 * share of the unassigned pool moved to the confirmed owner: the pool is debited and the owner's
 * payable credited, once per case.
 */
/**
 * salary_accrual (US7.16; source: the payout-cycle line): a committed salary line: salary_expense is
 * debited and the instructor's payable credited, no cash and no course; paid out by the line.
 */
/**
 * pay_policy_adjustment (US7.27; source: the payout-cycle line): a hybrid or salary policy's share
 * replacing the default credit: between the instructor's payable and platform revenue (either
 * way), no cash and no course.
 */
/**
 * Referrals (US8.7/US8.8), separate from instructor payouts and with no course:
 * referral_accrual (source: the referred payment) debits referral_expense and credits the
 * referrer's referral_payable; referral_clawback (source: the refunded payment) reverses part or all
 * of it; referral_payout (source: the withdrawal) debits the payable and credits the cash.
 */
export const LEDGER_TRANSACTION_KINDS = [
  'course_sale',
  'course_refund',
  'platform_sale',
  'instructor_payout',
  'referral_accrual',
  'referral_clawback',
  'referral_payout',
  'attribution_reassignment',
  'salary_accrual',
  'pay_policy_adjustment',
] as const;
export const LEDGER_ACCOUNT_NAMES = [
  'gateway_clearing',
  'platform_revenue',
  'instructor_payable',
  'unassigned_instructor_pool',
  'referral_payable',
  'referral_expense',
  'salary_expense',
] as const;

export const ledgerTransaction = pgTable(
  'ledger_transaction',
  {
    transactionId: uuid('transaction_id').primaryKey().defaultRandom(), // C2
    kind: text('kind', { enum: LEDGER_TRANSACTION_KINDS }).notNull(), // C2
    sourcePaymentId: uuid('source_payment_id').notNull(), // C2
    courseId: uuid('course_id'), // C2, none for a platform sale
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2
    instructorShareBps: integer('instructor_share_bps').notNull(), // C2
    occurredAt: ts('occurred_at').notNull(), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check(
      'ledger_tx_kind_ck',
      sql`${t.kind} in ('course_sale', 'course_refund', 'platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout', 'attribution_reassignment', 'salary_accrual', 'pay_policy_adjustment')`,
    ),
    check(
      'ledger_tx_course_ck',
      sql`${t.kind} in ('platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout', 'salary_accrual', 'pay_policy_adjustment') or ${t.courseId} is not null`,
    ),
    // One sale and at most one refund per payment.
    unique('ledger_tx_payment_kind_uq').on(t.sourcePaymentId, t.kind),
    check('ledger_tx_amount_ck', sql`${t.amountPoisha} >= 0`),
    check('ledger_tx_bps_ck', sql`${t.instructorShareBps} between 0 and 10000`),
    index('ledger_tx_course_idx').on(t.courseId, t.occurredAt),
    index('ledger_tx_occurred_idx').on(t.occurredAt),
  ],
);

export const ledgerPosting = pgTable(
  'ledger_posting',
  {
    postingId: uuid('posting_id').primaryKey().defaultRandom(), // C2
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransaction.transactionId, { onDelete: 'restrict' }), // C2
    account: text('account', { enum: LEDGER_ACCOUNT_NAMES }).notNull(), // C2
    instructorId: uuid('instructor_id'), // C2
    /** The referrer a referral_payable posting belongs to. */
    referrerId: uuid('referrer_id'), // C3
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2, debit + / credit -
  },
  (t) => [
    check(
      'ledger_posting_account_ck',
      sql`${t.account} in ('gateway_clearing', 'platform_revenue', 'instructor_payable', 'unassigned_instructor_pool', 'referral_payable', 'referral_expense', 'salary_expense')`,
    ),
    check(
      'ledger_posting_instructor_ck',
      sql`(${t.account} = 'instructor_payable') = (${t.instructorId} is not null)`,
    ),
    check(
      'ledger_posting_referrer_ck',
      sql`(${t.account} = 'referral_payable') = (${t.referrerId} is not null)`,
    ),
    index('ledger_posting_referrer_idx').on(t.referrerId, t.account),
    check('ledger_posting_nonzero_ck', sql`${t.amountPoisha} <> 0`),
    index('ledger_posting_tx_idx').on(t.transactionId),
    index('ledger_posting_instructor_idx').on(t.instructorId, t.account),
  ],
);
