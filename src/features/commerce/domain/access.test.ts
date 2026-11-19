// [LT] Access windows (FR-DIST-4) and receipt numbers.
import { describe, expect, it } from 'vitest';
import { accessState, canRenew, EXPIRY_WARNING_DAYS, extendEnd, receiptNumber } from './access.ts';

const now = new Date('2026-11-18T06:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 3600 * 1000);

describe('accessState', () => {
  it('is quiet with plenty of time left', () => {
    expect(accessState(inDays(60), now)).toEqual({
      daysLeft: 60,
      isExpired: false,
      isExpiringSoon: false,
    });
  });
  it('warns in the last 14 days, counting a part day as a day', () => {
    expect(EXPIRY_WARNING_DAYS).toBe(14);
    expect(accessState(inDays(14), now)).toMatchObject({ daysLeft: 14, isExpiringSoon: true });
    expect(accessState(inDays(0.2), now)).toMatchObject({ daysLeft: 1, isExpiringSoon: true });
    expect(accessState(inDays(14.5), now).isExpiringSoon).toBe(false);
  });
  it('is expired at and after the end', () => {
    expect(accessState(now, now)).toEqual({ daysLeft: 0, isExpired: true, isExpiringSoon: false });
    expect(accessState(inDays(-3), now).isExpired).toBe(true);
  });
});

describe('receiptNumber', () => {
  it('uses the Dhaka date and the payment ID', () => {
    expect(
      receiptNumber('0a1b2c3d-4e5f-6789-abcd-ef0123456789', new Date('2026-11-17T19:30:00Z')),
    ).toBe('CS-261118-0A1B2C3D');
  });
});

describe('renewal', () => {
  it('is allowed only in the last 14 days of access', () => {
    expect(canRenew(inDays(30), now)).toBe(false);
    expect(canRenew(inDays(10), now)).toBe(true);
    expect(canRenew(inDays(-1), now)).toBe(false);
  });
  it('extends from the current end date, clamping to the end of short months', () => {
    expect(extendEnd(new Date('2027-03-18T06:00:00Z'), 6).toISOString()).toBe(
      '2027-09-18T06:00:00.000Z',
    );
    expect(extendEnd(new Date('2027-01-31T06:00:00Z'), 1).toISOString()).toBe(
      '2027-02-28T06:00:00.000Z',
    );
    expect(extendEnd(new Date('2028-01-31T06:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T06:00:00.000Z',
    );
    expect(extendEnd(new Date('2026-11-30T06:00:00Z'), 12).toISOString()).toBe(
      '2027-11-30T06:00:00.000Z',
    );
  });
});
