// [LT] Refund postings: a refund reverses its sale in proportion, to the poisha, never more than
// each line received, and always balanced.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { refundPostings } from './refund-split.ts';
import type { Posting } from './revenue-split.ts';

const sale: Posting[] = [
  { account: 'gateway_clearing', instructorId: null, amount: 100_000 },
  { account: 'platform_revenue', instructorId: null, amount: -30_000 },
  { account: 'instructor_payable', instructorId: 'a', amount: -46_667 },
  { account: 'instructor_payable', instructorId: 'b', amount: -23_333 },
];
const sum = (ps: readonly Posting[]) => ps.reduce((s, p) => s + p.amount, 0);

describe('refundPostings', () => {
  it('a full refund is the exact reverse of the sale', () => {
    const r = refundPostings(sale, 100_000);
    expect(r.ok && r.value).toEqual(sale.map((p) => ({ ...p, amount: -p.amount })));
  });
  it('a half refund takes back half of each line, balanced to the poisha', () => {
    const r = refundPostings(sale, 50_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sum(r.value)).toBe(0);
    expect(r.value.find((p) => p.account === 'gateway_clearing')?.amount).toBe(-50_000);
    expect(r.value.find((p) => p.account === 'platform_revenue')?.amount).toBe(15_000);
  });
  it('refuses more than the sale, and nothing', () => {
    expect(refundPostings(sale, 100_001).ok).toBe(false);
    expect(refundPostings(sale, 0).ok).toBe(false);
  });
  it('is always balanced and never takes back more than a line received', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.double({ min: 0.0001, max: 1, noNaN: true }),
        (credits, fraction) => {
          const total = credits.reduce((s, c) => s + c, 0);
          const lines: Posting[] = [
            { account: 'gateway_clearing', instructorId: null, amount: total },
            ...credits.map((c, i) => ({
              account: 'instructor_payable' as const,
              instructorId: `i${i}`,
              amount: -c,
            })),
          ];
          const refund = Math.max(1, Math.floor(total * fraction));
          const r = refundPostings(lines, refund);
          if (!r.ok) return false;
          return (
            sum(r.value) === 0 &&
            r.value.every((p) => {
              const original = lines.find(
                (l) => l.account === p.account && l.instructorId === p.instructorId,
              ) as Posting;
              return (
                Math.sign(p.amount) === -Math.sign(original.amount) &&
                Math.abs(p.amount) <= Math.abs(original.amount)
              );
            })
          );
        },
      ),
    );
  });
});
