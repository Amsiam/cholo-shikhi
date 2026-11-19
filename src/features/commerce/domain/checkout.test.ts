// [UT] Abandoned checkouts: the cutoff before which a pending payment has expired.
import { describe, expect, it } from 'vitest';
import { pendingExpiryCutoff } from './checkout.ts';

describe('pendingExpiryCutoff', () => {
  const now = new Date('2027-01-10T12:00:00.000Z');
  it('is the expiry before now', () => {
    expect(pendingExpiryCutoff(now, 60).toISOString()).toBe('2027-01-10T11:00:00.000Z');
    expect(pendingExpiryCutoff(now, 1440).toISOString()).toBe('2027-01-09T12:00:00.000Z');
  });
  it('uses whole minutes and never less than one', () => {
    expect(pendingExpiryCutoff(now, 15.9).toISOString()).toBe('2027-01-10T11:45:00.000Z');
    expect(pendingExpiryCutoff(now, 0).toISOString()).toBe('2027-01-10T11:59:00.000Z');
    expect(pendingExpiryCutoff(now, -5).toISOString()).toBe('2027-01-10T11:59:00.000Z');
  });
});
