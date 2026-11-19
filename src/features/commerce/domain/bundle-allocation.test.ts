// [UT] US8.5 bundle price allocation (money, test-first): a bundle's price is split across its
// courses in proportion to their standalone list prices, in whole poisha. The parts always sum to
// the bundle price exactly; leftover poisha go one each to the largest remainders, ties to the
// earlier course; a part of 0 poisha is refused.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateBundlePrice } from './bundle-allocation.ts';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateBundlePrice', () => {
  it('splits 300000 poisha over three equal courses evenly', () => {
    expect(allocateBundlePrice(300_000, [150_000, 150_000, 150_000])).toEqual({
      ok: true,
      value: [100_000, 100_000, 100_000],
    });
  });

  it('splits in proportion to the list prices', () => {
    expect(allocateBundlePrice(150_000, [100_000, 200_000])).toEqual({
      ok: true,
      value: [50_000, 100_000],
    });
  });

  it('gives leftover poisha to the largest remainders, ties to the earlier course', () => {
    // 100 over three equal courses: 33.33 each, the one leftover poisha goes to the first.
    expect(allocateBundlePrice(100, [1, 1, 1])).toEqual({ ok: true, value: [34, 33, 33] });
    // 10 over weights 1, 2: exact 3.33 and 6.67; floor 3 and 6, the leftover to the larger remainder.
    expect(allocateBundlePrice(10, [1, 2])).toEqual({ ok: true, value: [3, 7] });
    // 101 over equal courses: 50.5 each, the leftover to the first.
    expect(allocateBundlePrice(101, [7, 7])).toEqual({ ok: true, value: [51, 50] });
  });

  it('splits evenly when every list price is 0', () => {
    expect(allocateBundlePrice(10, [0, 0, 0])).toEqual({ ok: true, value: [4, 3, 3] });
  });

  it('refuses a price that would leave a course with 0 poisha', () => {
    expect(allocateBundlePrice(2, [1, 1, 1])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', i18nKey: 'errors.commerce.bundlePriceTooLow' },
    });
    expect(allocateBundlePrice(100, [1, 1_000_000])).toMatchObject({ ok: false });
  });

  it('refuses no courses, a non-whole or non-positive price and a bad list price', () => {
    for (const [price, lists] of [
      [100, []],
      [0, [1, 1]],
      [-5, [1, 1]],
      [10.5, [1, 1]],
      [Number.MAX_SAFE_INTEGER + 1, [1, 1]],
      [100, [1, -1]],
      [100, [1, 0.5]],
      [100, [1, Number.MAX_SAFE_INTEGER + 1]],
    ] as const)
      expect(allocateBundlePrice(price, lists)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
  });

  it('handles the largest safe amounts without losing a poisha', () => {
    const r = allocateBundlePrice(Number.MAX_SAFE_INTEGER, [
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 1,
      3,
    ]);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.reduce((a, b) => BigInt(a) + BigInt(b), 0n)).toBe(
        BigInt(Number.MAX_SAFE_INTEGER),
      );
  });
});

const lists = fc.array(fc.integer({ min: 0, max: 50_000_000 }), { minLength: 2, maxLength: 8 });
const price = fc.integer({ min: 1, max: 1_000_000_000 });

describe('allocateBundlePrice properties', () => {
  it('the parts sum to the bundle price exactly, each at least 1 poisha, or it is refused', () => {
    fc.assert(
      fc.property(price, lists, (p, l) => {
        const r = allocateBundlePrice(p, l);
        if (!r.ok) return p < l.length || l.some((x) => x > 0);
        return r.value.length === l.length && sum(r.value) === p && r.value.every((x) => x >= 1);
      }),
    );
  });

  it('never refuses a price of at least one poisha per course with equal list prices', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (n, extra, list) => allocateBundlePrice(n + extra, Array(n).fill(list)).ok,
      ),
    );
  });

  it('each part is within one poisha of its exact proportional share', () => {
    fc.assert(
      fc.property(price, lists, (p, l) => {
        const r = allocateBundlePrice(p, l);
        if (!r.ok) return true;
        const total = BigInt(sum(l));
        return r.value.every((part, i) => {
          if (total === 0n) return true;
          const exactTimesTotal = BigInt(p) * BigInt(l[i] as number);
          const scaled = BigInt(part) * total;
          return scaled + total > exactTimesTotal && scaled - total < exactTimesTotal;
        });
      }),
    );
  });

  it('is deterministic, and a dearer course never gets less than a cheaper one', () => {
    fc.assert(
      fc.property(price, lists, (p, l) => {
        const a = allocateBundlePrice(p, l);
        const b = allocateBundlePrice(p, [...l]);
        expect(b).toEqual(a);
        if (!a.ok) return true;
        return l.every((li, i) =>
          l.every(
            (lj, j) =>
              !(li >= lj) ||
              (a.value[i] as number) >= (a.value[j] as number) ||
              (li === lj && i > j),
          ),
        );
      }),
    );
  });
});
