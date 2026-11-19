// [LT] Builder negative tests: anonymous, wrong user and wrong role for every access kind (BR1.1–BR1.7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { appError } from '#src/lib/errors.ts';
import { err, ok } from '#src/lib/result.ts';
import { overrideServerFnRuntimeForTests, setServerFnCookie } from './fn.ts';
import { guard } from './fn-core.ts';

const request = new Request('http://localhost:3000/_serverFn/x', {
  method: 'POST',
  headers: { 'x-correlation-id': 'corr-fn-0001' },
});
const student: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  roles: ['student'],
  locale: 'bn',
  hasStepUp: false,
};
const adminNoStepUp: Actor = {
  userId: '55555555-5555-4555-8555-555555555555',
  roles: ['student', 'admin'],
  locale: 'en',
  hasStepUp: false,
};
const admin: Actor = { ...adminNoStepUp, hasStepUp: true };
const as = (actor: Actor) => async () => ok(actor);
const anonymous = async () => err(appError('UNAUTHENTICATED'));
const Schema = z.object({ name: z.string().min(2) });

describe('publicFn access', () => {
  it('runs without a session and passes a null actor', async () => {
    const handler = vi.fn(async ({ actor }: { actor: Actor | null }) => ok(actor));
    expect(
      await guard(
        { access: { kind: 'public' }, schema: Schema, handler },
        { request, rawInput: { name: 'ok' }, getActor: anonymous },
      ),
    ).toEqual({ ok: true, value: null });
  });
  it('still validates input', async () => {
    const r = await guard(
      { access: { kind: 'public' }, schema: Schema, handler: async () => ok(1) },
      { request, rawInput: { name: 'x' }, getActor: anonymous },
    );
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { name: ['errors.validation.too_small'] } },
    });
  });
});

describe('authedFn access', () => {
  it('refuses an anonymous caller before validating input or running the handler (BR1.5)', async () => {
    const handler = vi.fn(async () => ok(1));
    const r = await guard(
      { access: { kind: 'authed' }, schema: Schema, handler },
      { request, rawInput: { bad: true }, getActor: anonymous },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(handler).not.toHaveBeenCalled();
  });
  it('lets the handler refuse the wrong user with NOT_FOUND (BR1.4)', async () => {
    const r = await guard(
      {
        access: { kind: 'authed' },
        schema: z.object({ ownerId: z.string() }),
        handler: async ({ actor, input }) =>
          input.ownerId === actor.userId ? ok(1) : err(appError('NOT_FOUND')),
      },
      { request, rawInput: { ownerId: 'someone-else' }, getActor: as(student) },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('can require step-up explicitly', async () => {
    const r = await guard(
      {
        access: { kind: 'authed', requireStepUp: true },
        schema: Schema,
        handler: async () => ok(1),
      },
      { request, rawInput: { name: 'ok' }, getActor: as(student) },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'STEP_UP_REQUIRED' } });
  });
});

describe('roleFn access', () => {
  const spec = (handler = vi.fn(async () => ok('done'))) => ({
    access: { kind: 'role' as const, roles: ['admin' as const] },
    schema: Schema,
    handler,
  });
  it('refuses anonymous, wrong role and admin-without-two-step', async () => {
    expect(
      await guard(spec(), { request, rawInput: { name: 'ok' }, getActor: anonymous }),
    ).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(
      await guard(spec(), { request, rawInput: { name: 'ok' }, getActor: as(student) }),
    ).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(
      await guard(spec(), { request, rawInput: { name: 'ok' }, getActor: as(adminNoStepUp) }),
    ).toMatchObject({
      error: { code: 'STEP_UP_REQUIRED', i18nKey: 'errors.identity.STEP_UP_REQUIRED' },
    });
  });
  it('runs for an admin with two-step', async () => {
    expect(await guard(spec(), { request, rawInput: { name: 'ok' }, getActor: as(admin) })).toEqual(
      { ok: true, value: 'done' },
    );
  });
  it('accepts any of several roles; a student-inclusive role list needs no step-up', async () => {
    const r = await guard(
      {
        access: { kind: 'role', roles: ['student', 'instructor'] },
        schema: Schema,
        handler: async () => ok(1),
      },
      { request, rawInput: { name: 'ok' }, getActor: as(student) },
    );
    expect(r.ok).toBe(true);
  });
});

describe('flags and error mapping', () => {
  it('answers FEATURE_DISABLED when the flag is off, and when no flag check is wired (deny by default)', async () => {
    const handler = vi.fn(async () => ok(1));
    const base = {
      access: { kind: 'authed' as const },
      schema: Schema,
      handler,
      flag: 'appshell.installPrompt',
    };
    expect(
      await guard(base, {
        request,
        rawInput: { name: 'ok' },
        getActor: as(student),
        isFlagEnabled: async () => false,
      }),
    ).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
    expect(
      await guard(base, { request, rawInput: { name: 'ok' }, getActor: as(student) }),
    ).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
    expect(
      await guard(base, {
        request,
        rawInput: { name: 'ok' },
        getActor: as(student),
        isFlagEnabled: async () => true,
      }),
    ).toEqual({ ok: true, value: 1 });
    expect(handler).toHaveBeenCalledOnce();
  });
  it('maps a thrown error to a generic INTERNAL_ERROR with the correlation ID and no message', async () => {
    const r = await guard(
      {
        access: { kind: 'public' },
        schema: Schema,
        handler: async () => {
          throw new Error('relation "user" does not exist SELECT *');
        },
      },
      { request, rawInput: { name: 'ok' }, getActor: anonymous },
    );
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        i18nKey: 'errors.common.INTERNAL_ERROR',
        correlationId: 'corr-fn-0001',
      },
    });
  });
  it('strips details from domain errors before they reach the client', async () => {
    const r = await guard(
      {
        access: { kind: 'public' },
        schema: Schema,
        handler: async () => err(appError('CONFLICT', { details: { internalId: 'x' } })),
      },
      { request, rawInput: { name: 'ok' }, getActor: anonymous },
    );
    expect(r).toEqual({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.common.CONFLICT' },
    });
  });
});

// Step 27 — security-design: no test seams in production. The runtime override must refuse to run
// under NODE_ENV=production and leave whatever runtime is installed untouched.
describe('overrideServerFnRuntimeForTests production guard', () => {
  const cookie = { path: '/', sameSite: 'lax', secure: true, httpOnly: true, maxAge: 60 } as const;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Given NODE_ENV=production, When a test override is attempted, Then it throws and the installed runtime is unchanged', () => {
    const installed = vi.fn();
    const attempted = vi.fn();
    vi.stubEnv('NODE_ENV', 'test');
    const restore = overrideServerFnRuntimeForTests({ setCookie: installed });
    try {
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => overrideServerFnRuntimeForTests({ setCookie: attempted })).toThrow(/production/);
      setServerFnCookie('cs_probe', 'v', cookie);
      expect(installed).toHaveBeenCalledTimes(1);
      expect(attempted).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('NODE_ENV', 'test');
      restore();
    }
  });

  it('Given an unrecognised NODE_ENV, When a test override is attempted, Then it refuses (fail closed)', () => {
    const attempted = vi.fn();
    vi.stubEnv('NODE_ENV', 'staging');
    expect(() => overrideServerFnRuntimeForTests({ setCookie: attempted })).toThrow();
    vi.stubEnv('NODE_ENV', 'test');
    expect(attempted).not.toHaveBeenCalled();
  });

  it('Given NODE_ENV=test, When a test override is installed, Then the server-function runtime uses it until restored', () => {
    const setCookie = vi.fn();
    vi.stubEnv('NODE_ENV', 'test');
    const restore = overrideServerFnRuntimeForTests({ setCookie });
    try {
      setServerFnCookie('cs_probe', 'v', cookie);
      expect(setCookie).toHaveBeenCalledWith('cs_probe', 'v', cookie);
    } finally {
      restore();
    }
  });

  it('Given NODE_ENV=development, When a test override is installed, Then it is allowed (the guard is production-only)', () => {
    const setCookie = vi.fn();
    vi.stubEnv('NODE_ENV', 'development');
    const restore = overrideServerFnRuntimeForTests({ setCookie });
    try {
      setServerFnCookie('cs_probe', 'v', cookie);
      expect(setCookie).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
