// US8.5 bundle price allocation (money, plain TypeScript, BigInt arithmetic). A bundle's price is
// split across its member courses in proportion to their standalone list prices, so that each
// course's sale (and its instructors' shares) is posted to the ledger at its part of the price.
// The one remainder rule: every part is first rounded down to whole poisha; the leftover poisha
// (fewer than the number of courses) go one each to the parts with the largest remainders, ties to
// the earlier course in the bundle. When every list price is 0 the split is even. A part of 0
// poisha is refused, since every sale must be at least 1 poisha.
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

const invalid = (i18nKey: `errors.${string}` = 'errors.commerce.bundlePrice') => ({
  ...appError('VALIDATION_FAILED'),
  i18nKey,
});

/** Each course's part of the bundle price, in the bundle's course order. */
export function allocateBundlePrice(
  pricePoisha: number,
  listPricesPoisha: readonly number[],
): Result<number[], AppError<'VALIDATION_FAILED'>> {
  if (listPricesPoisha.length === 0) return err(invalid());
  if (!Number.isSafeInteger(pricePoisha) || pricePoisha < 1) return err(invalid());
  if (listPricesPoisha.some((l) => !Number.isSafeInteger(l) || l < 0)) return err(invalid());
  const price = BigInt(pricePoisha);
  const listTotal = listPricesPoisha.reduce((s, l) => s + BigInt(l), 0n);
  const weights = listTotal === 0n ? listPricesPoisha.map(() => 1n) : listPricesPoisha.map(BigInt);
  const total = listTotal === 0n ? BigInt(listPricesPoisha.length) : listTotal;
  const parts = weights.map((w) => ({ base: (price * w) / total, remainder: (price * w) % total }));
  let leftover = price - parts.reduce((s, p) => s + p.base, 0n);
  const order = parts
    .map((p, index) => ({ index, remainder: p.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const result = parts.map((p) => p.base);
  for (const { index } of order) {
    if (leftover === 0n) break;
    result[index] = (result[index] as bigint) + 1n;
    leftover -= 1n;
  }
  if (result.some((p) => p < 1n)) return err(invalid('errors.commerce.bundlePriceTooLow'));
  return ok(result.map(Number));
}
