// [LT] US2.18/US2.19: switch refunds (the AC2.18.1 worked case), deadlines and expiry.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  effectiveSwitchStatus,
  minutesLeft,
  SWITCH_WINDOW_MS,
  switchDeadline,
  switchRefund,
} from './switch.ts';

const access = {
  startsAt: new Date('2027-01-01T00:00:00Z'),
  endsAt: new Date('2027-07-01T00:00:00Z'),
};

describe('switchRefund', () => {
  it('AC2.18.1: 180000 poisha, 181 days, switched on day 32 → floor(180000 × 150 / 181)', () => {
    const day32 = new Date('2027-02-01T00:00:00Z');
    expect(switchRefund('unused', 180_000, access, day32)).toBe(149_171);
  });
  it('AC2.18.2: the full policy refunds everything paid', () => {
    expect(switchRefund('full', 180_000, access, new Date('2027-05-01T00:00:00Z'))).toBe(180_000);
  });
  it('never refunds more than was paid, nor a negative amount, and is an integer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: -400, max: 400 }),
        (paid, dayOffset) => {
          const now = new Date(access.startsAt.getTime() + dayOffset * 86_400_000);
          const r = switchRefund('unused', paid, access, now);
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(paid);
        },
      ),
    );
  });
});

describe('deadlines', () => {
  const requested = new Date('2027-03-01T10:00:00Z');
  const deadline = switchDeadline(requested);
  it('expires at exactly 24 h, not at 23 h 59 min (AC2.19.1, AC2.19.2)', () => {
    expect(deadline.getTime() - requested.getTime()).toBe(SWITCH_WINDOW_MS);
    expect(effectiveSwitchStatus('pending', deadline, new Date(deadline.getTime() - 60_000))).toBe(
      'pending',
    );
    expect(effectiveSwitchStatus('pending', deadline, deadline)).toBe('expired');
  });
  it('a decided request keeps its status after the deadline (AC2.19.3)', () => {
    expect(effectiveSwitchStatus('approved', deadline, new Date(deadline.getTime() + 1))).toBe(
      'approved',
    );
  });
  it('counts whole minutes left, rounding up, never below 0', () => {
    expect(minutesLeft(deadline, new Date(deadline.getTime() - 90_500))).toBe(2);
    expect(minutesLeft(deadline, new Date(deadline.getTime() + 5))).toBe(0);
  });
});
