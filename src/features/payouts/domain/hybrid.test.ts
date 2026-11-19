// [LT] US7.27 hybrid line (and a salary policy's zero share): salary + floor(attributed × bps),
// the share not offset against the salary, refunds negative, and the adjustment against the
// ledger's credit conserving money to the poisha.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attributedOf, hybridLine, policyAdjustment, shareOf } from './hybrid.ts';
import { assemblePayCycle } from './pay-cycle.ts';

const sale = (amount: number, sections = 1, totalSections = 1, credited = 0) => ({
  amount,
  kind: 'course_sale' as const,
  sections,
  totalSections,
  credited,
});
const refund = (amount: number, sections = 1, totalSections = 1, credited = 0) => ({
  ...sale(amount, sections, totalSections, credited),
  kind: 'course_refund' as const,
});

describe('hybrid line', () => {
  it('AC7.27.1: 2000000 + 1500 bp on 1000000 attributed = 2150000', () => {
    expect(hybridLine({ salary: 2_000_000, attributed: 1_000_000, shareBps: 1500 })).toEqual({
      salary: 2_000_000,
      share: 150_000,
      total: 2_150_000,
    });
  });

  it('AC7.27.2: a leaver’s salary part is prorated, the share counts only the month’s sales', () => {
    expect(hybridLine({ salary: 1_000_000, attributed: 93_333, shareBps: 1500 })).toEqual({
      salary: 1_000_000,
      share: 13_999,
      total: 1_013_999,
    });
  });

  it('rounds the share down, a refund’s share toward minus infinity', () => {
    expect(shareOf(10_001, 3500)).toBe(3500);
    expect(shareOf(-10_001, 1500)).toBe(-1501);
    expect(shareOf(0, 1500)).toBe(0);
    expect(() => shareOf(1, 10_001)).toThrow();
    expect(() => shareOf(0.5, 1)).toThrow();
  });
});

describe('attributedOf', () => {
  it('is floor(amount × sections / owned sections), negative for a refund', () => {
    expect(attributedOf(sale(120_000, 2, 4))).toBe(60_000);
    expect(attributedOf(sale(99_999, 1, 3))).toBe(33_333);
    expect(attributedOf(refund(400_000))).toBe(-400_000);
    expect(attributedOf(sale(5, 0, 0))).toBe(0);
    expect(() => attributedOf(sale(5, 3, 2))).toThrow();
    expect(() => attributedOf(sale(-5))).toThrow();
  });
});

describe('policyAdjustment', () => {
  it('hybrid replaces the ledger credit with the policy share', () => {
    expect(
      policyAdjustment({ kind: 'hybrid', shareBps: 1500 }, [sale(1_000_000, 1, 1, 700_000)]),
    ).toEqual({ attributed: 1_000_000, share: 150_000, credited: 700_000, adjustment: -550_000 });
  });

  it('a salary policy has no revenue share', () => {
    expect(
      policyAdjustment({ kind: 'salary', shareBps: null }, [sale(100_000, 1, 1, 70_000)]),
    ).toEqual({
      attributed: 100_000,
      share: 0,
      credited: 70_000,
      adjustment: -70_000,
    });
  });

  it('revenue share and per-piece keep the ledger credit', () => {
    for (const kind of ['revenue_share', 'per_piece'] as const)
      expect(
        policyAdjustment({ kind, shareBps: 3500 }, [sale(100_000, 1, 1, 70_000)]).adjustment,
      ).toBe(0);
  });
});

const arbTx = fc
  .record({
    amount: fc.integer({ min: 0, max: 100_000_000 }),
    isRefund: fc.boolean(),
    totalSections: fc.integer({ min: 1, max: 12 }),
    sectionsPick: fc.integer({ min: 1, max: 12 }),
  })
  .map(({ amount, isRefund, totalSections, sectionsPick }) => {
    const sections = Math.min(sectionsPick, totalSections);
    // The ledger credits the default 70% of the instructor's part of the pool.
    const pool = Number((BigInt(amount) * 7000n) / 10_000n);
    const part = Number((BigInt(pool) * BigInt(sections)) / BigInt(totalSections));
    return isRefund
      ? refund(amount, sections, totalSections, -part)
      : sale(amount, sections, totalSections, part);
  });

describe('hybrid properties', () => {
  it('the cycle pays salary + policy share exactly, and money is conserved', () => {
    fc.assert(
      fc.property(
        fc.array(arbTx, { maxLength: 20 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (txs, salary, shareBps, carryIn) => {
          const adj = policyAdjustment({ kind: 'hybrid', shareBps }, txs);
          const c = assemblePayCycle({
            month: '2027-04',
            instructors: [
              {
                instructorId: 'h',
                earned: adj.credited,
                salary,
                adjustment: adj.adjustment,
                carryIn,
                isVerified: true,
              },
            ],
          });
          const line = c.lines[0];
          const due = salary + adj.share - carryIn;
          if (!line) expect(due === 0 && carryIn === 0).toBe(true);
          else {
            expect(line.payout - line.carryOut).toBe(due);
            expect(line.payout).toBeGreaterThanOrEqual(0);
            expect(line.payout - line.carryOut).toBe(
              line.earned + line.salary + line.adjustment - line.carryIn,
            );
          }
          // The share never exceeds the policy rate of what was attributed.
          expect(BigInt(adj.share) * 10_000n).toBeLessThanOrEqual(
            BigInt(adj.attributed) * BigInt(shareBps),
          );
        },
      ),
    );
  });

  it('is deterministic and order-independent', () => {
    fc.assert(
      fc.property(
        fc.array(arbTx, { maxLength: 20 }),
        fc.integer({ min: 0, max: 10_000 }),
        (txs, bps) => {
          const p = { kind: 'hybrid' as const, shareBps: bps };
          expect(policyAdjustment(p, [...txs].reverse())).toEqual(policyAdjustment(p, txs));
        },
      ),
    );
  });
});
