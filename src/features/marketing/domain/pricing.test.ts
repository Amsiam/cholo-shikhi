// [UT] US8.2 / US8.3 pricing (money, test-first): percent discounts in basis points round down to
// whole poisha, fixed discounts never exceed the price, and a checkout never reaches 0 poisha.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MoneyPoisha } from '#src/lib/money.ts';
import {
  type Discount,
  discountFor,
  normaliseCode,
  promoRefusal,
  validatePromoTerms,
} from './pricing.ts';

const p = (n: number) => n as MoneyPoisha;
const promo = {
  isActive: true,
  courseIds: [] as string[],
  segmentIds: ['seg-bcs'],
  startsOn: '2027-02-01',
  endsOn: '2027-02-28',
  maxUses: 500,
  usedCount: 0,
};

describe('discountFor', () => {
  it('AC8.3.1: 2000 bp off 100000 poisha is 20000, so the buyer pays 80000', () => {
    expect(discountFor(p(100_000), { kind: 'percent', bps: 2000 })).toEqual({
      ok: true,
      value: { discountPoisha: 20_000, payPoisha: 80_000 },
    });
  });
  it('AC8.3.2: 2000 bp off 99999 poisha is floor(19999.8) = 19999, so the buyer pays 80000', () => {
    expect(discountFor(p(99_999), { kind: 'percent', bps: 2000 })).toEqual({
      ok: true,
      value: { discountPoisha: 19_999, payPoisha: 80_000 },
    });
  });
  it('AC8.3.4: a fixed discount larger than the price is refused', () => {
    const r = discountFor(p(50_000), { kind: 'fixed', poisha: 60_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.i18nKey).toBe('errors.promo.exceedsPrice');
  });
  it('a discount that leaves 0 poisha is refused (a 0-poisha checkout never reaches the gateway)', () => {
    expect(discountFor(p(50_000), { kind: 'fixed', poisha: 50_000 }).ok).toBe(false);
    expect(discountFor(p(50_000), { kind: 'percent', bps: 10_000 }).ok).toBe(false);
  });
  it('keeps every digit for the largest safe price (no float rounding)', () => {
    const max = p(Number.MAX_SAFE_INTEGER);
    const r = discountFor(max, { kind: 'percent', bps: 3333 });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(BigInt(r.value.discountPoisha)).toBe(
        (BigInt(Number.MAX_SAFE_INTEGER) * 3333n) / 10000n,
      );
  });

  const price = fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }).map(p);
  const discount: fc.Arbitrary<Discount> = fc.oneof(
    fc.integer({ min: 1, max: 10_000 }).map((bps) => ({ kind: 'percent' as const, bps })),
    fc
      .integer({ min: 1, max: Number.MAX_SAFE_INTEGER })
      .map((poisha) => ({ kind: 'fixed' as const, poisha })),
  );
  it('property: the discount is whole poisha, never negative, never the whole price', () => {
    fc.assert(
      fc.property(price, discount, (pr, d) => {
        const r = discountFor(pr, d);
        if (!r.ok) return;
        expect(Number.isSafeInteger(r.value.discountPoisha)).toBe(true);
        expect(r.value.discountPoisha).toBeGreaterThanOrEqual(0);
        expect(r.value.payPoisha).toBeGreaterThanOrEqual(1);
        expect(r.value.discountPoisha + r.value.payPoisha).toBe(pr);
      }),
    );
  });
  it('property: deterministic, and a percent discount never exceeds the exact share', () => {
    fc.assert(
      fc.property(price, fc.integer({ min: 1, max: 10_000 }), (pr, bps) => {
        const a = discountFor(pr, { kind: 'percent', bps });
        expect(discountFor(pr, { kind: 'percent', bps })).toEqual(a);
        if (a.ok) {
          const exact = BigInt(pr) * BigInt(bps);
          expect(BigInt(a.value.discountPoisha) * 10000n <= exact).toBe(true);
          expect((BigInt(a.value.discountPoisha) + 1n) * 10000n > exact).toBe(true);
        }
      }),
    );
  });
  it('property: a fixed discount is applied exactly or refused', () => {
    fc.assert(
      fc.property(price, fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (pr, f) => {
        const r = discountFor(pr, { kind: 'fixed', poisha: f });
        expect(r.ok).toBe(f < pr);
        if (r.ok) expect(r.value.discountPoisha).toBe(f);
      }),
    );
  });
});

describe('validatePromoTerms (AC8.2.1, AC8.2.2)', () => {
  const base = { startsOn: '2027-02-01', endsOn: '2027-02-28', maxUses: 500 };
  it('accepts 2000 bp for 1–28 Feb with 500 uses', () => {
    expect(validatePromoTerms({ ...base, discount: { kind: 'percent', bps: 2000 } }).ok).toBe(true);
  });
  it('accepts 0 < bp ≤ 10000 and refuses anything above 10000 or below 1', () => {
    expect(validatePromoTerms({ ...base, discount: { kind: 'percent', bps: 10_000 } }).ok).toBe(
      true,
    );
    for (const bps of [10_001, 0, -5, 12.5])
      expect(validatePromoTerms({ ...base, discount: { kind: 'percent', bps } }).ok).toBe(false);
  });
  it('refuses a fixed amount that is not whole poisha, or not positive', () => {
    for (const poisha of [100.5, 0, -1, Number.MAX_SAFE_INTEGER + 2])
      expect(validatePromoTerms({ ...base, discount: { kind: 'fixed', poisha } }).ok).toBe(false);
    expect(validatePromoTerms({ ...base, discount: { kind: 'fixed', poisha: 5000 } }).ok).toBe(
      true,
    );
  });
  it('refuses an end date before the start date, and fewer than 1 use', () => {
    const d: Discount = { kind: 'percent', bps: 100 };
    expect(
      validatePromoTerms({ ...base, startsOn: '2027-02-10', endsOn: '2027-02-09', discount: d }).ok,
    ).toBe(false);
    expect(validatePromoTerms({ ...base, maxUses: 0, discount: d }).ok).toBe(false);
  });
});

describe('normaliseCode', () => {
  it('matches codes case-insensitively, ignoring surrounding spaces', () => {
    expect(normaliseCode('  bcs20 ')).toBe('BCS20');
  });
});

describe('promoRefusal (AC8.3.3: a specific reason)', () => {
  const at = { courseId: 'c1', segmentId: 'seg-bcs', today: '2027-02-03' };
  it('accepts an in-scope code within its dates with uses left', () => {
    expect(promoRefusal(promo, at)).toBeNull();
  });
  it('names each reason', () => {
    expect(promoRefusal({ ...promo, isActive: false }, at)).toBe('errors.promo.inactive');
    expect(promoRefusal(promo, { ...at, today: '2027-01-31' })).toBe('errors.promo.notStarted');
    expect(promoRefusal(promo, { ...at, today: '2027-03-01' })).toBe('errors.promo.expired');
    expect(promoRefusal(promo, { ...at, segmentId: 'seg-hsc' })).toBe('errors.promo.outOfScope');
    expect(promoRefusal({ ...promo, courseIds: ['c2'] }, at)).toBe('errors.promo.outOfScope');
    expect(promoRefusal({ ...promo, usedCount: 500 }, at)).toBe('errors.promo.usedUp');
  });
  it('treats the end date as the last valid day (inclusive)', () => {
    expect(promoRefusal(promo, { ...at, today: '2027-02-28' })).toBeNull();
  });
  it('an empty scope list means any course or segment', () => {
    expect(promoRefusal({ ...promo, segmentIds: [] }, { ...at, segmentId: null })).toBeNull();
    expect(promoRefusal(promo, { ...at, segmentId: null })).toBe('errors.promo.outOfScope');
  });
});
