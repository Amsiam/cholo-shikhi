// The pricing domain for promo codes (US8.2, US8.3; FR8.1, FR7.10). Plain TypeScript, integer
// poisha only: percent values are basis points and the share is computed with BigInt, rounded
// down to whole poisha (the buyer never pays less than the exact discounted price). A discount
// that would leave nothing to pay is refused: a 0-poisha checkout never reaches the gateway.
import { type AppError, appError } from '#src/lib/errors.ts';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export type Discount = { kind: 'percent'; bps: number } | { kind: 'fixed'; poisha: number };
export type PromoError = AppError<'VALIDATION_FAILED' | 'INVALID_STATE' | 'NOT_FOUND'>;

export const MAX_BPS = 10_000;

const refused = (
  code: PromoError['code'],
  i18nKey: `errors.promo.${string}`,
  field?: string,
): PromoError => ({
  ...appError(code),
  i18nKey,
  ...(field ? { fieldErrors: { [field]: [i18nKey] } } : {}),
});

/** The discount on a price and what is left to pay; refused if nothing would be left. */
export function discountFor(
  price: MoneyPoisha,
  discount: Discount,
): Result<{ discountPoisha: number; payPoisha: number }, PromoError> {
  const off =
    discount.kind === 'percent'
      ? Number((BigInt(price) * BigInt(discount.bps)) / BigInt(MAX_BPS))
      : discount.poisha;
  if (off >= price) return err(refused('INVALID_STATE', 'errors.promo.exceedsPrice'));
  return ok({ discountPoisha: off, payPoisha: price - off });
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** AC8.2.2: basis points 1–10000, whole positive poisha, real dates in order, at least one use. */
export function validatePromoTerms(input: {
  discount: Discount;
  startsOn: string;
  endsOn: string;
  maxUses: number;
}): Result<void, PromoError> {
  const d = input.discount;
  if (d.kind === 'percent' && !(Number.isInteger(d.bps) && d.bps >= 1 && d.bps <= MAX_BPS))
    return err(refused('VALIDATION_FAILED', 'errors.promo.percent', 'percentBps'));
  if (d.kind === 'fixed' && !(Number.isSafeInteger(d.poisha) && d.poisha >= 1))
    return err(refused('VALIDATION_FAILED', 'errors.promo.fixed', 'fixedPoisha'));
  if (!DATE.test(input.startsOn) || !DATE.test(input.endsOn) || input.endsOn < input.startsOn)
    return err(refused('VALIDATION_FAILED', 'errors.promo.dates', 'endsOn'));
  if (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1)
    return err(refused('VALIDATION_FAILED', 'errors.promo.maxUses', 'maxUses'));
  return ok(undefined);
}

export type PromoScope = {
  isActive: boolean;
  courseIds: readonly string[];
  segmentIds: readonly string[];
  startsOn: string;
  endsOn: string;
  maxUses: number;
  usedCount: number;
};

/**
 * AC8.3.3: why a code cannot be used for this course today (a Dhaka calendar date), or null.
 * An empty course or segment list means the code is not limited by it.
 */
export function promoRefusal(
  promo: PromoScope,
  at: { courseId: string; segmentId: string | null; today: string },
): `errors.promo.${string}` | null {
  if (!promo.isActive) return 'errors.promo.inactive';
  if (at.today < promo.startsOn) return 'errors.promo.notStarted';
  if (at.today > promo.endsOn) return 'errors.promo.expired';
  if (promo.courseIds.length > 0 && !promo.courseIds.includes(at.courseId))
    return 'errors.promo.outOfScope';
  if (
    promo.segmentIds.length > 0 &&
    (at.segmentId === null || !promo.segmentIds.includes(at.segmentId))
  )
    return 'errors.promo.outOfScope';
  if (promo.usedCount >= promo.maxUses) return 'errors.promo.usedUp';
  return null;
}

/** Codes are matched case-insensitively and stored in upper case ("bcs20" is "BCS20"). */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}
