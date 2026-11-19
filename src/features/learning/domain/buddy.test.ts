// [LT] Study buddies (US5.13, US5.14): the 1.2× day, its rounding, and when a pair counts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buddyBonus,
  buddyDailyTokens,
  isPairActiveOn,
  makeInviteCode,
  normaliseInviteCode,
} from './buddy.ts';

describe('buddyDailyTokens', () => {
  it('AC5.13.1: 1.2 × B, rounded by the configured rule', () => {
    expect(buddyDailyTokens(5, 'half_up')).toBe(6);
    expect(buddyDailyTokens(3, 'half_up')).toBe(4); // 3.6
    expect(buddyDailyTokens(3, 'down')).toBe(3);
    expect(buddyDailyTokens(2, 'up')).toBe(3); // 2.4
    expect(buddyDailyTokens(2, 'half_up')).toBe(2); // 2.4
    expect(buddyDailyTokens(0, 'up')).toBe(0);
  });
  it('the bonus is the top-up over B and never negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom('half_up', 'down', 'up'),
        (b, r) => {
          const bonus = buddyBonus(b, r as 'half_up');
          expect(bonus).toBeGreaterThanOrEqual(0);
          expect(b + bonus).toBe(buddyDailyTokens(b, r as 'half_up'));
        },
      ),
    );
  });
});

describe('isPairActiveOn', () => {
  it('AC5.14.1: a pair ended today still counts today, not tomorrow', () => {
    const pair = { startsDay: '2026-11-10', endsDay: '2026-11-19' };
    expect(isPairActiveOn(pair, '2026-11-09')).toBe(false);
    expect(isPairActiveOn(pair, '2026-11-10')).toBe(true);
    expect(isPairActiveOn(pair, '2026-11-18')).toBe(true);
    expect(isPairActiveOn(pair, '2026-11-19')).toBe(false);
    expect(isPairActiveOn({ startsDay: '2026-11-10', endsDay: null }, '2027-01-01')).toBe(true);
  });
});

describe('invite codes', () => {
  it('are six unambiguous characters and normalise typing', () => {
    expect(makeInviteCode(() => 0)).toBe('AAAAAA');
    expect(makeInviteCode(Math.random)).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normaliseInviteCode(' ab3-xy7 ')).toBe('AB3XY7');
  });
});
