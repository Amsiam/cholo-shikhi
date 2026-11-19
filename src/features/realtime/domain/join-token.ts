// Join tokens (BR16.1): HMAC-SHA256 over {room, user, expiry}. Short-lived; bound to one user and room.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type JoinClaims = { roomKey: string; userId: string; expiresAt: number };

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

export function signJoinToken(secret: string, claims: JoinClaims): string {
  const body = encode(JSON.stringify({ r: claims.roomKey, u: claims.userId, e: claims.expiresAt }));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyJoinToken(secret: string, token: string, nowMs: number): JoinClaims | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      r?: unknown;
      u?: unknown;
      e?: unknown;
    };
    if (
      typeof parsed.r !== 'string' ||
      typeof parsed.u !== 'string' ||
      typeof parsed.e !== 'number'
    )
      return null;
    if (parsed.e <= nowMs) return null;
    return { roomKey: parsed.r, userId: parsed.u, expiresAt: parsed.e };
  } catch {
    return null;
  }
}
