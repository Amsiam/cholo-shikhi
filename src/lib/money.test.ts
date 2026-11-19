// Money (contract 1, project.md ALWAYS Money / NEVER float). Written before money.ts exists.
// Expected values are hand-specified, not computed by the implementation.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  Currency,
  formatMoney,
  MAX_POISHA,
  MoneyPoisha,
  moneyFromPoisha,
  parseTakaString,
  subtractMoney,
  sumMoney,
  toBanglaDigits,
  ZERO_POISHA,
} from './money.ts';

// Fixed seed keeps property runs reproducible; fast-check prints the failing seed on failure.
const PROPERTY = { seed: 20261113, numRuns: 500 } as const;
const poisha = () => fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const p = (n: number) => MoneyPoisha.parse(n);

describe('MoneyPoisha schema: integer poisha only', () => {
  it('accepts zero and positive safe integers', () => {
    expect(MoneyPoisha.parse(0)).toBe(0);
    expect(MoneyPoisha.parse(150000)).toBe(150000);
    expect(MoneyPoisha.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects floats, negatives, NaN, Infinity and unsafe integers', () => {
    for (const bad of [0.5, 1500.01, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '100']) {
      expect(MoneyPoisha.safeParse(bad).success, `value ${String(bad)}`).toBe(false);
    }
  });

  it('property: every non-integer number is rejected', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }).filter((d) => !Number.isInteger(d)),
        (d) => !MoneyPoisha.safeParse(d).success,
      ),
      PROPERTY,
    );
  });

  it('Currency is BDT only', () => {
    expect(Currency.parse('BDT')).toBe('BDT');
    expect(Currency.safeParse('USD').success).toBe(false);
  });
});

describe('moneyFromPoisha', () => {
  it('returns ok for integer poisha and VALIDATION_FAILED otherwise', () => {
    expect(moneyFromPoisha(250)).toEqual({ ok: true, value: 250 });
    const bad = moneyFromPoisha(2.5);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('add and subtract (closure)', () => {
  it('adds exactly', () => {
    expect(addMoney(p(150000), p(25))).toEqual({ ok: true, value: 150025 });
  });

  it('refuses a sum above the safe-integer ceiling instead of losing precision', () => {
    const r = addMoney(p(MAX_POISHA), p(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MONEY_OVERFLOW');
  });

  it('subtracts exactly and refuses a negative result', () => {
    expect(subtractMoney(p(1000), p(1))).toEqual({ ok: true, value: 999 });
    const r = subtractMoney(p(1), p(2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MONEY_NEGATIVE');
  });

  it('sums a list exactly, with zero for an empty list', () => {
    expect(sumMoney([])).toEqual({ ok: true, value: ZERO_POISHA });
    expect(sumMoney([p(1), p(2), p(3)])).toEqual({ ok: true, value: 6 });
    expect(sumMoney([p(MAX_POISHA), p(1)]).ok).toBe(false);
  });

  it('property: addition of valid amounts is an integer when it fits, and commutative', () => {
    fc.assert(
      fc.property(poisha(), poisha(), (a, b) => {
        const ab = addMoney(p(a), p(b));
        const ba = addMoney(p(b), p(a));
        expect(ab).toEqual(ba);
        if (a + b <= Number.MAX_SAFE_INTEGER) {
          expect(ab.ok && Number.isInteger(ab.value) && ab.value === a + b).toBe(true);
        } else {
          expect(ab.ok).toBe(false);
        }
      }),
      PROPERTY,
    );
  });

  it('property: (a + b) - b === a (round trip)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.integer({ min: 0, max: 2 ** 40 }),
        (a, b) => {
          const sum = addMoney(p(a), p(b));
          if (!sum.ok) return false;
          const back = subtractMoney(sum.value, p(b));
          return back.ok && back.value === a;
        },
      ),
      PROPERTY,
    );
  });

  it('property: subtraction never yields a negative amount', () => {
    fc.assert(
      fc.property(poisha(), poisha(), (a, b) => {
        const r = subtractMoney(p(a), p(b));
        return a >= b ? r.ok && r.value === a - b : !r.ok;
      }),
      PROPERTY,
    );
  });
});

describe('parseTakaString (provider boundary, exact string parsing)', () => {
  it.each([
    ['1500.00', 150000],
    ['1500', 150000],
    ['1500.5', 150050],
    ['0.01', 1],
    ['0', 0],
    ['12345678.99', 1234567899],
  ])('parses %s to %i poisha', (input, expected) => {
    expect(parseTakaString(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    '1500.001',
    '-5',
    '+5',
    '1e3',
    ' 15',
    '15 ',
    '1,500.00',
    '',
    '.5',
    '5.',
    'abc',
    '0x10',
    '১৫০০',
  ])('rejects %j', (input) => {
    const r = parseTakaString(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an amount that does not fit in a safe integer', () => {
    expect(parseTakaString('90071992547409.92').ok).toBe(false);
  });

  it('property: formatting poisha as a taka string and parsing it back is lossless', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 50 }), (n) => {
        const taka = `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
        const r = parseTakaString(taka);
        return r.ok && r.value === n;
      }),
      PROPERTY,
    );
  });
});

describe('formatMoney (bn with Bangla digits, en)', () => {
  it('formats en with the taka sign and two decimals', () => {
    expect(formatMoney(p(150000), 'en')).toBe('৳1,500.00');
    expect(formatMoney(p(5), 'en')).toBe('৳0.05');
    expect(formatMoney(p(0), 'en')).toBe('৳0.00');
  });

  it('formats bn with Bangla digits and lakh grouping', () => {
    expect(formatMoney(p(150000), 'bn')).toBe('৳১,৫০০.০০');
    expect(formatMoney(p(1000000000), 'bn')).toBe('৳১,০০,০০,০০০.০০');
    expect(formatMoney(p(99), 'bn')).toBe('৳০.৯৯');
  });

  it('formats the largest safe amount without precision loss', () => {
    expect(formatMoney(p(Number.MAX_SAFE_INTEGER), 'en')).toBe('৳90,071,992,547,409.91');
  });

  it('converts ASCII digits to Bangla digits and leaves other characters', () => {
    expect(toBanglaDigits('2026-11-13')).toBe('২০২৬-১১-১৩');
  });
});
