// [LT] US7.13 attribution money (the human's choice): resolving a dispute moves the disputed
// section's share of the unassigned pool to the confirmed owner, once, to the poisha.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planReassignment, sectionShareOf, type UnassignedSale } from './attribution-money.ts';

const sale = (paymentId: string, netUnassigned: number, sections = ['a', 'b', 'c', 'd']) => ({
  paymentId,
  netUnassigned,
  sectionIds: sections,
});

describe('sectionShareOf', () => {
  it('is floor(net unassigned / sections at the sale), the leftover stays in the pool', () => {
    expect(sectionShareOf(sale('p1', 84_000), 'a')).toBe(21_000);
    expect(sectionShareOf(sale('p2', 69_999), 'b')).toBe(17_499);
  });

  it('is 0 when the section did not exist at the sale, or nothing is unassigned', () => {
    expect(sectionShareOf(sale('p1', 84_000, ['a', 'b']), 'z')).toBe(0);
    expect(sectionShareOf(sale('p1', 0), 'a')).toBe(0);
    expect(sectionShareOf(sale('p1', -5), 'a')).toBe(0);
    expect(sectionShareOf(sale('p1', 84_000, []), 'a')).toBe(0);
  });

  it('refuses amounts that are not whole poisha', () => {
    expect(() => sectionShareOf(sale('p1', 1.5), 'a')).toThrow();
  });
});

describe('planReassignment', () => {
  it('moves each sale’s share once, sorted by payment', () => {
    const plan = planReassignment([sale('p2', 69_999), sale('p1', 84_000)], 'a', new Map());
    expect(plan).toEqual({
      items: [
        { paymentId: 'p1', amount: 21_000 },
        { paymentId: 'p2', amount: 17_499 },
      ],
      total: 38_499,
    });
  });

  it('a second resolution of the same section moves only what was not moved yet', () => {
    const sales = [sale('p1', 84_000), sale('p2', 69_999), sale('p3', 35_000)];
    const plan = planReassignment(
      sales,
      'a',
      new Map([
        ['p1', 21_000],
        ['p2', 17_499],
      ]),
    );
    expect(plan).toEqual({ items: [{ paymentId: 'p3', amount: 8_750 }], total: 8_750 });
  });

  it('never moves money back: a share already moved is never reduced or moved twice', () => {
    const plan = planReassignment([sale('p1', 40_000)], 'a', new Map([['p1', 21_000]]));
    expect(plan).toEqual({ items: [], total: 0 });
  });

  it('refuses a payment listed twice', () => {
    expect(() => planReassignment([sale('p1', 4), sale('p1', 8)], 'a', new Map())).toThrow();
  });
});

const sectionPool = ['s1', 's2', 's3', 's4', 's5'];
const arbSale = fc.record({
  paymentId: fc.uuid(),
  netUnassigned: fc.integer({ min: -1_000, max: 50_000_000 }),
  sectionIds: fc.subarray(sectionPool, { minLength: 0 }),
});
const arbSales = fc.uniqueArray(arbSale, { selector: (s) => s.paymentId, maxLength: 30 });

describe('planReassignment properties', () => {
  it('conserves money: what moves is never more than the net pool, and is non-negative', () => {
    fc.assert(
      fc.property(arbSales, fc.constantFrom(...sectionPool), (sales, section) => {
        const plan = planReassignment(sales, section, new Map());
        const pool = sales.reduce((s, x) => s + Math.max(0, x.netUnassigned), 0);
        expect(plan.total).toBeGreaterThanOrEqual(0);
        expect(plan.total).toBeLessThanOrEqual(pool);
        expect(plan.items.reduce((s, i) => s + i.amount, 0)).toBe(plan.total);
        for (const i of plan.items) expect(i.amount).toBeGreaterThan(0);
      }),
    );
  });

  it('resolving every section of a course leaves less than one poisha per section in the pool', () => {
    fc.assert(
      fc.property(arbSales, (sales) => {
        for (const x of sales) {
          const moved = x.sectionIds.reduce(
            (s, id) => s + planReassignment([x], id, new Map()).total,
            0,
          );
          const net = Math.max(0, x.netUnassigned);
          if (x.sectionIds.length === 0) expect(moved).toBe(0);
          else {
            expect(moved).toBeLessThanOrEqual(net);
            expect(net - moved).toBeLessThan(x.sectionIds.length);
          }
        }
      }),
    );
  });

  it('is deterministic, order-independent and idempotent', () => {
    fc.assert(
      fc.property(arbSales, fc.constantFrom(...sectionPool), (sales, section) => {
        const once = planReassignment(sales, section, new Map());
        expect(planReassignment([...sales].reverse(), section, new Map())).toEqual(once);
        expect(planReassignment(sales, section, new Map())).toEqual(once);
        const moved = new Map(once.items.map((i) => [i.paymentId, i.amount]));
        expect(planReassignment(sales, section, moved)).toEqual({ items: [], total: 0 });
      }),
    );
  });

  it('a later sale adds exactly its own share (no double move of earlier sales)', () => {
    fc.assert(
      fc.property(arbSales, arbSale, fc.constantFrom(...sectionPool), (sales, extra, section) => {
        fc.pre(!sales.some((s) => s.paymentId === extra.paymentId));
        const first = planReassignment(sales, section, new Map());
        const moved = new Map(first.items.map((i) => [i.paymentId, i.amount]));
        const second = planReassignment([...sales, extra as UnassignedSale], section, moved);
        expect(second.total).toBe(sectionShareOf(extra, section));
      }),
    );
  });
});
