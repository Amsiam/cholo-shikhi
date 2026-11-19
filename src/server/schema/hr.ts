// HR records for instructors (U9; US7.1, US7.10, US7.24; screens A7, A8): pay-policy versions,
// employee records and the leave ledger. The payout cycle reads them for salary lines (US7.16)
// behind the payouts.payrollAndAttribution flag. Money is integer poisha in bigint columns, shares
// are basis points, and dates are Asia/Dhaka calendar dates. Instructor IDs are U1 user IDs, not
// foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });

export const PAY_POLICY_KINDS = ['revenue_share', 'salary', 'per_piece', 'hybrid'] as const;

/**
 * US7.1: each change to an instructor's pay policy is a new version, effective from 00:00 (Asia/
 * Dhaka) on the 1st of the next cycle, so a past or current cycle is never altered.
 */
export const payPolicyVersion = pgTable(
  'pay_policy_version',
  {
    versionId: uuid('version_id').primaryKey().defaultRandom(), // C2
    instructorId: uuid('instructor_id').notNull(), // C3
    version: integer('version').notNull(), // C2
    kind: text('kind', { enum: PAY_POLICY_KINDS }).notNull(), // C3
    shareBps: integer('share_bps'), // C3
    salaryPoisha: bigint('salary_poisha', { mode: 'number' }), // C3
    perPiecePoisha: bigint('per_piece_poisha', { mode: 'number' }), // C3
    effectiveFrom: ts('effective_from').notNull(), // C2
    createdBy: uuid('created_by').notNull(), // C3
    createdAt: ts('created_at').notNull(), // C2
  },
  (t) => [
    unique('pay_policy_version_uq').on(t.instructorId, t.version),
    check('pay_policy_version_ck', sql`${t.version} >= 1`),
    check(
      'pay_policy_kind_ck',
      sql`${t.kind} in ('revenue_share', 'salary', 'per_piece', 'hybrid')`,
    ),
    check(
      'pay_policy_components_ck',
      sql`(${t.kind} = 'revenue_share' and ${t.shareBps} is not null and ${t.salaryPoisha} is null and ${t.perPiecePoisha} is null)
        or (${t.kind} = 'salary' and ${t.salaryPoisha} is not null and ${t.shareBps} is null and ${t.perPiecePoisha} is null)
        or (${t.kind} = 'per_piece' and ${t.perPiecePoisha} is not null and ${t.shareBps} is null and ${t.salaryPoisha} is null)
        or (${t.kind} = 'hybrid' and ${t.salaryPoisha} is not null and ${t.shareBps} is not null and ${t.perPiecePoisha} is null)`,
    ),
    check(
      'pay_policy_amounts_ck',
      sql`(${t.shareBps} is null or ${t.shareBps} between 0 and 10000) and coalesce(${t.salaryPoisha}, 0) >= 0 and coalesce(${t.perPiecePoisha}, 0) >= 0`,
    ),
    index('pay_policy_instructor_idx').on(t.instructorId, t.effectiveFrom),
  ],
);

/** US7.10: HR-light record of an Employee instructor (never of a Contractor). */
export const employeeRecord = pgTable(
  'employee_record',
  {
    instructorId: uuid('instructor_id').primaryKey(), // C3
    salaryPoisha: bigint('salary_poisha', { mode: 'number' }), // C3
    joinedOn: day('joined_on'), // C3
    exitOn: day('exit_on'), // C3
    /** US7.24: whole days of leave left. */
    leaveBalanceDays: integer('leave_balance_days').notNull().default(0), // C3
    updatedBy: uuid('updated_by').notNull(), // C3
    updatedAt: ts('updated_at').notNull(), // C2
  },
  (t) => [
    check('employee_record_salary_ck', sql`${t.salaryPoisha} is null or ${t.salaryPoisha} >= 0`),
    check(
      'employee_record_dates_ck',
      sql`${t.exitOn} is null or ${t.joinedOn} is null or ${t.exitOn} >= ${t.joinedOn}`,
    ),
    check('employee_record_balance_ck', sql`${t.leaveBalanceDays} between 0 and 366`),
  ],
);

export const LEAVE_KINDS = ['leave', 'absence'] as const;

/**
 * US7.24: the leave ledger. Leave is taken from the balance; an absence beyond the balance is
 * recorded as "absence without leave" (for review by payroll, never an automatic deduction).
 */
export const leaveEntry = pgTable(
  'leave_entry',
  {
    entryId: uuid('entry_id').primaryKey().defaultRandom(), // C2
    instructorId: uuid('instructor_id').notNull(), // C3
    kind: text('kind', { enum: LEAVE_KINDS }).notNull(), // C3
    startsOn: day('starts_on').notNull(), // C3
    endsOn: day('ends_on').notNull(), // C3
    days: integer('days').notNull(), // C3
    isWithoutLeave: boolean('is_without_leave').notNull(), // C3
    balanceAfter: integer('balance_after').notNull(), // C3
    note: text('note'), // C3
    recordedBy: uuid('recorded_by').notNull(), // C3
    recordedAt: ts('recorded_at').notNull(), // C2
  },
  (t) => [
    check('leave_entry_kind_ck', sql`${t.kind} in ('leave', 'absence')`),
    check('leave_entry_dates_ck', sql`${t.endsOn} >= ${t.startsOn}`),
    check('leave_entry_days_ck', sql`${t.days} >= 1 and ${t.balanceAfter} >= 0`),
    index('leave_entry_instructor_idx').on(t.instructorId, t.startsOn),
  ],
);
