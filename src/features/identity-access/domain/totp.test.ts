// RFC 6238 Appendix B test vectors (SHA-1 seed "12345678901234567890"): expected values come from
// the RFC, not from this implementation. The RFC gives 8 digits; the 6-digit code is the last 6.
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  groupSetupKey,
  hotp,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp.ts';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET = base32Encode(RFC_KEY);

describe('RFC 6238 vectors', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i gives %s', (seconds, expected8) => {
    expect(hotp(RFC_KEY, Math.floor(seconds / 30), 8)).toBe(expected8);
    expect(totpCode(RFC_SECRET, new Date(seconds * 1000).toISOString())).toBe(expected8.slice(2));
  });
});

describe('base32 (RFC 4648)', () => {
  it('encodes the RFC 4648 examples', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
  });
  it('round-trips and ignores spaces, dashes and case', () => {
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
  });
  it('rejects invalid characters', () => {
    expect(() => base32Decode('M1')).toThrow();
  });
});

describe('verifyTotp (BR5.4)', () => {
  const now = new Date(1111111111 * 1000).toISOString();
  it('accepts the current code and reports its step', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now, null)).toEqual({
      isValid: true,
      step: 37037037,
    });
  });
  it('accepts one step either side but not two', () => {
    const previous = new Date((1111111111 - 30) * 1000).toISOString();
    const twoBack = new Date((1111111111 - 60) * 1000).toISOString();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, previous), now, null).isValid).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, twoBack), now, null).isValid).toBe(false);
  });
  it('refuses a replay of an already accepted step (item vi)', () => {
    const code = totpCode(RFC_SECRET, now);
    const first = verifyTotp(RFC_SECRET, code, now, null);
    expect(first.isValid).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now, first.isValid ? first.step : 0).isValid).toBe(false);
  });
  it('refuses malformed codes', () => {
    for (const bad of ['12345', '1234567', 'abcdef', ''])
      expect(verifyTotp(RFC_SECRET, bad, now, null).isValid).toBe(false);
  });
});

describe('enrolment helpers (BR5.5)', () => {
  it('groups the setup key in fours', () => {
    expect(groupSetupKey('ABCDEFGHIJ')).toEqual(['ABCD', 'EFGH', 'IJ']);
  });
  it('builds an otpauth URI with issuer and 30 s period', () => {
    expect(otpauthUri('ABCD', 'learner')).toBe(
      'otpauth://totp/Cholo%20Shikhi%3Alearner?secret=ABCD&issuer=Cholo%20Shikhi&algorithm=SHA1&digits=6&period=30',
    );
  });
});
