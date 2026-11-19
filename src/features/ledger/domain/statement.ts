// An instructor's monthly earnings statement (US7.8, monthly until payout cycles exist): every
// ledger line that changed what they are owed in an Asia/Dhaka calendar month, each labelled by its
// own kind (sale, refund, attribution reassignment, salary, pay-policy adjustment, payout), with the
// balance owed before and after. Money is integer poisha. Plain TypeScript.

/** Asia/Dhaka is UTC+6 all year. */
const DHAKA_OFFSET_MS = 6 * 3600 * 1000;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The UTC instants where a Dhaka month ("2026-11") starts and the next one starts. */
export function dhakaMonthRange(month: string): { from: Date; to: Date } | null {
  const m = MONTH.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  return {
    from: new Date(Date.UTC(year, index, 1) - DHAKA_OFFSET_MS),
    to: new Date(Date.UTC(year, index + 1, 1) - DHAKA_OFFSET_MS),
  };
}

/** Every kind of ledger entry that changes what an instructor is owed, each its own line. */
export const STATEMENT_LINE_KINDS = [
  'course_sale',
  'course_refund',
  'attribution_reassignment',
  'salary_accrual',
  'pay_policy_adjustment',
  'instructor_payout',
] as const;
export type StatementLineKind = (typeof STATEMENT_LINE_KINDS)[number];

export type StatementLine = {
  occurredAt: Date;
  kind: StatementLineKind;
  courseId: string | null;
  /** What this line added to (positive) or took from (negative) the amount owed. */
  amount: number;
};

export type Statement = {
  opening: number;
  /** Course sales (the instructor's share). */
  earned: number;
  refunded: number;
  /** US7.13: unassigned money moved to this instructor when an attribution case was resolved. */
  reassigned: number;
  /** US7.16: committed salary lines. */
  salary: number;
  /** US7.27: hybrid or salary policy share replacing the default share (either sign). */
  policyAdjustment: number;
  /** Paid out to the instructor this month (payout-cycle payments). */
  paidOut: number;
  /** earned − refunded + reassigned + salary + policyAdjustment: this month, before payouts. */
  net: number;
  closing: number;
  lines: StatementLine[];
};

/**
 * Totals that always add up: closing = opening + net − paidOut, which is exactly opening + the sum
 * of the lines (conservation): every line belongs to exactly one total.
 */
export function buildStatement(opening: number, lines: readonly StatementLine[]): Statement {
  const sorted = [...lines].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const total = (kind: StatementLineKind) =>
    sorted.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const earned = total('course_sale');
  const refunded = 0 - total('course_refund');
  const reassigned = total('attribution_reassignment');
  const salary = total('salary_accrual');
  const policyAdjustment = total('pay_policy_adjustment');
  const paidOut = 0 - total('instructor_payout');
  const net = earned - refunded + reassigned + salary + policyAdjustment;
  return {
    opening,
    earned,
    refunded,
    reassigned,
    salary,
    policyAdjustment,
    paidOut,
    net,
    closing: opening + net - paidOut,
    lines: sorted,
  };
}
