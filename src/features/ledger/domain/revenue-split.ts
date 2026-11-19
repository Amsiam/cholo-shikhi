// How one course sale is shared between the platform and the course's instructors. Plain
// TypeScript: no framework, DB or env access. This is the single place the rounding rule lives
// (src/lib/money.ts defers to it).
//
// The rule, in order:
//   1. The instructor pool is floor(amount × shareBps / 10 000). The platform keeps the rest, so any
//      fraction of a poisha from the percentage goes to the platform, never to an instructor.
//   2. The pool is shared by section count (PRD FR-INSTR-6 default): each instructor receives one
//      part per section they own at the moment of sale. Each share is floor(pool × sections / total).
//   3. Poisha left over from step 2 are handed out one at a time to the instructors with the largest
//      remainders; equal remainders go to the lower instructor ID first. The result does not depend
//      on the order the sections are listed in.
//   4. When no section has an owner, the whole pool is held as "unassigned" so it is never silently
//      kept by the platform or given to the wrong person.
// Every split conserves money exactly: platform + instructor shares + unassigned = amount.
import { type AppError, appError } from '#src/lib/errors.ts';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

/** Instructors receive 70% of each sale by default (the human's decision, 2026-11-18). */
export const DEFAULT_INSTRUCTOR_SHARE_BPS = 7000;
export const BPS_DENOMINATOR = 10_000;

export type SectionOwnership = { sectionId: string; instructorId: string };

export type InstructorShare = {
  instructorId: string;
  sections: number;
  amount: MoneyPoisha;
};

export type SaleSplit = {
  amount: MoneyPoisha;
  shareBps: number;
  platform: MoneyPoisha;
  /** Sorted by instructor ID, so the same sale always posts in the same order. */
  instructors: InstructorShare[];
  unassigned: MoneyPoisha;
};

const invalid = (field: string) =>
  appError('VALIDATION_FAILED', { fieldErrors: { [field]: [`errors.ledger.${field}Invalid`] } });

export function splitSale(
  amount: number,
  owners: readonly SectionOwnership[],
  shareBps: number = DEFAULT_INSTRUCTOR_SHARE_BPS,
): Result<SaleSplit, AppError<'VALIDATION_FAILED'>> {
  if (!Number.isSafeInteger(amount) || amount < 0) return err(invalid('amount'));
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > BPS_DENOMINATOR)
    return err(invalid('shareBps'));

  // BigInt keeps amount × bps exact for every safe-integer amount.
  const pool = Number((BigInt(amount) * BigInt(shareBps)) / BigInt(BPS_DENOMINATOR));
  const platform = amount - pool;

  // A section listed twice counts once; its owner is the first listed (snapshots never repeat one).
  const ownerOf = new Map<string, string>();
  for (const o of owners) if (!ownerOf.has(o.sectionId)) ownerOf.set(o.sectionId, o.instructorId);
  const counts = new Map<string, number>();
  for (const instructorId of ownerOf.values())
    counts.set(instructorId, (counts.get(instructorId) ?? 0) + 1);
  const totalSections = ownerOf.size;

  if (totalSections === 0) {
    return ok({
      amount: amount as MoneyPoisha,
      shareBps,
      platform: platform as MoneyPoisha,
      instructors: [],
      unassigned: pool as MoneyPoisha,
    });
  }

  const ids = [...counts.keys()].sort();
  const big = BigInt(pool);
  const total = BigInt(totalSections);
  const rows = ids.map((instructorId) => {
    const sections = counts.get(instructorId) as number;
    const exact = big * BigInt(sections);
    return { instructorId, sections, base: exact / total, remainder: exact % total };
  });
  let leftover = big - rows.reduce((sum, r) => sum + r.base, 0n);
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.instructorId < b.instructorId
        ? -1
        : 1
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  const extra = new Map<string, bigint>();
  for (const r of order) {
    if (leftover === 0n) break;
    extra.set(r.instructorId, 1n);
    leftover -= 1n;
  }
  return ok({
    amount: amount as MoneyPoisha,
    shareBps,
    platform: platform as MoneyPoisha,
    instructors: rows.map((r) => ({
      instructorId: r.instructorId,
      sections: r.sections,
      amount: Number(r.base + (extra.get(r.instructorId) ?? 0n)) as MoneyPoisha,
    })),
    unassigned: 0 as MoneyPoisha,
  });
}

/** Ledger accounts. A posting's amount is signed: a debit is positive, a credit negative. */
export const LEDGER_ACCOUNTS = [
  'gateway_clearing',
  'platform_revenue',
  'instructor_payable',
  'unassigned_instructor_pool',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export type Posting = { account: LedgerAccount; instructorId: string | null; amount: number };

/**
 * The balanced postings for a sale: the gateway owes us the amount (debit), and that amount is
 * credited to platform revenue, each instructor's payable and any unassigned pool. Zero lines are
 * left out; the postings always sum to zero.
 */
export function salePostings(split: SaleSplit): Posting[] {
  const credits: Posting[] = [
    { account: 'platform_revenue', instructorId: null, amount: -split.platform },
    ...split.instructors.map((s) => ({
      account: 'instructor_payable' as const,
      instructorId: s.instructorId,
      amount: -s.amount,
    })),
    { account: 'unassigned_instructor_pool', instructorId: null, amount: -split.unassigned },
  ];
  const debit: Posting = { account: 'gateway_clearing', instructorId: null, amount: split.amount };
  return [debit, ...credits].filter((p) => p.amount !== 0);
}
