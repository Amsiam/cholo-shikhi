// Hybrid and salary policy lines (US7.27, US7.1 kinds). Plain TypeScript: no framework, DB or env
// access. Money is integer poisha; products use BigInt.
//
// At sale time the ledger credits every instructor the platform default share of the revenue
// attributed to their sections (../../ledger/domain/revenue-split.ts). A policy whose own share
// differs replaces that credit for the cycle:
//   - hybrid: salary (prorated, ./payroll.ts) + floor(attributed × shareBps / 10 000)
//     (AC7.27.1: 2000000 + floor(1000000 × 1500 / 10000) = 2150000). The share is not offset
//     against the salary [assumption]. Only sales and refunds in the cycle count (AC7.27.2).
//   - salary: salary only; the revenue share is 0.
//   - any other policy: the ledger's credit stands (no adjustment).
// The cycle posts the difference (policy share − ledger credit) as a pay-policy adjustment between
// the instructor's payable and platform revenue, so money is conserved to the poisha.
//
// The rounding rules, once:
//   - attributed revenue of one sale or refund = floor(|amount| × the instructor's sections /
//     all owned sections at the sale), with the sign of the transaction (a refund is negative);
//   - the share = floor(total attributed × shareBps / 10 000), rounded toward minus infinity, so a
//     fraction of a poisha always stays with the platform (never paid, never owed twice).

export type AttributedTransaction = {
  /** The sale or refund amount in poisha (always ≥ 0). */
  amount: number;
  kind: 'course_sale' | 'course_refund';
  /** The instructor's sections, and all owned sections, at the moment of the sale. */
  sections: number;
  totalSections: number;
  /** What the ledger credited the instructor's payable for it (negative for a refund). */
  credited: number;
};

function assertPoisha(value: number, name: string, allowNegative = false) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be whole poisha`);
  if (!allowNegative && value < 0) throw new Error(`${name} must not be negative`);
}

/** Floor division of BigInts toward minus infinity. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** One transaction's revenue attributed to the instructor (signed). */
export function attributedOf(t: AttributedTransaction): number {
  assertPoisha(t.amount, 'amount');
  if (!Number.isInteger(t.sections) || !Number.isInteger(t.totalSections))
    throw new Error('sections must be whole');
  if (t.totalSections <= 0 || t.sections <= 0) return 0;
  if (t.sections > t.totalSections) throw new Error('more sections than the course had');
  const part = Number((BigInt(t.amount) * BigInt(t.sections)) / BigInt(t.totalSections));
  return t.kind === 'course_refund' ? -part : part;
}

/** floor(attributed × shareBps / 10 000), toward minus infinity. */
export function shareOf(attributed: number, shareBps: number): number {
  assertPoisha(attributed, 'attributed', true);
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000)
    throw new Error('shareBps must be 0..10000');
  return Number(floorDiv(BigInt(attributed) * BigInt(shareBps), 10_000n));
}

/** AC7.27.1: a hybrid line = salary part + share of the attributed revenue. */
export function hybridLine(input: { salary: number; attributed: number; shareBps: number }) {
  assertPoisha(input.salary, 'salary');
  const share = shareOf(input.attributed, input.shareBps);
  return { salary: input.salary, share, total: input.salary + share };
}

export type PolicyAdjustment = {
  attributed: number;
  /** The policy's revenue share for the cycle. */
  share: number;
  /** What the ledger credited for the same sales and refunds. */
  credited: number;
  /** share − credited: added to the line and posted between the payable and platform revenue. */
  adjustment: number;
};

/** The cycle's adjustment for an instructor's policy, from their sales and refunds in the cycle. */
export function policyAdjustment(
  policy: { kind: 'revenue_share' | 'salary' | 'per_piece' | 'hybrid'; shareBps: number | null },
  transactions: readonly AttributedTransaction[],
): PolicyAdjustment {
  let attributed = 0;
  let credited = 0;
  for (const t of transactions) {
    assertPoisha(t.credited, 'credited', true);
    attributed += attributedOf(t);
    credited += t.credited;
  }
  if (policy.kind === 'hybrid') {
    const share = shareOf(attributed, policy.shareBps ?? 0);
    return { attributed, share, credited, adjustment: share - credited };
  }
  if (policy.kind === 'salary') return { attributed, share: 0, credited, adjustment: -credited };
  return { attributed, share: credited, credited, adjustment: 0 };
}
