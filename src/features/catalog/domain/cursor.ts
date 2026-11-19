// The signed, filter-bound S3 paging cursor (SD-205, NFR6.204, PD-203). Plain TypeScript: the HMAC
// function and the key bytes are injected, so this module reads no environment and imports no
// runtime crypto (team.md layer boundaries).
//
// Token: base64url(JSON { v: 1, kid, s: sortKeys, id: lastId }) + '.' + base64url(tag), where
// tag = HMAC-SHA256(key[kid], body + '\0' + filter). The filter (Goal and tab) is signed but not
// carried, so a cursor issued for one Goal or tab never verifies on another and cannot shift the
// query's filter. Two keys verify at once (current and previous) for rotation; a retired or unknown
// kid, a bad tag or a malformed token answers VALIDATION_FAILED errors.catalog.badCursor.
import { z } from 'zod';
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export type CursorKey = { kid: string; key: Uint8Array };
export type CursorKeys = { current: CursorKey; previous?: CursorKey };
export type Hmac = (key: Uint8Array, data: Uint8Array) => Uint8Array;

export type SortKey = string | number | null;
export type CursorPosition = { sortKeys: SortKey[]; lastId: string };

/** Longest token accepted; a real cursor is about 150 characters. */
export const CURSOR_MAX_LENGTH = 1024;

const Payload = z.object({
  v: z.literal(1),
  kid: z.string().min(1).max(32),
  s: z.array(z.union([z.string().max(64), z.number(), z.null()])).max(4),
  id: z.string().min(1).max(64),
});

export function badCursor(): AppError<'VALIDATION_FAILED'> {
  return {
    code: 'VALIDATION_FAILED',
    i18nKey: 'errors.catalog.badCursor',
    fieldErrors: { cursor: ['errors.catalog.badCursor'] },
  };
}

/** Equal length and equal bytes, examining every byte whatever the first difference. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    // atob rejects an impossible length; that is a malformed cursor, answered by the caller.
    return null;
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    // Not UTF-8 or not JSON: a malformed cursor. undefined fails the payload schema below.
    return undefined;
  }
}

export function createCursorCodec(deps: { keys: CursorKeys; hmac: Hmac }) {
  const byKid = new Map<string, Uint8Array>([[deps.keys.current.kid, deps.keys.current.key]]);
  if (deps.keys.previous) byKid.set(deps.keys.previous.kid, deps.keys.previous.key);

  const tagOf = (key: Uint8Array, body: string, filter: string) =>
    toBase64Url(deps.hmac(key, encoder.encode(`${body}\u0000${filter}`)));

  function encode(position: CursorPosition, filter: string): string {
    const { kid, key } = deps.keys.current;
    const body = toBase64Url(
      encoder.encode(JSON.stringify({ v: 1, kid, s: position.sortKeys, id: position.lastId })),
    );
    return `${body}.${tagOf(key, body, filter)}`;
  }

  function decode(
    token: string,
    filter: string,
  ): Result<CursorPosition, AppError<'VALIDATION_FAILED'>> {
    if (token.length === 0 || token.length > CURSOR_MAX_LENGTH) return err(badCursor());
    const parts = token.split('.');
    if (parts.length !== 2) return err(badCursor());
    const [body, tag] = parts as [string, string];
    const bodyBytes = fromBase64Url(body);
    if (!bodyBytes || !fromBase64Url(tag)) return err(badCursor());
    const parsed = Payload.safeParse(parseJson(bodyBytes));
    if (!parsed.success) return err(badCursor());
    const key = byKid.get(parsed.data.kid);
    if (!key) return err(badCursor());
    // Compare the canonical tag text, so even a change in base64url's unused low bits is refused.
    const expected = encoder.encode(tagOf(key, body, filter));
    if (!constantTimeEqual(expected, encoder.encode(tag))) return err(badCursor());
    return ok({ sortKeys: parsed.data.s, lastId: parsed.data.id });
  }

  return { encode, decode };
}

export type CursorCodec = ReturnType<typeof createCursorCodec>;
