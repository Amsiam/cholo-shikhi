// [LT] Refund policy: who may ask, and how much a decision pays back.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type RefundEligibility, refundAmount, refundBlock, unusedDaysRefund } from './refund.ts';

const now = new Date('2026-03-10T00:00:00Z');
const ok: RefundEligibility = {
  paymentStatus: 'succeeded',
  kind: 'purchase',
  settledAt: new Date('2026-03-05T00:00:00Z'),
  enrolmentStatus: 'active',
  hasRenewal: false,
  hasOpenOrApprovedRequest: false,
  windowDays: 7,
};

describe('refundBlock', () => {
  it('allows a recent, active first purchase', () => expect(refundBlock(ok, now)).toBeNull());
  it.each([
    [{ windowDays: null }, 'windowUnset'],
    [{ paymentStatus: 'failed' as const }, 'notPaid'],
    [{ settledAt: null }, 'notPaid'],
    [{ kind: 'renewal' as const }, 'renewal'],
    [{ hasOpenOrApprovedRequest: true }, 'alreadyRequested'],
    [{ enrolmentStatus: 'revoked' as const }, 'notActive'],
    [{ hasRenewal: true }, 'renewed'],
    [{ windowDays: 3 }, 'windowClosed'],
  ])('%o blocks with %s', (patch, reason) =>
    expect(refundBlock({ ...ok, ...patch }, now)).toBe(reason),
  );
});

describe('unusedDaysRefund', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-07-01T00:00:00Z');
  it('pays back the unused share, rounded down', () => {
    const half = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    expect(unusedDaysRefund(100_001, start, end, half)).toBe(50_000);
  });
  it('is everything before the start, nothing after the end or for an empty window', () => {
    expect(unusedDaysRefund(90_000, start, end, new Date('2025-12-31T00:00:00Z'))).toBe(90_000);
    expect(unusedDaysRefund(90_000, start, end, new Date('2026-08-01T00:00:00Z'))).toBe(0);
    expect(unusedDaysRefund(90_000, start, start, start)).toBe(0);
  });
  it('never exceeds what was paid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e9 }),
        fc.integer({ min: -1e10, max: 3e10 }),
        (paid, offset) => {
          const r = unusedDaysRefund(paid, start, end, new Date(start.getTime() + offset));
          return r >= 0 && r <= paid;
        },
      ),
    );
  });
});

describe('refundAmount', () => {
  const w = {
    startsAt: new Date('2026-03-05T00:00:00Z'),
    endsAt: new Date('2026-09-05T00:00:00Z'),
  };
  it('full, unused and partial', () => {
    expect(refundAmount('full', 120_000, w, now)).toBe(120_000);
    expect(refundAmount('unused', 120_000, w, now)).toBe(
      unusedDaysRefund(120_000, w.startsAt, w.endsAt, now),
    );
    expect(refundAmount('partial', 120_000, w, now, 50_000)).toBe(50_000);
  });
  it('refuses nothing, more than paid, or a fraction of a poisha', () => {
    expect(refundAmount('partial', 120_000, w, now)).toBeNull();
    expect(refundAmount('partial', 120_000, w, now, 120_001)).toBeNull();
    expect(refundAmount('partial', 120_000, w, now, 10.5)).toBeNull();
    expect(refundAmount('unused', 120_000, w, new Date('2027-01-01T00:00:00Z'))).toBeNull();
  });
});
