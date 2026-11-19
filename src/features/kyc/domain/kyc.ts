// KYC and payout-account rules (US7.19–US7.21). Plain TypeScript: no framework, DB or env access.

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla digits to ASCII, and spaces and dashes removed (BR9.2-style input normalisation). */
export function digitsOnly(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d))).replace(/[\s-]/g, '');
}

/** A Bangladesh NID number: 10 digits (smart card), 13 or 17 digits (older cards). */
export function normaliseNid(input: string): string | null {
  const n = digitsOnly(input);
  return /^(\d{10}|\d{13}|\d{17})$/.test(n) ? n : null;
}

/** A bKash or Nagad wallet: a Bangladesh mobile number, 01[3-9] and 8 more digits. */
export function normaliseWallet(input: string): string | null {
  let n = digitsOnly(input);
  if (n.startsWith('+880')) n = `0${n.slice(4)}`;
  else if (n.startsWith('880')) n = `0${n.slice(3)}`;
  return /^01[3-9]\d{8}$/.test(n) ? n : null;
}

/** A bank account number: 8 to 20 digits. */
export function normaliseBankAccount(input: string): string | null {
  const n = digitsOnly(input);
  return /^\d{8,20}$/.test(n) ? n : null;
}

/** A Bangladesh bank routing number: 9 digits. */
export function normaliseRouting(input: string): string | null {
  const n = digitsOnly(input);
  return /^\d{9}$/.test(n) ? n : null;
}

/** Shows only the last 3 digits ("•••• 123"); the full number stays encrypted. */
export function maskNumber(n: string): string {
  return `•••• ${n.slice(-3)}`;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MIN_IMAGE_BYTES = 2 * 1024;

export type ImageKind = 'jpeg' | 'png' | 'webp';

/**
 * An NID photo is accepted only if its first bytes say JPEG, PNG or WebP and its size is sensible
 * (AC7.19.2). The server never decodes it; the bytes are only stored.
 */
export function sniffImage(
  bytes: Uint8Array,
):
  | { ok: true; kind: ImageKind }
  | { ok: false; reason: 'too_small' | 'too_large' | 'unsupported' } {
  if (bytes.length < MIN_IMAGE_BYTES) return { ok: false, reason: 'too_small' };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { ok: true, kind: 'jpeg' };
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47)
    return { ok: true, kind: 'png' };
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ok: true, kind: 'webp' };
  return { ok: false, reason: 'unsupported' };
}

export const CONTENT_TYPE: Record<ImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type KycStatus = 'submitted' | 'verified' | 'rejected';
export type AccountStatus = 'pending' | 'verified' | 'rejected';

/**
 * Contract 17 getVerificationStatus: whether this person can be paid, and if not, why. A changed or
 * newly added account waits for Finance (reverification_required once KYC was already verified).
 */
export function verificationStatus(
  kyc: KycStatus | null,
  account: AccountStatus | null,
): 'none' | 'pending' | 'verified' | 'rejected' | 'reverification_required' {
  if (kyc === null) return 'none';
  if (kyc === 'rejected') return 'rejected';
  if (kyc === 'submitted') return 'pending';
  if (account === null) return 'pending';
  if (account === 'verified') return 'verified';
  if (account === 'rejected') return 'rejected';
  return 'reverification_required';
}
