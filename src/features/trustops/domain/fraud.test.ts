// [UT] US4.9 / US8.11 review queue rules (manual flags; no detector).
import { describe, expect, it } from 'vitest';
import { isFraudReason, isVaultItemHeld, nextFraudState, userRefOf } from './fraud.ts';

describe('fraud flags', () => {
  it('an open flag is cleared or banned once; a cleared flag is final', () => {
    expect(nextFraudState('open', 'clear')).toBe('cleared');
    expect(nextFraudState('open', 'ban')).toBe('banned');
    expect(nextFraudState('cleared', 'ban')).toBeNull();
    expect(nextFraudState('banned', 'clear')).toBeNull();
  });
  it('a ban is reversible once; only a banned flag can be reinstated', () => {
    expect(nextFraudState('banned', 'reinstate')).toBe('reinstated');
    expect(nextFraudState('open', 'reinstate')).toBeNull();
    expect(nextFraudState('cleared', 'reinstate')).toBeNull();
    expect(nextFraudState('reinstated', 'reinstate')).toBeNull();
    expect(nextFraudState('reinstated', 'ban')).toBeNull();
  });
  it('needs a reason of at least 10 characters', () => {
    expect(isFraudReason('Same option on every answer.')).toBe(true);
    expect(isFraudReason('  too short ')).toBe(false);
    expect(isFraudReason(undefined)).toBe(false);
  });
  it('holds Vault items wrong at or before the flag, not later ones, and nothing without a flag', () => {
    const flag = new Date('2027-02-03T10:00:00.000Z');
    expect(isVaultItemHeld(new Date('2027-02-03T09:00:00.000Z'), flag)).toBe(true);
    expect(isVaultItemHeld(flag, flag)).toBe(true);
    expect(isVaultItemHeld(new Date('2027-02-03T10:00:00.001Z'), flag)).toBe(false);
    expect(isVaultItemHeld(new Date('2027-02-01T00:00:00.000Z'), null)).toBe(false);
  });
  it('reads an email or an account ID', () => {
    expect(userRefOf(' Rumi@Example.test ')).toEqual({ email: 'rumi@example.test' });
    expect(userRefOf('0B0E7A4C-1D2E-4F3A-9B8C-7D6E5F4A3B2C')).toEqual({
      userId: '0b0e7a4c-1d2e-4f3a-9b8c-7d6e5f4a3b2c',
    });
    expect(userRefOf('not a user')).toBeNull();
  });
});
