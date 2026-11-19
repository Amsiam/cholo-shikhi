// [TF] Step 31: the signed S3 paging cursor, written before the module (SD-205, NFR6.204, LC-213).
// The HMAC is injected (node:crypto in the test, as in the app), so the domain module stays
// framework-free. Fixed synthetic keys only, never a real secret. fast-check runs with a fixed seed;
// a failing seed is printed and kept as a regression case.
import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CursorKeys, constantTimeEqual, createCursorCodec } from './cursor.ts';

const SEED = 20261117;
const hmac = (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(createHmac('sha256', key).update(data).digest());
const key = (fill: number) => new Uint8Array(32).fill(fill);

const KEYS: CursorKeys = {
  current: { kid: 'k2', key: key(2) },
  previous: { kid: 'k1', key: key(1) },
};
const codec = createCursorCodec({ keys: KEYS, hmac });
const FILTER = 'goal-1|courses';
const POSITION = { sortKeys: [1, '2026-11-17T01:00:00.000Z'], lastId: 'course-9' };

const BAD = {
  ok: false,
  error: {
    code: 'VALIDATION_FAILED',
    i18nKey: 'errors.catalog.badCursor',
    fieldErrors: { cursor: ['errors.catalog.badCursor'] },
  },
};

describe('createCursorCodec (SD-205)', () => {
  it('round-trips a position under the current key', () => {
    const token = codec.encode(POSITION, FILTER);
    expect(codec.decode(token, FILTER)).toEqual({ ok: true, value: POSITION });
  });

  it('is opaque: the token is URL-safe base64 and does not carry the filter', () => {
    const token = codec.encode(POSITION, FILTER);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('goal-1');
  });

  it('keeps null sort keys (an unpinned course has no pin rank)', () => {
    const position = { sortKeys: [null, '2026-01-01T00:00:00.000Z'], lastId: 'x' };
    expect(codec.decode(codec.encode(position, FILTER), FILTER)).toEqual({
      ok: true,
      value: position,
    });
  });

  it('refuses a cursor issued for another Goal or tab (bound to the filter)', () => {
    const token = codec.encode(POSITION, FILTER);
    expect(codec.decode(token, 'goal-2|courses')).toEqual(BAD);
    expect(codec.decode(token, 'goal-1|free_trial')).toEqual(BAD);
  });

  it('accepts a cursor signed with the previous key during the rotation window', () => {
    const old = createCursorCodec({ keys: { current: { kid: 'k1', key: key(1) } }, hmac });
    expect(codec.decode(old.encode(POSITION, FILTER), FILTER)).toEqual({
      ok: true,
      value: POSITION,
    });
  });

  it('refuses a cursor signed with a retired key or an unknown kid', () => {
    const retired = createCursorCodec({ keys: { current: { kid: 'k0', key: key(9) } }, hmac });
    expect(codec.decode(retired.encode(POSITION, FILTER), FILTER)).toEqual(BAD);
    const swapped = createCursorCodec({ keys: { current: { kid: 'k2', key: key(7) } }, hmac });
    expect(codec.decode(swapped.encode(POSITION, FILTER), FILTER)).toEqual(BAD);
  });

  it.each([
    ['empty', ''],
    ['no dot', 'abc'],
    ['two dots', 'a.b.c'],
    ['bad base64', '!!!.???'],
    ['not JSON', `${btoa('nope').replace(/=+$/, '')}.AAAA`],
    ['too long', `${'A'.repeat(1100)}.AAAA`],
    ['impossible base64 length', 'AAAAA.AAAA'],
  ])('refuses a malformed cursor (%s)', (_name, token) => {
    expect(codec.decode(token, FILTER)).toEqual(BAD);
  });

  it('refuses a payload of the wrong shape or version even with a valid tag', () => {
    const forge = (payload: unknown) => {
      const body = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const data = new TextEncoder().encode(`${body}\u0000${FILTER}`);
      const tag = btoa(String.fromCharCode(...hmac(key(2), data)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      return `${body}.${tag}`;
    };
    expect(codec.decode(forge({ v: 1, kid: 'k2', s: [1], id: 'x' }), FILTER).ok).toBe(true);
    expect(codec.decode(forge({ v: 2, kid: 'k2', s: [1], id: 'x' }), FILTER)).toEqual(BAD);
    expect(codec.decode(forge({ v: 1, kid: 'k2', s: [{}], id: 'x' }), FILTER)).toEqual(BAD);
    expect(codec.decode(forge({ v: 1, kid: 'k2', s: [1] }), FILTER)).toEqual(BAD);
    expect(codec.decode(forge(['v', 1]), FILTER)).toEqual(BAD);
  });

  it('property: changing any single character of a token is refused', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.nat(),
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.'),
        (rank, lastId, at, replacement) => {
          const token = codec.encode({ sortKeys: [rank, 'iso'], lastId }, FILTER);
          const index = at % token.length;
          if (token[index] === replacement) return true;
          const tampered = token.slice(0, index) + replacement + token.slice(index + 1);
          const decoded = codec.decode(tampered, FILTER);
          // A base64url change in the last character can leave the decoded bytes equal; then the
          // token still means exactly the same position, which is not a tamper of the content.
          return decoded.ok
            ? JSON.stringify(decoded.value) === JSON.stringify({ sortKeys: [rank, 'iso'], lastId })
            : decoded.error.i18nKey === 'errors.catalog.badCursor';
        },
      ),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it('property: a token from any other key is refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 255 }), (fill) => {
        const other = createCursorCodec({ keys: { current: { kid: 'k2', key: key(fill) } }, hmac });
        return !codec.decode(other.encode(POSITION, FILTER), FILTER).ok;
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('constantTimeEqual', () => {
  it('is true only for equal bytes of equal length', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});
