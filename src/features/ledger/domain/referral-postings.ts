// Referral postings (US8.7/US8.8), plain TypeScript. Separate from course sales and instructor
// payouts: a referral transaction only ever touches referral_expense, the referrer's
// referral_payable and, for a payout, the cash (gateway_clearing). Signed amounts: a debit is
// positive, a credit negative; each transaction sums to zero.
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export type ReferralKind = 'referral_accrual' | 'referral_clawback' | 'referral_payout';
export type ReferralAccount = 'referral_payable' | 'referral_expense' | 'gateway_clearing';
export type ReferralPosting = {
  account: ReferralAccount;
  referrerId: string | null;
  amount: number;
};

export function referralPostings(
  kind: ReferralKind,
  referrerId: string,
  amount: number,
): Result<ReferralPosting[], AppError<'VALIDATION_FAILED'>> {
  if (!Number.isSafeInteger(amount) || amount <= 0) return err(appError('VALIDATION_FAILED'));
  const payable = (signed: number): ReferralPosting => ({
    account: 'referral_payable',
    referrerId,
    amount: signed,
  });
  if (kind === 'referral_accrual')
    return ok([{ account: 'referral_expense', referrerId: null, amount }, payable(-amount)]);
  if (kind === 'referral_clawback')
    return ok([
      payable(amount),
      { account: 'referral_expense', referrerId: null, amount: -amount },
    ]);
  return ok([payable(amount), { account: 'gateway_clearing', referrerId: null, amount: -amount }]);
}

/** A referrer's balance: what the platform owes them (the negated sum of their payable lines). */
export function referralBalanceOf(
  lines: ReadonlyArray<{ account: string; referrerId: string | null; amount: number }>,
  referrerId: string,
): number {
  return -lines
    .filter((l) => l.account === 'referral_payable' && l.referrerId === referrerId)
    .reduce((s, l) => s + l.amount, 0);
}
