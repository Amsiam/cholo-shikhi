// Attribution money (US7.13, the human's choice of 2026-11-19). Plain TypeScript: no framework, DB
// or env access. Money is integer poisha.
//
// A sale of a course in which no section had an owner holds the whole instructor pool as
// "unassigned" (../../ledger/domain/revenue-split.ts, rule 4). When Finance resolves a dispute by
// confirming a section's owner, that owner receives the disputed section's share of the unassigned
// pool for every sale so far, posted to the ledger as one balanced reassignment (unassigned pool →
// the owner's payable) and paid in the next payout cycle by the usual cycle window.
//
// The rounding rule, once: a sale's share for one section is
//   floor(net unassigned of the sale / number of sections the course had at the sale)
// where "net" is the sale's unassigned credit less any refund of it. Poisha left over by the floor
// stay in the unassigned pool (never given to the wrong person). A section created after the sale
// gets nothing from it. A share is moved once per sale and section: resolving again, or a second
// case on the same section, moves only what has not been moved yet and never moves money back.

export type UnassignedSale = {
  paymentId: string;
  /** The sale's unassigned credit less refunds of it, in poisha. */
  netUnassigned: number;
  /** The course's sections at the instant of the sale. */
  sectionIds: readonly string[];
};

export type ReassignmentPlan = {
  /** Sorted by payment ID; every amount is above 0. */
  items: Array<{ paymentId: string; amount: number }>;
  total: number;
};

function assertPoisha(value: number, name: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be whole poisha`);
}

/** One section's share of one sale's unassigned pool (0 if it did not exist then). */
export function sectionShareOf(sale: UnassignedSale, sectionId: string): number {
  assertPoisha(sale.netUnassigned, 'netUnassigned');
  const sections = new Set(sale.sectionIds);
  if (sale.netUnassigned <= 0 || !sections.has(sectionId)) return 0;
  return Math.floor(sale.netUnassigned / sections.size);
}

/**
 * What resolving a case for `sectionId` moves now: each sale's share less what earlier cases already
 * moved for the same sale and section (never negative).
 */
export function planReassignment(
  sales: readonly UnassignedSale[],
  sectionId: string,
  alreadyMoved: ReadonlyMap<string, number>,
): ReassignmentPlan {
  if (new Set(sales.map((s) => s.paymentId)).size !== sales.length)
    throw new Error('a payment appears twice');
  const items: ReassignmentPlan['items'] = [];
  for (const sale of [...sales].sort((a, b) =>
    a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0,
  )) {
    const moved = alreadyMoved.get(sale.paymentId) ?? 0;
    assertPoisha(moved, 'alreadyMoved');
    const amount = sectionShareOf(sale, sectionId) - moved;
    if (amount > 0) items.push({ paymentId: sale.paymentId, amount });
  }
  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}
