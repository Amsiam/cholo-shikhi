// The single shared Money type: integer poisha only (1 taka = 100 poisha). Contract 1.
// NEVER floating-point arithmetic on money (project.md). Formatting uses BigInt so even the
// largest safe amount keeps every digit. The rounding rule lives in the pay-policy domain (U9).
import { z } from 'zod';
import { type AppError, appError } from './errors.ts';
import { err, ok, type Result } from './result.ts';

export const MoneyPoisha = z.number().int().nonnegative().safe().brand<'MoneyPoisha'>();
export type MoneyPoisha = z.infer<typeof MoneyPoisha>;

export const Currency = z.literal('BDT');
export type Currency = z.infer<typeof Currency>;

export const ZERO_POISHA = 0 as MoneyPoisha;
export const MAX_POISHA = Number.MAX_SAFE_INTEGER as MoneyPoisha;

export type MoneyError = AppError<'MONEY_OVERFLOW' | 'MONEY_NEGATIVE'>;

const TAKA_STRING = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

/** Validates a raw number as integer poisha. */
export function moneyFromPoisha(value: number): Result<MoneyPoisha, AppError<'VALIDATION_FAILED'>> {
  const parsed = MoneyPoisha.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(appError('VALIDATION_FAILED', { fieldErrors: { amount: ['errors.validation.money'] } }));
}

export function addMoney(a: MoneyPoisha, b: MoneyPoisha): Result<MoneyPoisha, MoneyError> {
  const sum = a + b;
  // Both operands are safe integers, so an overflow shows up as an unsafe sum.
  return Number.isSafeInteger(sum)
    ? ok(sum as MoneyPoisha)
    : err(appError('MONEY_OVERFLOW', { namespace: 'money' }));
}

export function subtractMoney(a: MoneyPoisha, b: MoneyPoisha): Result<MoneyPoisha, MoneyError> {
  return a >= b
    ? ok((a - b) as MoneyPoisha)
    : err(appError('MONEY_NEGATIVE', { namespace: 'money' }));
}

export function sumMoney(amounts: readonly MoneyPoisha[]): Result<MoneyPoisha, MoneyError> {
  let total: MoneyPoisha = ZERO_POISHA;
  for (const amount of amounts) {
    const next = addMoney(total, amount);
    if (!next.ok) return next;
    total = next.value;
  }
  return ok(total);
}

/**
 * Provider boundary only: "1500.00" -> 150000. Exact string parsing, never parseFloat (FR7.10).
 * Rejects more than 2 decimals, signs, exponents, spaces, grouping and non-ASCII digits.
 */
export function parseTakaString(input: string): Result<MoneyPoisha, AppError<'VALIDATION_FAILED'>> {
  const match = TAKA_STRING.exec(input);
  if (!match) {
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { amount: ['errors.validation.money'] } }),
    );
  }
  const whole = BigInt(match[1] as string);
  const fraction = BigInt((match[2] ?? '0').padEnd(2, '0'));
  const total = whole * 100n + fraction;
  if (total > MAX_SAFE_BIG) {
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { amount: ['errors.validation.money'] } }),
    );
  }
  return ok(Number(total) as MoneyPoisha);
}

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

/** Replaces ASCII digits with Bangla digits; other characters are unchanged. */
export function toBanglaDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BANGLA_DIGITS[Number(d)] as string);
}

const WHOLE_FORMAT = {
  // bn-BD uses Bangla digits and lakh/crore grouping; English uses Western grouping.
  bn: new Intl.NumberFormat('bn-BD', { useGrouping: true }),
  en: new Intl.NumberFormat('en-US', { useGrouping: true }),
} as const;

/** "৳1,500.00" (en) / "৳১,৫০০.০০" (bn). Integer arithmetic only. */
export function formatMoney(amount: MoneyPoisha, locale: 'bn' | 'en'): string {
  const whole = BigInt(amount) / 100n;
  const fraction = String(amount % 100).padStart(2, '0');
  const formattedWhole = WHOLE_FORMAT[locale].format(whole);
  const formattedFraction = locale === 'bn' ? toBanglaDigits(fraction) : fraction;
  return `৳${formattedWhole}.${formattedFraction}`;
}
