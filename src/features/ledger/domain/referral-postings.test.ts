// [UT] US8.7/US8.8 referral postings (money, test-first): every referral transaction balances to
// zero, touches only the referral accounts (never platform revenue or an instructor's payable),
// and a referrer's balance is the sum of their referral_payable credits.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ReferralKind, referralBalanceOf, referralPostings } from './referral-postings.ts';

const R = '00000000-0000-4000-8000-0000000000a1';

describe('referralPostings', () => {
  it('an accrual moves the share from expense to the referrer', () => {
    expect(referralPostings('referral_accrual', R, 4000)).toEqual({
      ok: true,
      value: [
        { account: 'referral_expense', referrerId: null, amount: 4000 },
        { account: 'referral_payable', referrerId: R, amount: -4000 },
      ],
    });
  });
  it('a clawback reverses it; a payout pays it out in cash', () => {
    expect(referralPostings('referral_clawback', R, 4000)).toEqual({
      ok: true,
      value: [
        { account: 'referral_payable', referrerId: R, amount: 4000 },
        { account: 'referral_expense', referrerId: null, amount: -4000 },
      ],
    });
    expect(referralPostings('referral_payout', R, 4000)).toEqual({
      ok: true,
      value: [
        { account: 'referral_payable', referrerId: R, amount: 4000 },
        { account: 'gateway_clearing', referrerId: null, amount: -4000 },
      ],
    });
  });
  it('refuses 0, negative or non-whole amounts', () => {
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(referralPostings('referral_accrual', R, amount)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
  });
});

describe('referralBalanceOf', () => {
  it('AC8.7.3: accrue 4000, withdraw 4000, then a clawback leaves -4000', () => {
    const lines = (['referral_accrual', 'referral_payout', 'referral_clawback'] as const).flatMap(
      (k) => {
        const r = referralPostings(k, R, 4000);
        return r.ok ? r.value : [];
      },
    );
    expect(lines).toHaveLength(6);
    expect(referralBalanceOf(lines, R)).toBe(-4000);
  });
});

const kind = fc.constantFrom<ReferralKind>(
  'referral_accrual',
  'referral_clawback',
  'referral_payout',
);

describe('referral posting properties', () => {
  it('every transaction balances and never touches revenue or instructor payables', () => {
    fc.assert(
      fc.property(kind, fc.integer({ min: 1, max: 1_000_000_000 }), (k, amount) => {
        const r = referralPostings(k, R, amount);
        if (!r.ok) return false;
        return (
          r.value.reduce((s, p) => s + p.amount, 0) === 0 &&
          r.value.every(
            (p) =>
              !['platform_revenue', 'instructor_payable', 'unassigned_instructor_pool'].includes(
                p.account,
              ) && p.amount !== 0,
          )
        );
      }),
    );
  });

  it('the balance is accruals minus clawbacks minus payouts (conservation)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(kind, fc.integer({ min: 1, max: 1_000_000 })), { maxLength: 30 }),
        (events) => {
          const lines = events.flatMap(([k, a]) => {
            const r = referralPostings(k, R, a);
            return r.ok ? r.value : [];
          });
          const expected = events.reduce((s, [k, a]) => s + (k === 'referral_accrual' ? a : -a), 0);
          return referralBalanceOf(lines, R) === expected;
        },
      ),
    );
  });
});
