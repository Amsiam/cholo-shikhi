import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  keyedHash,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from './crypto.server.ts';

const KEY = Buffer.alloc(32, 9).toString('base64');

describe('crypto helpers', () => {
  it('sha256Hex matches the FIPS 180-2 "abc" vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('keyedHash depends on the key and compares in constant time', () => {
    const a = keyedHash('k1', 'v');
    expect(a).not.toBe(keyedHash('k2', 'v'));
    expect(safeEqualHex(a, keyedHash('k1', 'v'))).toBe(true);
    expect(safeEqualHex(a, 'ab')).toBe(false);
  });
  it('encrypts with a fresh IV each time and decrypts back', () => {
    const one = encryptSecret(KEY, 'JBSWY3DPEHPK3PXP');
    expect(one).not.toBe(encryptSecret(KEY, 'JBSWY3DPEHPK3PXP'));
    expect(decryptSecret(KEY, one)).toBe('JBSWY3DPEHPK3PXP');
    expect(one).not.toContain('JBSWY3DPEHPK3PXP');
  });
  it('refuses tampered ciphertext and unknown formats', () => {
    const sealed = encryptSecret(KEY, 'secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => decryptSecret(KEY, parts.join('.'))).toThrow();
    expect(() => decryptSecret(KEY, 'v2.a.b.c')).toThrow(/unsupported/);
  });
  it('produces URL-safe random tokens', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
