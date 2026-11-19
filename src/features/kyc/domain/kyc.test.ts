// [LT] KYC and payout-account input rules (US7.19, US7.20) and the payout eligibility status.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  maskNumber,
  normaliseBankAccount,
  normaliseNid,
  normaliseRouting,
  normaliseWallet,
  sniffImage,
  verificationStatus,
} from './kyc.ts';

describe('numbers', () => {
  it('accepts 10, 13 and 17 digit NID numbers, with Bangla digits and spaces', () => {
    expect(normaliseNid('১২৩ ৪৫৬ ৭৮৯০')).toBe('1234567890');
    expect(normaliseNid('1234567890123')).toBe('1234567890123');
    expect(normaliseNid('12345678901234567')).toBe('12345678901234567');
    expect(normaliseNid('12345')).toBeNull();
    expect(normaliseNid('12345678901')).toBeNull();
  });
  it('AC7.20.2: wallets are Bangladesh mobile numbers; malformed ones are refused', () => {
    expect(normaliseWallet('01712-345678')).toBe('01712345678');
    expect(normaliseWallet('+8801712345678')).toBe('01712345678');
    expect(normaliseWallet('8801912345678')).toBe('01912345678');
    expect(normaliseWallet('01212345678')).toBeNull();
    expect(normaliseWallet('0171234567')).toBeNull();
  });
  it('bank accounts are 8–20 digits and routing numbers 9', () => {
    expect(normaliseBankAccount('1234 5678 9012')).toBe('123456789012');
    expect(normaliseBankAccount('1234567')).toBeNull();
    expect(normaliseRouting('090 261 726')).toBe('090261726');
    expect(normaliseRouting('12345678')).toBeNull();
  });
  it('masks to the last 3 digits only', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{8,20}$/), (n) => {
        const masked = maskNumber(n);
        expect(masked.endsWith(n.slice(-3))).toBe(true);
        expect(masked.replace(/\D/g, '')).toHaveLength(3);
      }),
    );
  });
});

describe('sniffImage (AC7.19.2)', () => {
  const pad = (head: number[], size = 4096) => {
    const b = new Uint8Array(size);
    b.set(head);
    return b;
  };
  it('accepts JPEG, PNG and WebP by their first bytes', () => {
    expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ok: true, kind: 'jpeg' });
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))).toEqual({ ok: true, kind: 'png' });
    const webp = pad([...'RIFF'].map((c) => c.charCodeAt(0)));
    webp.set(
      [...'WEBP'].map((c) => c.charCodeAt(0)),
      8,
    );
    expect(sniffImage(webp)).toEqual({ ok: true, kind: 'webp' });
  });
  it('refuses anything else, and files too small or too large', () => {
    expect(sniffImage(pad([0x25, 0x50, 0x44, 0x46]))).toEqual({ ok: false, reason: 'unsupported' });
    expect(sniffImage(new Uint8Array(100))).toEqual({ ok: false, reason: 'too_small' });
    expect(sniffImage(pad([0xff, 0xd8, 0xff], 3 * 1024 * 1024))).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });
});

describe('verificationStatus', () => {
  it('is verified only with verified KYC and a verified account', () => {
    expect(verificationStatus(null, null)).toBe('none');
    expect(verificationStatus('submitted', null)).toBe('pending');
    expect(verificationStatus('rejected', 'verified')).toBe('rejected');
    expect(verificationStatus('verified', null)).toBe('pending');
    expect(verificationStatus('verified', 'pending')).toBe('reverification_required');
    expect(verificationStatus('verified', 'rejected')).toBe('rejected');
    expect(verificationStatus('verified', 'verified')).toBe('verified');
  });
});
