// [TF] Step 13: the catalog's money logic, written test-first (team.md Money correctness). Expected
// values come from rules.md BR5.1 to BR5.5, BR5.9 and BR10.9, never from the implementation.
// fast-check runs with a fixed seed; a failing seed is printed and kept as a regression case.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBanglaDigits } from '#src/lib/money.ts';
import { buildTakaInput } from '#src/test/factories/catalog.ts';
import {
  ceilingSettingFor,
  checkAccessDuration,
  checkCoursePrice,
  checkPriceCeiling,
  PRICE_PARSE_CEILING_POISHA,
  parseProductPrice,
  parseTakaToPoisha,
  recheckPublishPrice,
} from './pricing.ts';

const SEED = 20261116;
const MAX = 9_999_999_999;

function poisha(input: string): number {
  const result = parseTakaToPoisha(input);
  if (!result.ok) throw new Error(`expected ${input} to parse`);
  return result.value;
}

function fieldError(result: { ok: boolean; error?: unknown }) {
  expect(result.ok).toBe(false);
  return (result as { error: { code: string; fieldErrors: Record<string, string[]> } }).error;
}

describe('parseTakaToPoisha (BR5.1)', () => {
  it.each([
    ['1499.5', 149950],
    ['1499.50', 149950],
    ['0.05', 5],
    ['0', 0],
    ['0.5', 50],
    ['123', 12300],
    ['123.4', 12340],
    ['123.45', 12345],
    ['99999999.99', MAX],
    ['  1499.50  ', 149950],
    ['১৪৯৯.৫০', 149950],
    ['১২৩', 12300],
  ])('accepts %s as %i poisha', (input, expected) => {
    expect(parseTakaToPoisha(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    '10.',
    '.5',
    '1.234',
    '+5',
    '-5',
    '1,499',
    '৳10',
    'Tk 10',
    '1e3',
    '0123',
    '1 0',
    '10,5',
    '',
    '   ',
    '100000000',
    '00',
    '0x10',
    'NaN',
    'Infinity',
    '١٢٣',
  ])('refuses %j with a field error on the price', (input) => {
    const error = fieldError(parseTakaToPoisha(input));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors.price).toEqual(['errors.catalog.priceFormat']);
  });

  it('caps every parse at 9,999,999,999 poisha', () => {
    expect(PRICE_PARSE_CEILING_POISHA).toBe(MAX);
    expect(poisha('99999999.99')).toBe(MAX);
    expect(parseTakaToPoisha('100000000.00').ok).toBe(false);
  });

  describe('properties', () => {
    it('(a) a canonical taka string of any p in [0, 9,999,999,999] parses back to p', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: MAX }), (p) => poisha(buildTakaInput(p)) === p),
        { seed: SEED, numRuns: 2000 },
      );
    });

    it('(b) Bangla-digit and Latin-digit spellings parse to the same value', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: MAX }), (p) => {
          const latin = buildTakaInput(p);
          return poisha(toBanglaDigits(latin)) === poisha(latin);
        }),
        { seed: SEED, numRuns: 1000 },
      );
    });

    it('(c) every accepted output is a safe integer >= 0 and <= the ceiling', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 14 }), (input) => {
          const result = parseTakaToPoisha(input);
          if (!result.ok) return true;
          return Number.isSafeInteger(result.value) && result.value >= 0 && result.value <= MAX;
        }),
        { seed: SEED, numRuns: 3000 },
      );
    });

    it('(d) mutations of valid strings that leave the grammar are refused', () => {
      const breakers = ['+', '-', ',', ' ', 'e', '৳', '.', '..', 'x'];
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: MAX }),
          fc.constantFrom(...breakers),
          fc.nat(),
          (p, insert, at) => {
            const valid = buildTakaInput(p);
            const index = 1 + (at % valid.length);
            const mutated = `${valid.slice(0, index)}${insert}${valid.slice(index)}`;
            const grammar = /^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/;
            if (grammar.test(mutated.trim())) return true;
            return !parseTakaToPoisha(mutated).ok;
          },
        ),
        { seed: SEED, numRuns: 2000 },
      );
    });

    it('(d) a third decimal or a leading zero is always refused', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 99_999_999 }),
          fc.integer({ min: 0, max: 999 }),
          (w, f) => {
            const threeDecimals = `${w}.${String(f).padStart(3, '0')}`;
            return !parseTakaToPoisha(threeDecimals).ok && !parseTakaToPoisha(`0${w}`).ok;
          },
        ),
        { seed: SEED, numRuns: 1000 },
      );
    });
  });
});

describe('checkCoursePrice (BR5.2, BR5.3)', () => {
  const bounds = { minPoisha: 10_000, maxPoisha: 5_000_000 };

  it('accepts the bounds themselves', () => {
    expect(checkCoursePrice(10_000, bounds)).toEqual({ ok: true, value: 10_000 });
    expect(checkCoursePrice(5_000_000, bounds)).toEqual({ ok: true, value: 5_000_000 });
  });

  it('refuses one poisha below the minimum and one above the maximum, carrying the bounds', () => {
    const low = fieldError(checkCoursePrice(9_999, bounds));
    expect(low.fieldErrors.price).toEqual(['errors.catalog.priceBelowMin']);
    expect(low).toMatchObject({ details: { minPoisha: 10_000, maxPoisha: 5_000_000 } });
    const high = fieldError(checkCoursePrice(5_000_001, bounds));
    expect(high.fieldErrors.price).toEqual(['errors.catalog.priceAboveMax']);
    expect(high).toMatchObject({ details: { minPoisha: 10_000, maxPoisha: 5_000_000 } });
  });

  it('refuses zero (and anything below 1 poisha) before the bounds', () => {
    expect(fieldError(checkCoursePrice(0, bounds)).fieldErrors.price).toEqual([
      'errors.catalog.priceTooLow',
    ]);
    expect(fieldError(checkCoursePrice(0, { minPoisha: 0, maxPoisha: 10 })).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('refuses a non-integer or unsafe amount instead of trusting it', () => {
    expect(checkCoursePrice(10_000.5, bounds).ok).toBe(false);
    expect(
      checkCoursePrice(Number.MAX_SAFE_INTEGER + 2, {
        minPoisha: 1,
        maxPoisha: Number.MAX_SAFE_INTEGER,
      }).ok,
    ).toBe(false);
  });

  it('(e) is monotonic: if a price passes, every price between the minimum and it passes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 0, max: MAX }),
        (a, b, price, below) => {
          const range = { minPoisha: Math.min(a, b), maxPoisha: Math.max(a, b) };
          if (!checkCoursePrice(price, range).ok) return true;
          const lower = range.minPoisha + (below % (price - range.minPoisha + 1));
          return checkCoursePrice(lower, range).ok;
        },
      ),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe('checkPriceCeiling (BR5.9, BR10.9)', () => {
  it('accepts 1 poisha and the ceiling itself', () => {
    expect(checkPriceCeiling(1, 200_000)).toEqual({ ok: true, value: 1 });
    expect(checkPriceCeiling(200_000, 200_000)).toEqual({ ok: true, value: 200_000 });
  });

  it('refuses one poisha above the ceiling with the ceiling in details', () => {
    const error = fieldError(checkPriceCeiling(200_001, 200_000));
    expect(error.fieldErrors.price).toEqual(['errors.catalog.priceAboveMax']);
    expect(error).toMatchObject({ details: { maxPoisha: 200_000 } });
  });

  it('refuses zero (the floor stays 1 poisha, BR5.3)', () => {
    expect(fieldError(checkPriceCeiling(0, 200_000)).fieldErrors.price).toEqual([
      'errors.catalog.priceTooLow',
    ]);
  });

  it('(e) is monotonic in the price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 1, max: MAX }),
        (ceiling, price) => {
          if (!checkPriceCeiling(price, ceiling).ok) return price > ceiling;
          return checkPriceCeiling(Math.max(1, price - 1), ceiling).ok;
        },
      ),
      { seed: SEED, numRuns: 2000 },
    );
  });
});

describe('checkAccessDuration (BR5.5)', () => {
  it.each([4, 6, 12])('accepts %i months', (months) => {
    expect(checkAccessDuration(months)).toEqual({ ok: true, value: months });
  });

  it.each([5, 0, -4, 24, 6.5, '6', null, undefined, Number.NaN])('refuses %j', (months) => {
    const error = fieldError(checkAccessDuration(months));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors.months).toEqual(['errors.catalog.durationInvalid']);
  });
});

// [TF] Step 38: product prices (Bolt 5), written before the product price functions exist.
// Expected values come from rules.md BR5.3, BR5.9 and BR10.9.
describe('product price ceilings (BR5.9, BR10.9)', () => {
  it('names the ceiling setting of each product: exam package, plan monthly price, and the course maximum for a Practice Pack', () => {
    expect(ceilingSettingFor('exam_package')).toBe('catalog.examPackagePrice.maxPoisha');
    expect(ceilingSettingFor('subscription_plan')).toBe('catalog.planMonthlyPrice.maxPoisha');
    expect(ceilingSettingFor('practice_pack')).toBe('catalog.coursePrice.maxPoisha');
  });

  it('BR5.9 exam package: accepts the ceiling exactly and refuses one poisha above it', () => {
    expect(parseProductPrice('5000', 500_000)).toEqual({ ok: true, value: 500_000 });
    expect(parseProductPrice('৪৯৯.৫০', 500_000)).toEqual({ ok: true, value: 49_950 });
    const error = fieldError(parseProductPrice('5000.01', 500_000));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors.price).toEqual(['errors.catalog.priceAboveMax']);
    expect(error).toMatchObject({ details: { maxPoisha: 500_000 } });
  });

  it('BR5.9 / BR5.3 plan monthly price: refuses 0 poisha and accepts 1 poisha', () => {
    expect(fieldError(parseProductPrice('0', 300_000)).fieldErrors.price).toEqual([
      'errors.catalog.priceTooLow',
    ]);
    expect(fieldError(parseProductPrice('0.00', 300_000)).fieldErrors.price).toEqual([
      'errors.catalog.priceTooLow',
    ]);
    expect(parseProductPrice('0.01', 300_000)).toEqual({ ok: true, value: 1 });
  });

  it('BR5.1 still applies first: a malformed price is a format error, never a ceiling error', () => {
    for (const bad of ['', '1,000', '৳10', '-5', '1.234']) {
      expect(fieldError(parseProductPrice(bad, 300_000)).fieldErrors.price).toEqual([
        'errors.catalog.priceFormat',
      ]);
    }
  });

  it('BR10.9 Practice Pack: checked against the course maximum only; the course minimum does not apply', () => {
    const courseMax = 5_000_000;
    // 1 taka is below a typical course minimum (100 taka) yet a valid pack price.
    expect(parseProductPrice('1', courseMax)).toEqual({ ok: true, value: 100 });
    expect(parseProductPrice('50000', courseMax)).toEqual({ ok: true, value: courseMax });
    expect(fieldError(parseProductPrice('50000.01', courseMax)).fieldErrors.price).toEqual([
      'errors.catalog.priceAboveMax',
    ]);
  });

  it('BR5.9 publish re-check: a price saved under the old ceiling is refused once the ceiling is lowered, and passes again at the raised ceiling', () => {
    expect(recheckPublishPrice(400_000, 500_000)).toEqual({ ok: true, value: 400_000 });
    const lowered = fieldError(recheckPublishPrice(400_000, 300_000));
    expect(lowered.fieldErrors.price).toEqual(['errors.catalog.priceAboveMax']);
    expect(lowered).toMatchObject({ details: { maxPoisha: 300_000 } });
    expect(recheckPublishPrice(300_000, 300_000)).toEqual({ ok: true, value: 300_000 });
  });

  it('BR10.5 publish re-check: a missing price is refused priceRequired', () => {
    const error = fieldError(recheckPublishPrice(null, 300_000));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors.price).toEqual(['errors.catalog.priceRequired']);
  });

  it('property: for any ceiling c and integer price p, the publish check passes exactly when 1 <= p <= c', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 0, max: MAX }),
        (ceiling, price) => {
          const result = recheckPublishPrice(price, ceiling);
          const shouldPass = price >= 1 && price <= ceiling;
          return result.ok === shouldPass && (!result.ok || result.value === price);
        },
      ),
      { seed: SEED, numRuns: 3000 },
    );
  });

  it('property: a taka string of any price p (Latin or Bangla digits) passes the save check exactly when 1 <= p <= c', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX }),
        fc.integer({ min: 0, max: MAX }),
        fc.boolean(),
        (ceiling, price, isBangla) => {
          const input = buildTakaInput(price, isBangla ? 'bangla' : 'latin');
          const result = parseProductPrice(input, ceiling);
          const shouldPass = price >= 1 && price <= ceiling;
          return result.ok === shouldPass && (!result.ok || result.value === price);
        },
      ),
      { seed: SEED, numRuns: 3000 },
    );
  });

  it('property: every refusal names exactly one price error key, and the value is never a fraction', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX }), fc.double(), (ceiling, price) => {
        const result = recheckPublishPrice(price, ceiling);
        if (result.ok) return Number.isSafeInteger(result.value);
        return (result.error.fieldErrors?.price ?? []).length === 1;
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });
});
