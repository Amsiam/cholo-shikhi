// BR3.5: "only a hash of its token is stored". Better Auth stores the session token as given, so this
// wrapper hashes the `token` field of the session model on every write and lookup. Stored values carry
// an `h1:` prefix so an already-hashed value (e.g. from a findMany) is never hashed twice. Lookups
// return the caller's raw token, so cookie refreshes keep working.
import type { BetterAuthOptions } from 'better-auth';
import { sha256Hex } from '#src/server/crypto.server.ts';

const PREFIX = 'h1:';
const SESSION_MODELS = new Set(['session', 'auth_session']);

export function hashSessionToken(token: string): string {
  return token.startsWith(PREFIX) ? token : `${PREFIX}${sha256Hex(token)}`;
}

type Where = { field: string; value: unknown; operator?: string; connector?: string };
type AdapterCall = {
  model: string;
  where?: Where[];
  data?: Record<string, unknown>;
  update?: Record<string, unknown>;
};
// biome-ignore lint/suspicious/noExplicitAny: Better Auth's adapter surface is generic over many models.
type AnyAdapter = Record<string, any>;

function hashValue(value: unknown): unknown {
  if (typeof value === 'string') return hashSessionToken(value);
  if (Array.isArray(value)) return value.map(hashValue);
  return value;
}

function rawTokenFrom(where: Where[] | undefined): string | undefined {
  const match = where?.find(
    (w) =>
      w.field === 'token' && typeof w.value === 'string' && (!w.operator || w.operator === 'eq'),
  );
  const value = match?.value as string | undefined;
  return value && !value.startsWith(PREFIX) ? value : undefined;
}

function transformCall(call: AdapterCall): AdapterCall {
  if (!SESSION_MODELS.has(call.model)) return call;
  return {
    ...call,
    ...(call.where
      ? {
          where: call.where.map((w) =>
            w.field === 'token' ? { ...w, value: hashValue(w.value) } : w,
          ),
        }
      : {}),
    ...(call.data && typeof call.data.token === 'string'
      ? { data: { ...call.data, token: hashSessionToken(call.data.token) } }
      : {}),
    ...(call.update && typeof call.update.token === 'string'
      ? { update: { ...call.update, token: hashSessionToken(call.update.token) } }
      : {}),
  };
}

function restoreToken<T>(result: T, raw: string | undefined): T {
  if (!raw || result === null || typeof result !== 'object') return result;
  return { ...(result as object), token: raw } as T;
}

function wrap(adapter: AnyAdapter): AnyAdapter {
  const wrapped: AnyAdapter = { ...adapter };
  for (const method of ['findOne', 'update', 'consumeOne', 'incrementOne']) {
    if (typeof adapter[method] !== 'function') continue;
    wrapped[method] = async (call: AdapterCall) => {
      const raw = SESSION_MODELS.has(call.model) ? rawTokenFrom(call.where) : undefined;
      return restoreToken(await adapter[method](transformCall(call)), raw);
    };
  }
  for (const method of ['findMany', 'count', 'updateMany', 'delete', 'deleteMany']) {
    if (typeof adapter[method] !== 'function') continue;
    wrapped[method] = (call: AdapterCall) => adapter[method](transformCall(call));
  }
  wrapped.create = async (call: AdapterCall) => {
    const raw =
      SESSION_MODELS.has(call.model) && typeof call.data?.token === 'string'
        ? call.data.token
        : undefined;
    return restoreToken(await adapter.create(transformCall(call)), raw);
  };
  if (typeof adapter.transaction === 'function') {
    wrapped.transaction = (callback: (trx: AnyAdapter) => Promise<unknown>) =>
      adapter.transaction((trx: AnyAdapter) => callback(wrap(trx)));
  }
  return wrapped;
}

/** Wraps a Better Auth database adapter factory (e.g. drizzleAdapter(...)). */
export function withHashedSessionTokens<F extends (options: BetterAuthOptions) => unknown>(
  factory: F,
): F {
  return ((options: BetterAuthOptions) => wrap(factory(options) as AnyAdapter)) as F;
}
