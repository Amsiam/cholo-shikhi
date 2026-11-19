// [LT] Sale split: the human-owned golden examples, then properties over random sales (team.md
// Money correctness: conservation, non-negative, determinism, order independence).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SALE_SPLITS } from './golden-sale-splits.ts';
import {
  BPS_DENOMINATOR,
  DEFAULT_INSTRUCTOR_SHARE_BPS,
  type SaleSplit,
  salePostings,
  splitSale,
} from './revenue-split.ts';

const must = (r: ReturnType<typeof splitSale>): SaleSplit => {
  if (!r.ok) throw new Error('expected a split');
  return r.value;
};
const total = (s: SaleSplit) =>
  s.platform + s.unassigned + s.instructors.reduce((sum, i) => sum + i.amount, 0);

describe('golden sale splits (human-owned)', () => {
  it.each(GOLDEN_SALE_SPLITS.map((g) => [g.name, g] as const))('%s', (_name, g) => {
    const split = must(splitSale(g.amount, g.sections, g.shareBps));
    expect(split.platform).toBe(g.expect.platform);
    expect(split.unassigned).toBe(g.expect.unassigned);
    expect(Object.fromEntries(split.instructors.map((i) => [i.instructorId, i.amount]))).toEqual(
      g.expect.instructors,
    );
  });
});

describe('splitSale', () => {
  it('defaults to 70% for instructors', () => {
    expect(DEFAULT_INSTRUCTOR_SHARE_BPS).toBe(7000);
    expect(must(splitSale(1000, [{ sectionId: 's', instructorId: 'a' }])).platform).toBe(300);
  });

  it('refuses a negative, fractional or unsafe amount and an out-of-range share', () => {
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN])
      expect(splitSale(amount, []).ok).toBe(false);
    for (const bps of [-1, 10_001, 70.5]) expect(splitSale(100, [], bps).ok).toBe(false);
  });

  it('counts a section listed twice once', () => {
    const split = must(
      splitSale(1000, [
        { sectionId: 's1', instructorId: 'a' },
        { sectionId: 's1', instructorId: 'b' },
      ]),
    );
    expect(split.instructors).toEqual([{ instructorId: 'a', sections: 1, amount: 700 }]);
  });
});

const owners = fc.array(
  fc.record({ sectionId: fc.uuid(), instructorId: fc.constantFrom('a', 'b', 'c', 'd', 'e') }),
  { maxLength: 12 },
);
const amount = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const bps = fc.integer({ min: 0, max: BPS_DENOMINATOR });

describe('split properties', () => {
  it('conserves every poisha and never pays a negative amount', () => {
    fc.assert(
      fc.property(amount, owners, bps, (a, o, b) => {
        const s = must(splitSale(a, o, b));
        expect(total(s)).toBe(a);
        expect(
          [s.platform, s.unassigned, ...s.instructors.map((i) => i.amount)].every((x) => x >= 0),
        ).toBe(true);
      }),
    );
  });

  it('is deterministic and does not depend on the order of the sections', () => {
    fc.assert(
      fc.property(amount, owners, bps, (a, o, b) => {
        expect(splitSale(a, [...o].reverse(), b)).toEqual(splitSale(a, o, b));
        expect(splitSale(a, o, b)).toEqual(splitSale(a, o, b));
      }),
    );
  });

  it('gives each instructor within one poisha of their exact section share', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), owners, bps, (a, o, b) => {
        const s = must(splitSale(a, o, b));
        const pool = a - s.platform;
        const sections = s.instructors.reduce((n, i) => n + i.sections, 0);
        for (const i of s.instructors) {
          const exact = (pool * i.sections) / sections;
          expect(Math.abs(i.amount - exact)).toBeLessThan(1);
        }
      }),
    );
  });

  it('posts balanced entries for every sale', () => {
    fc.assert(
      fc.property(amount, owners, bps, (a, o, b) => {
        const postings = salePostings(must(splitSale(a, o, b)));
        expect(postings.reduce((sum, p) => sum + p.amount, 0)).toBe(0);
        expect(postings.every((p) => p.amount !== 0)).toBe(true);
        expect(
          postings.every((p) => (p.account === 'instructor_payable') === (p.instructorId !== null)),
        ).toBe(true);
      }),
    );
  });
});
