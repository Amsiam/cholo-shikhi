// Calendar-month arithmetic and display time zone (UTC stored, Asia/Dhaka shown).
import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  dhakaDateParts,
  fixedClock,
  formatDateTime,
  systemClock,
} from './time.ts';

describe('addCalendarMonths (Asia/Dhaka calendar)', () => {
  it('adds one month on the same Dhaka day-of-month', () => {
    expect(addCalendarMonths('2026-03-15T04:00:00.000Z', 1)).toBe('2026-04-15T04:00:00.000Z');
  });

  it('clamps 31 January to the last day of February (non-leap year)', () => {
    // 2026-01-31 10:00 in Dhaka is 04:00Z.
    expect(addCalendarMonths('2026-01-31T04:00:00.000Z', 1)).toBe('2026-02-28T04:00:00.000Z');
  });

  it('clamps to 29 February in a leap year', () => {
    expect(addCalendarMonths('2028-01-31T04:00:00.000Z', 1)).toBe('2028-02-29T04:00:00.000Z');
  });

  it('uses the Dhaka date, not the UTC date, near midnight', () => {
    // 2026-01-31T20:00Z is already 1 February 02:00 in Dhaka, so +1 month is 1 March 02:00 Dhaka.
    expect(addCalendarMonths('2026-01-31T20:00:00.000Z', 1)).toBe('2026-02-28T20:00:00.000Z');
  });

  it('crosses a year boundary and supports 12 months', () => {
    expect(addCalendarMonths('2026-12-10T00:00:00.000Z', 1)).toBe('2027-01-10T00:00:00.000Z');
    expect(addCalendarMonths('2026-02-28T00:00:00.000Z', 12)).toBe('2027-02-28T00:00:00.000Z');
  });

  it('rejects a non-integer or negative month count', () => {
    expect(() => addCalendarMonths('2026-01-01T00:00:00.000Z', 1.5)).toThrow();
    expect(() => addCalendarMonths('2026-01-01T00:00:00.000Z', -1)).toThrow();
  });
});

describe('display formatting', () => {
  it('shows Dhaka local date parts', () => {
    expect(dhakaDateParts('2026-01-31T20:00:00.000Z')).toEqual({ year: 2026, month: 2, day: 1 });
  });

  it('formats in English and Bangla (Bangla digits) in Asia/Dhaka', () => {
    expect(formatDateTime('2026-01-31T20:00:00.000Z', 'en')).toContain('Feb 1, 2026');
    expect(formatDateTime('2026-01-31T20:00:00.000Z', 'bn')).toContain('২০২৬');
  });

  it('systemClock returns an ISO UTC instant', () => {
    expect(systemClock.now()).toMatch(/Z$/);
  });
});

describe('fixedClock', () => {
  it('starts at the given instant, advances and can be set', () => {
    const clock = fixedClock('2026-11-13T00:00:00.000Z');
    expect(clock.now()).toBe('2026-11-13T00:00:00.000Z');
    clock.advanceMs(1500);
    expect(clock.now()).toBe('2026-11-13T00:00:01.500Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now()).toBe('2027-01-01T00:00:00.000Z');
  });
});
