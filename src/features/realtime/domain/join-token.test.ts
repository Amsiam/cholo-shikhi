import { describe, expect, it } from 'vitest';
import { signJoinToken, verifyJoinToken } from './join-token.ts';

const claims = {
  roomKey: 'live:00000000-0000-4000-8000-000000000001',
  userId: 'u1',
  expiresAt: 2_000,
};

describe('join tokens (BR16.1)', () => {
  it('round-trips valid claims', () => {
    expect(verifyJoinToken('s', signJoinToken('s', claims), 1_000)).toEqual(claims);
  });
  it('refuses expired, tampered, wrong-secret and malformed tokens', () => {
    const token = signJoinToken('s', claims);
    expect(verifyJoinToken('s', token, 2_000)).toBeNull();
    expect(verifyJoinToken('other', token, 1_000)).toBeNull();
    const [body, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ r: claims.roomKey, u: 'u2', e: 2_000 })).toString('base64url')}.${mac}`;
    expect(verifyJoinToken('s', forged, 1_000)).toBeNull();
    expect(verifyJoinToken('s', `${body}`, 1_000)).toBeNull();
    expect(verifyJoinToken('s', 'x.y', 1_000)).toBeNull();
  });
  it('refuses a correctly signed body with the wrong shape', () => {
    const body = Buffer.from(JSON.stringify({ r: 1 })).toString('base64url');
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const mac = createHmac('sha256', 's').update(body).digest('base64url');
    expect(verifyJoinToken('s', `${body}.${mac}`, 0)).toBeNull();
  });
});
