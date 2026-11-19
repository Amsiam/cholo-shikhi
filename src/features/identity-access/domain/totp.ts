// RFC 6238 TOTP (6 digits, 30-second steps, HMAC-SHA1) and RFC 4648 base32 — BR5.4.
// Written in-house against the RFC test vectors instead of adding a dependency.
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function timeStep(isoNow: string): number {
  return Math.floor(new Date(isoNow).getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP value for a raw key and counter (RFC 4226), truncated to `digits`. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 0xf;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The current 6-digit code for a base32 secret. */
export function totpCode(secretBase32: string, isoNow: string): string {
  return hotp(base32Decode(secretBase32), timeStep(isoNow));
}

/**
 * Verifies a code for the current step or one step either side (BR5.4). A step at or below
 * `lastAcceptedStep` is refused, so a code is never accepted twice (replay guard, item vi).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  isoNow: string,
  lastAcceptedStep: number | null,
): { isValid: true; step: number } | { isValid: false } {
  if (!/^\d{6}$/.test(code)) return { isValid: false };
  const key = base32Decode(secretBase32);
  const current = timeStep(isoNow);
  for (const step of [current - 1, current, current + 1]) {
    if (lastAcceptedStep !== null && step <= lastAcceptedStep) continue;
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return { isValid: true, step };
  }
  return { isValid: false };
}

/** Manual-entry setup key in groups of 4 characters (BR5.5). */
export function groupSetupKey(secretBase32: string): string[] {
  return secretBase32.match(/.{1,4}/g) ?? [];
}

export function otpauthUri(
  secretBase32: string,
  accountLabel: string,
  issuer = 'Cholo Shikhi',
): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
