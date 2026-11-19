// Refund money rules. A refund reverses its sale in proportion: every line of the sale gives back
// floor(line × refund / sale), and the poisha left over go to the lines with the largest
// remainders (ties in posting order). The result is balanced and never takes back more than a line
// received; a full refund is the exact reverse. Plain TypeScript, integer poisha only.
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Posting } from './revenue-split.ts';

const invalid = () =>
  appError('VALIDATION_FAILED', { fieldErrors: { refund: ['errors.ledger.refundInvalid'] } });

export function refundPostings(
  sale: readonly Posting[],
  refund: number,
): Result<Posting[], AppError<'VALIDATION_FAILED'>> {
  const debit = sale.find((p) => p.account === 'gateway_clearing');
  const amount = debit?.amount ?? 0;
  if (!Number.isSafeInteger(refund) || refund <= 0 || refund > amount) return err(invalid());
  const credits = sale.filter((p) => p !== debit);
  const big = BigInt(refund);
  const total = BigInt(amount);
  const rows = credits.map((p, i) => {
    const exact = BigInt(-p.amount) * big;
    return { p, i, base: exact / total, remainder: exact % total };
  });
  let leftover = big - rows.reduce((s, r) => s + r.base, 0n);
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1,
  );
  const extra = new Set<number>();
  for (const r of order) {
    if (leftover === 0n) break;
    extra.add(r.i);
    leftover -= 1n;
  }
  const back: Posting[] = rows.map((r) => ({
    account: r.p.account,
    instructorId: r.p.instructorId,
    amount: Number(r.base + (extra.has(r.i) ? 1n : 0n)),
  }));
  return ok(
    [{ account: 'gateway_clearing' as const, instructorId: null, amount: -refund }, ...back].filter(
      (p) => p.amount !== 0,
    ),
  );
}
