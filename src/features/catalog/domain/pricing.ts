// Catalog pricing (rules.md BR5.1–BR5.5, BR5.9, BR10.9): the catalog's only money logic. Plain
// TypeScript. Integer poisha only, through the shared Money type; floating point is never used
// on a money value (project.md). Every expected failure is a Result with a field-error key.
import { type AppError, appError } from '#src/lib/errors.ts';
import { MoneyPoisha } from '#src/lib/money.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

/** BR5.1: the 8-digit whole part caps every parse at 99,999,999.99 taka = 9,999,999,999 poisha. */
export const PRICE_PARSE_CEILING_POISHA = 9_999_999_999;

/** BR5.5: the only access durations a course can have, in months. */
export const ACCESS_DURATIONS = [4, 6, 12] as const;
export type AccessDurationMonths = (typeof ACCESS_DURATIONS)[number];

/** BR5.1: the exact accepted forms, after trimming and mapping Bangla digits. */
const PRICE_GRAMMAR = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/;
const BANGLA_DIGIT = /[০-৯]/g;
const BANGLA_ZERO = '০'.charCodeAt(0);

export type PriceError = AppError<'VALIDATION_FAILED'>;
export type PriceBounds = { minPoisha: number; maxPoisha: number };

function priceError(key: string, details?: Record<string, number>): PriceError {
  return appError('VALIDATION_FAILED', {
    fieldErrors: { price: [key] },
    ...(details ? { details } : {}),
  });
}

function toLatinDigits(text: string): string {
  return text.replace(BANGLA_DIGIT, (d) => String(d.charCodeAt(0) - BANGLA_ZERO));
}

/**
 * BR5.1: "1499.5" → 149950, "০.০৫" → 5. Exact string parsing on integers: whole taka × 100 plus the
 * fraction digits right-padded to two. Anything outside the grammar is refused.
 */
export function parseTakaToPoisha(input: string): Result<MoneyPoisha, PriceError> {
  const match = PRICE_GRAMMAR.exec(toLatinDigits(input.trim()));
  if (!match) return err(priceError('errors.catalog.priceFormat'));
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  // whole ≤ 99,999,999, so the product stays far inside the safe integer range.
  return ok(MoneyPoisha.parse(whole * 100 + fraction));
}

/** Shared range check: a valid integer amount of at least 1 poisha (BR5.3) inside [min, max]. */
function checkRange(
  poisha: number,
  range: PriceBounds,
  details: Record<string, number>,
): Result<MoneyPoisha, PriceError> {
  const money = MoneyPoisha.safeParse(poisha);
  if (!money.success) return err(priceError('errors.catalog.priceFormat'));
  if (money.data < 1) return err(priceError('errors.catalog.priceTooLow'));
  if (money.data < range.minPoisha) return err(priceError('errors.catalog.priceBelowMin', details));
  if (money.data > range.maxPoisha) return err(priceError('errors.catalog.priceAboveMax', details));
  return ok(money.data);
}

/** BR5.2, BR5.3: a course list price within the Admin-set minimum and maximum. */
export function checkCoursePrice(
  poisha: number,
  bounds: PriceBounds,
): Result<MoneyPoisha, PriceError> {
  return checkRange(poisha, bounds, { minPoisha: bounds.minPoisha, maxPoisha: bounds.maxPoisha });
}

/** BR5.9, BR10.9: an exam package, plan or Practice Pack price under its ceiling; floor 1 poisha. */
export function checkPriceCeiling(
  poisha: number,
  ceilingPoisha: number,
): Result<MoneyPoisha, PriceError> {
  return checkRange(
    poisha,
    { minPoisha: 1, maxPoisha: ceilingPoisha },
    { maxPoisha: ceilingPoisha },
  );
}

/** BR5.5: exactly 4, 6 or 12 months, checked on the server whatever the client sent. */
export function checkAccessDuration(
  months: unknown,
): Result<AccessDurationMonths, AppError<'VALIDATION_FAILED'>> {
  if ((ACCESS_DURATIONS as readonly unknown[]).includes(months)) {
    return ok(months as AccessDurationMonths);
  }
  return err(
    appError('VALIDATION_FAILED', { fieldErrors: { months: ['errors.catalog.durationInvalid'] } }),
  );
}

// ------------------------------------------------------------------ product prices (Bolt 5)

/** The products whose price has a single Admin-set ceiling and a floor of 1 poisha. */
export type CeilingProduct = 'exam_package' | 'subscription_plan' | 'practice_pack';

const CEILING_SETTING: Readonly<Record<CeilingProduct, string>> = {
  /** BR5.9 */
  exam_package: 'catalog.examPackagePrice.maxPoisha',
  /** BR5.9: the monthly price of a plan. */
  subscription_plan: 'catalog.planMonthlyPrice.maxPoisha',
  /** BR10.9: a Practice Pack has the course maximum; the course minimum does not apply. */
  practice_pack: 'catalog.coursePrice.maxPoisha',
};

/** The setting key that holds a product's price ceiling (BR5.9, BR10.9). */
export function ceilingSettingFor(product: CeilingProduct): string {
  return CEILING_SETTING[product];
}

/** BR5.1 then BR5.3 / BR5.9 / BR10.9: a taka string parsed exactly, then held under the ceiling. */
export function parseProductPrice(
  input: string,
  ceilingPoisha: number,
): Result<MoneyPoisha, PriceError> {
  const parsed = parseTakaToPoisha(input);
  if (!parsed.ok) return parsed;
  return checkPriceCeiling(parsed.value, ceilingPoisha);
}

/**
 * BR5.9 / BR10.5 / BR10.9 at publish: the stored price is checked again against the ceiling current
 * now, so a lowered ceiling refuses the publish until the price is changed. No price is refused.
 */
export function recheckPublishPrice(
  storedPoisha: number | null,
  ceilingPoisha: number,
): Result<MoneyPoisha, PriceError> {
  if (storedPoisha === null) return err(priceError('errors.catalog.priceRequired'));
  return checkPriceCeiling(storedPoisha, ceilingPoisha);
}
