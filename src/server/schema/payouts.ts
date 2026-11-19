// Payout cycles (U9; US7.2–US7.5, revenue share only). A committed cycle is a locked snapshot:
// its line amounts never change (a trigger refuses updates to them and any delete), only a line's
// payment state moves forward. Every line satisfies conservation in the database itself:
// payout − carry_out = earned + salary + adjustment − carry_in. Money is integer poisha in bigint columns.
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const poisha = (name: string) => bigint(name, { mode: 'number' }).notNull();

export const payoutCycle = pgTable(
  'payout_cycle',
  {
    cycleId: uuid('cycle_id').primaryKey().defaultRandom(), // C2
    /** The Asia/Dhaka month the cycle closes ("2026-11"). */
    month: text('month').notNull(), // C2
    /** The ledger cut-off: sales and refunds before this instant belong to this or earlier cycles. */
    periodEnd: ts('period_end').notNull(), // C2
    inputHash: text('input_hash').notNull(), // C2
    totalEarned: poisha('total_earned'), // C2
    totalPayout: poisha('total_payout'), // C2
    totalCarryIn: poisha('total_carry_in'), // C2
    totalCarryOut: poisha('total_carry_out'), // C2
    /** US7.16: salary lines in the cycle (0 before payroll, or with the new rules off). */
    totalSalary: bigint('total_salary', { mode: 'number' }).notNull().default(0), // C2
    /** US7.27: hybrid and salary policy adjustments in the cycle (signed). */
    totalAdjustment: bigint('total_adjustment', { mode: 'number' }).notNull().default(0), // C2
    committedBy: uuid('committed_by').notNull(), // C3
    committedAt: ts('committed_at').notNull(), // C2
  },
  (t) => [
    unique('payout_cycle_month_uq').on(t.month),
    check('payout_cycle_month_ck', sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check('payout_cycle_hash_ck', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const PAYOUT_LINE_STATES = ['pending', 'held', 'disbursed'] as const;

export const payoutLine = pgTable(
  'payout_line',
  {
    lineId: uuid('line_id').primaryKey().defaultRandom(), // C2
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => payoutCycle.cycleId, { onDelete: 'restrict' }), // C2
    instructorId: uuid('instructor_id').notNull(), // C3
    earned: poisha('earned'), // C3
    carryIn: poisha('carry_in'), // C3
    payout: poisha('payout'), // C3
    carryOut: poisha('carry_out'), // C3
    /** US7.16: the month's salary line (0 for anyone not on payroll). */
    salary: bigint('salary', { mode: 'number' }).notNull().default(0), // C3
    /**
     * US7.27: a hybrid or salary policy's revenue share less what the ledger credited for the same
     * sales (signed; 0 for every other policy).
     */
    adjustment: bigint('adjustment', { mode: 'number' }).notNull().default(0), // C3
    state: text('state', { enum: PAYOUT_LINE_STATES }).notNull(), // C3
    /** Why a line is held: KYC/account not verified at commit, or a failed payment. */
    holdReason: text('hold_reason', { enum: ['kyc', 'failed'] }), // C3
    /** Finance's note on a failure (shown to the instructor); never an account number. */
    holdNote: text('hold_note'), // C3
    /** The payment's reference from bKash, Nagad or the bank (recorded by the Admin). */
    providerRef: text('provider_ref'), // C3
    /** One key per payment attempt: a retry with the same key never pays twice. */
    idempotencyKey: text('idempotency_key'), // C2
    disbursedAt: ts('disbursed_at'), // C3
    disbursedBy: uuid('disbursed_by'), // C3
    releasedAt: ts('released_at'), // C3
    updatedAt: ts('updated_at').notNull(), // C2
  },
  (t) => [
    unique('payout_line_cycle_instructor_uq').on(t.cycleId, t.instructorId),
    unique('payout_line_idempotency_uq').on(t.idempotencyKey),
    check(
      'payout_line_amounts_ck',
      sql`${t.payout} >= 0 and ${t.carryIn} >= 0 and ${t.carryOut} >= 0 and ${t.salary} >= 0`,
    ),
    check(
      'payout_line_conservation_ck',
      sql`${t.payout} - ${t.carryOut} = ${t.earned} + ${t.salary} + ${t.adjustment} - ${t.carryIn}`,
    ),
    check('payout_line_state_ck', sql`${t.state} in ('pending', 'held', 'disbursed')`),
    check('payout_line_hold_ck', sql`(${t.state} = 'held') = (${t.holdReason} is not null)`),
    check('payout_line_paid_ck', sql`(${t.state} = 'disbursed') = (${t.disbursedAt} is not null)`),
    index('payout_line_instructor_idx').on(t.instructorId),
  ],
);

/**
 * US7.8 / FR7.4: each payout line's statement, stored when the cycle is committed (CSV in Bangla and
 * English, through the platform renderer) and kept until `retain_until` (at least 10 years).
 */
export const payoutStatement = pgTable(
  'payout_statement',
  {
    statementId: uuid('statement_id').primaryKey().defaultRandom(), // C2
    lineId: uuid('line_id')
      .notNull()
      .references(() => payoutLine.lineId, { onDelete: 'restrict' }), // C2
    locale: text('locale', { enum: ['bn', 'en'] }).notNull(), // C2
    format: text('format', { enum: ['csv'] }).notNull(), // C2
    objectKey: text('object_key').notNull(), // C3
    sha256: text('sha256').notNull(), // C2
    createdAt: ts('created_at').notNull(), // C2
    retainUntil: ts('retain_until').notNull(), // C2
  },
  (t) => [
    unique('payout_statement_line_locale_uq').on(t.lineId, t.locale, t.format),
    check('payout_statement_locale_ck', sql`${t.locale} in ('bn', 'en')`),
    check('payout_statement_retention_ck', sql`${t.retainUntil} > ${t.createdAt}`),
  ],
);

export const ATTRIBUTION_CASE_STATES = ['open', 'resolved'] as const;

/**
 * US7.13 / FR7.7: an ambiguous attribution case (for example two instructors both claiming a
 * section, or a section without an owner) queued for Finance. Resolving it confirms the section's
 * owner with a reason; the override is audit-logged. Open cases are flagged on the A1 dry run.
 */
export const attributionCase = pgTable(
  'attribution_case',
  {
    caseId: uuid('case_id').primaryKey().defaultRandom(), // C2
    courseId: uuid('course_id').notNull(), // C2
    sectionId: uuid('section_id').notNull(), // C2
    /** The instructors who claim the section (at least one). */
    claimantIds: uuid('claimant_ids').array().notNull(), // C3
    description: text('description').notNull(), // C2
    state: text('state', { enum: ATTRIBUTION_CASE_STATES }).notNull().default('open'), // C2
    openedBy: uuid('opened_by').notNull(), // C3
    openedAt: ts('opened_at').notNull(), // C2
    /** The confirmed owner (one of the claimants) and why. */
    ownerId: uuid('owner_id'), // C3
    reason: text('reason'), // C2
    resolvedBy: uuid('resolved_by'), // C3
    resolvedAt: ts('resolved_at'), // C2
  },
  (t) => [
    check('attribution_case_state_ck', sql`${t.state} in ('open', 'resolved')`),
    check('attribution_case_claimants_ck', sql`cardinality(${t.claimantIds}) >= 1`),
    check(
      'attribution_case_resolved_ck',
      sql`(${t.state} = 'resolved') = (${t.ownerId} is not null and ${t.reason} is not null and ${t.resolvedAt} is not null)`,
    ),
    index('attribution_case_state_idx').on(t.state, t.openedAt),
  ],
);

/**
 * US7.13 attribution money (the human's choice): resolving a case moves the disputed section's share
 * of the unassigned pool to the confirmed owner. One row per resolved case, computed at resolution.
 * It is posted to the ledger (unassigned pool → owner's payable, paid in the next payout cycle) only
 * while the payouts.payrollAndAttribution flag is on and the draft golden set is approved; until
 * then it waits as pending (posted_at null). A case with nothing to move is posted with 0.
 */
export const attributionReassignment = pgTable(
  'attribution_reassignment',
  {
    caseId: uuid('case_id')
      .primaryKey()
      .references(() => attributionCase.caseId, { onDelete: 'restrict' }), // C2
    courseId: uuid('course_id').notNull(), // C2
    sectionId: uuid('section_id').notNull(), // C2
    ownerId: uuid('owner_id').notNull(), // C3
    totalPoisha: poisha('total_poisha'), // C3
    computedAt: ts('computed_at').notNull(), // C2
    postedAt: ts('posted_at'), // C2
    postedBy: uuid('posted_by'), // C3
  },
  (t) => [
    check('attribution_reassignment_total_ck', sql`${t.totalPoisha} >= 0`),
    check(
      'attribution_reassignment_posted_ck',
      sql`(${t.postedAt} is null) = (${t.postedBy} is null)`,
    ),
    index('attribution_reassignment_pending_idx').on(t.postedAt),
  ],
);

/**
 * The per-sale parts of a reassignment. A sale's share for a section moves at most once, whichever
 * case moves it (unique payment and section), so re-resolving never moves money twice.
 */
export const attributionReassignmentItem = pgTable(
  'attribution_reassignment_item',
  {
    itemId: uuid('item_id').primaryKey().defaultRandom(), // C2
    caseId: uuid('case_id')
      .notNull()
      .references(() => attributionReassignment.caseId, { onDelete: 'restrict' }), // C2
    paymentId: uuid('payment_id').notNull(), // C2
    sectionId: uuid('section_id').notNull(), // C2
    amountPoisha: poisha('amount_poisha'), // C3
  },
  (t) => [
    unique('attribution_reassignment_item_uq').on(t.paymentId, t.sectionId),
    check('attribution_reassignment_item_amount_ck', sql`${t.amountPoisha} > 0`),
    index('attribution_reassignment_item_case_idx').on(t.caseId),
  ],
);
