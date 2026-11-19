// Server-side crypto helpers: hashes, keyed hashes (item iii), AES-256-GCM for secrets at rest (BR5.8).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed hash used for identifiers in rate-limit keys and for recovery codes; never reversible. */
export function keyedHash(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url parts. */
export function encryptSecret(base64Key: string, plaintext: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(base64Key: string, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('unsupported secret format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(base64Key, 'base64'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
