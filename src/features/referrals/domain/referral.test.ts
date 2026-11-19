// [UT] US8.7 / US8.8 referral money (test-first): the share of a paid enrolment, the clawback on a
// refund, and when a balance may be withdrawn. Integer poisha only, BigInt where it multiplies.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clawbackFor,
  isReferralCode,
  referralShare,
  type WithdrawalFacts,
  withdrawalBlock,
} from './referral.ts';

describe('referralShare', () => {
  it('AC8.7.1: 500 bp of 80000 poisha paid after promo is 4000', () => {
    expect(referralShare(80_000, 500)).toBe(4000);
  });
  it('rounds down to whole poisha', () => {
    expect(referralShare(999, 500)).toBe(49);
    expect(referralShare(1, 9999)).toBe(0);
    expect(referralShare(0, 500)).toBe(0);
    expect(referralShare(12_345, 10_000)).toBe(12_345);
  });
  it('refuses a bad amount or rate', () => {
    for (const [paid, bps] of [
      [-1, 500],
      [1.5, 500],
      [Number.MAX_SAFE_INTEGER + 1, 1],
      [100, -1],
      [100, 10_001],
      [100, 2.5],
    ])
      expect(() => referralShare(paid as number, bps as number)).toThrow(RangeError);
  });
});

describe('clawbackFor', () => {
  it('AC8.7.2: a full refund claws back the whole accrual', () => {
    expect(clawbackFor({ accrued: 4000, paid: 80_000, refunded: 80_000 })).toBe(4000);
  });
  it('a partial refund leaves the referrer the accrual in proportion to what stayed paid', () => {
    // 30000 of 80000 refunded: 4000 x 50000 / 80000 = 2500 kept, so 1500 comes back.
    expect(clawbackFor({ accrued: 4000, paid: 80_000, refunded: 30_000 })).toBe(1500);
    // Kept rounds down: 49 x 2 / 3 = 32.67, 32 kept, 17 back.
    expect(clawbackFor({ accrued: 49, paid: 3, refunded: 1 })).toBe(17);
  });
  it('claws back nothing on no refund, or when nothing was accrued or paid', () => {
    expect(clawbackFor({ accrued: 4000, paid: 80_000, refunded: 0 })).toBe(0);
    expect(clawbackFor({ accrued: 0, paid: 80_000, refunded: 80_000 })).toBe(0);
    expect(clawbackFor({ accrued: 0, paid: 0, refunded: 0 })).toBe(0);
  });
  it('refuses bad inputs', () => {
    expect(() => clawbackFor({ accrued: -1, paid: 10, refunded: 1 })).toThrow(RangeError);
    expect(() => clawbackFor({ accrued: 1, paid: 10, refunded: 11 })).toThrow(RangeError);
    expect(() => clawbackFor({ accrued: 1, paid: 10, refunded: -1 })).toThrow(RangeError);
  });
});

const ready: WithdrawalFacts = {
  isAdult: true,
  thresholdPoisha: 50_000,
  balancePoisha: 60_000,
  kycStatus: 'verified',
  isQuarantined: false,
  isSuspended: false,
  hasPendingWithdrawal: false,
};

describe('withdrawalBlock', () => {
  it('AC8.8.1: an adult with cleared KYC at or above the threshold may withdraw', () => {
    expect(withdrawalBlock(ready)).toBeNull();
    expect(withdrawalBlock({ ...ready, balancePoisha: 50_000 })).toBeNull();
  });
  it('AC8.9.2: without the adult declaration nothing is payable', () => {
    expect(withdrawalBlock({ ...ready, isAdult: false })).toBe('adult_required');
  });
  it('AC8.8.2: with no threshold set, payouts are not available yet', () => {
    expect(withdrawalBlock({ ...ready, thresholdPoisha: null })).toBe('threshold_unset');
  });
  it('AC8.8.3 and the fraud hold: KYC not cleared, quarantined or suspended', () => {
    expect(withdrawalBlock({ ...ready, kycStatus: 'submitted' })).toBe('kyc_not_cleared');
    expect(withdrawalBlock({ ...ready, kycStatus: null })).toBe('kyc_not_cleared');
    expect(withdrawalBlock({ ...ready, isQuarantined: true })).toBe('quarantined');
    expect(withdrawalBlock({ ...ready, isSuspended: true })).toBe('quarantined');
  });
  it('AC8.7.3: no payout while the balance is 0 or below; below the threshold waits', () => {
    expect(withdrawalBlock({ ...ready, balancePoisha: 0 })).toBe('nothing_to_pay');
    expect(withdrawalBlock({ ...ready, balancePoisha: -4000 })).toBe('nothing_to_pay');
    expect(withdrawalBlock({ ...ready, balancePoisha: 49_999 })).toBe('below_threshold');
  });
  it('one withdrawal at a time', () => {
    expect(withdrawalBlock({ ...ready, hasPendingWithdrawal: true })).toBe('pending');
  });
});

describe('isReferralCode', () => {
  it('accepts the opaque 10-character code only', () => {
    expect(isReferralCode('K7Q2M9XW4P')).toBe(true);
    expect(isReferralCode('k7q2m9xw4p')).toBe(false);
    expect(isReferralCode('K7Q2M9XW4')).toBe(false);
    expect(isReferralCode('rumi@example.test')).toBe(false);
  });
});

const paid = fc.integer({ min: 0, max: 10_000_000_000 });
const bps = fc.integer({ min: 0, max: 10_000 });
const paidAndRefund = paid.chain((p) => fc.tuple(fc.constant(p), fc.integer({ min: 0, max: p })));

describe('referral properties', () => {
  it('a share is never negative, never above the amount paid, and grows with it', () => {
    fc.assert(
      fc.property(paid, paid, bps, (a, b, r) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const s = referralShare(lo, r);
        return s >= 0 && s <= lo && s <= referralShare(hi, r);
      }),
    );
  });

  it('a clawback is between 0 and the accrual; a full refund takes it all, none takes nothing', () => {
    fc.assert(
      fc.property(paidAndRefund, bps, ([p, refunded], r) => {
        const accrued = referralShare(p, r);
        const back = clawbackFor({ accrued, paid: p, refunded });
        const kept = accrued - back;
        return (
          back >= 0 &&
          back <= accrued &&
          (refunded !== p || back === accrued) &&
          (refunded !== 0 || back === 0) &&
          // Kept is the accrual's proportional part, rounded down (BigInt cross-multiplication).
          BigInt(kept) * BigInt(Math.max(p, 1)) <= BigInt(accrued) * BigInt(p - refunded) &&
          (BigInt(kept) + 1n) * BigInt(Math.max(p, 1)) > BigInt(accrued) * BigInt(p - refunded)
        );
      }),
    );
  });

  it('a larger refund never claws back less', () => {
    fc.assert(
      fc.property(paid, bps, fc.integer({ min: 0, max: 1000 }), (p, r, step) => {
        const accrued = referralShare(p, r);
        const a = Math.min(p, step);
        const b = Math.min(p, step * 2);
        return (
          clawbackFor({ accrued, paid: p, refunded: a }) <=
          clawbackFor({ accrued, paid: p, refunded: b })
        );
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(paid, bps, (p, r) => {
        const first = referralShare(p, r);
        const again = referralShare(Number(BigInt(p)), r);
        return first === again;
      }),
    );
  });
});
