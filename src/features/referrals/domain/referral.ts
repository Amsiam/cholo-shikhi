// Referral money rules (US8.6–US8.9; FR8.2), plain TypeScript. Integer poisha only; products are
// taken in BigInt so no amount loses a poisha. The rounding rule: a share rounds DOWN to whole
// poisha; a clawback leaves the referrer the accrual in proportion to what stayed paid.

const MAX_BPS = 10_000;

function assertPoisha(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be whole, non-negative poisha`);
}

function assertBps(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BPS)
    throw new RangeError('bps must be a whole number from 0 to 10000');
}

/** US8.7: the referrer's share of an amount paid (after promo), in basis points, rounded down. */
export function referralShare(paidPoisha: number, bps: number): number {
  assertPoisha('paidPoisha', paidPoisha);
  assertBps(bps);
  return Number((BigInt(paidPoisha) * BigInt(bps)) / BigInt(MAX_BPS));
}

/**
 * AC8.7.2: what a refund claws back from an accrual. The referrer keeps the accrual in proportion
 * to what stayed paid, rounded down; the rest comes back. A full refund claws back everything, and
 * the clawback is never below 0 nor above the accrual.
 */
export function clawbackFor(input: { accrued: number; paid: number; refunded: number }): number {
  assertPoisha('accrued', input.accrued);
  assertPoisha('paid', input.paid);
  assertPoisha('refunded', input.refunded);
  if (input.refunded > input.paid) throw new RangeError('refunded must not exceed paid');
  if (input.paid === 0) return 0;
  const kept = (BigInt(input.accrued) * BigInt(input.paid - input.refunded)) / BigInt(input.paid);
  return input.accrued - Number(kept);
}

export type WithdrawalFacts = {
  /** AC8.9.2: the referrer declared they are 18 or older. */
  isAdult: boolean;
  /** The Admin-set minimum, or null when it is not set (AC8.8.2). */
  thresholdPoisha: number | null;
  /** The referral balance; may be negative after a clawback (AC8.7.3). */
  balancePoisha: number;
  /** KYC and payout account (contract 17 getVerificationStatus); only `verified` is cleared. */
  kycStatus: string | null;
  /** An open referral fraud flag holds earnings (US8.11). */
  isQuarantined: boolean;
  /** A suspended (banned) account is never paid. */
  isSuspended: boolean;
  hasPendingWithdrawal: boolean;
};

export type WithdrawalBlock =
  | 'adult_required'
  | 'threshold_unset'
  | 'quarantined'
  | 'kyc_not_cleared'
  | 'nothing_to_pay'
  | 'below_threshold'
  | 'pending';

/** Why the balance cannot be withdrawn now, or null when it can (AC8.8.1–AC8.8.3, AC8.9.2). */
export function withdrawalBlock(f: WithdrawalFacts): WithdrawalBlock | null {
  if (!f.isAdult) return 'adult_required';
  if (f.thresholdPoisha === null) return 'threshold_unset';
  if (f.isQuarantined || f.isSuspended) return 'quarantined';
  if (f.kycStatus !== 'verified') return 'kyc_not_cleared';
  if (f.balancePoisha <= 0) return 'nothing_to_pay';
  if (f.balancePoisha < f.thresholdPoisha) return 'below_threshold';
  if (f.hasPendingWithdrawal) return 'pending';
  return null;
}

/** AC8.6.1: the code in a referral link: 10 opaque characters, no personal data. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function isReferralCode(text: string): boolean {
  return /^[A-HJ-NP-Z2-9]{10}$/.test(text);
}
