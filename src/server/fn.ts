// The only way to build a server function (BR1.1). Usage:
//   export const enrolInCourse = createServerFn({ method: 'POST' })
//     .handler(authedFn(EnrolSchema, async ({ actor, input }) => ...));
// Validation runs inside the builder, after the session and role checks (fixed order, BR1.7).
import { getRequest, setCookie } from '@tanstack/react-start/server';
import type { z } from 'zod';
import type { Actor, Role } from '#src/features/identity-access/domain/actor.schema.ts';
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';
import { getFlags } from '#src/features/platform/server/flags-instance.server.ts';
import { isProductionRuntime } from '#src/lib/env.ts';
import type { AppError } from '#src/lib/errors.ts';
import type { Result } from '#src/lib/result.ts';
import { ensureComposition } from './composition.server.ts';
import {
  type Access,
  type GuardSpec,
  guard,
  type HandlerContext,
  type ServerFnResult,
} from './fn-core.ts';

type Handler<S extends z.ZodType, T, A> = (
  ctx: HandlerContext<z.output<S>, A>,
) => Promise<Result<T, AppError>>;
type Options = { flag?: string; requireStepUp?: boolean };

export type CookieOptions = {
  path: string;
  sameSite: 'lax' | 'strict';
  secure: boolean;
  httpOnly: boolean;
  maxAge: number;
};

/**
 * What a server function needs from the outside world. In the app every part comes from TanStack
 * Start and the IdentityAccess/Platform singletons; tests replace only what the Start runtime would
 * supply (the request and cookie writes) and call the real builders and handlers.
 */
export type ServerFnRuntime = {
  getRequest(): Request;
  getActor(request: Request): Promise<Result<Actor, AppError>>;
  isFlagEnabled(flagKey: string, ctx: { userId?: string }): Promise<boolean>;
  setCookie(name: string, value: string, options: CookieOptions): void;
};

const defaultRuntime: ServerFnRuntime = {
  getRequest: () => getRequest(),
  getActor: (request) => getIdentity().getActor(request),
  isFlagEnabled: (flagKey, ctx) => getFlags().isEnabled(flagKey, ctx),
  setCookie: (name, value, options) => setCookie(name, value, options),
};

let runtime: ServerFnRuntime = defaultRuntime;

/**
 * Test hook: overrides parts of the runtime and returns a function that restores the default.
 * Refuses under NODE_ENV=production (security-design: no test seams in production), before any
 * change, so the installed runtime stays as it was.
 */
export function overrideServerFnRuntimeForTests(override: Partial<ServerFnRuntime>): () => void {
  if (isProductionRuntime()) {
    throw new Error(
      'overrideServerFnRuntimeForTests is a test-only seam and refuses in production',
    );
  }
  runtime = { ...defaultRuntime, ...override };
  return () => {
    runtime = defaultRuntime;
  };
}

/** Sets a response cookie through the current runtime (Start in the app). */
export function setServerFnCookie(name: string, value: string, options: CookieOptions): void {
  runtime.setCookie(name, value, options);
}

/** The declared access of a server function: 'public', 'authed', or 'role:<role>[|<role>]'. */
export type DeclaredAccess = 'public' | 'authed' | `role:${string}`;

function describeAccess(access: Access): DeclaredAccess {
  if (access.kind === 'public') return 'public';
  if (access.kind === 'authed') return 'authed';
  return `role:${[...access.roles].sort().join('|')}`;
}

function run<S extends z.ZodType, T, A>(spec: GuardSpec<S, T, A>) {
  const invoke = async ({ data }: { data?: unknown }): Promise<ServerFnResult<T>> => {
    ensureComposition();
    return guard(spec as GuardSpec<S, T, Actor>, {
      request: runtime.getRequest(),
      rawInput: data,
      getActor: (request) => runtime.getActor(request),
      isFlagEnabled: (flagKey, ctx) => runtime.isFlagEnabled(flagKey, ctx),
    });
  };
  // createServerFn().handler(fn) copies these own properties onto the exported server function, so
  // tests can check every function's declared access and call its real builder and handler.
  return Object.assign(invoke, { serverFnAccess: describeAccess(spec.access), invoke });
}

/** Explicitly public: no session needed (BR1.1 makes "public" a visible choice). */
export function publicFn<S extends z.ZodType, T>(
  schema: S,
  handler: Handler<S, T, Actor | null>,
  options: Options = {},
) {
  return run({
    access: { kind: 'public' },
    schema,
    handler,
    ...(options.flag ? { flag: options.flag } : {}),
  });
}

/** Any signed-in user with an active session. */
export function authedFn<S extends z.ZodType, T>(
  schema: S,
  handler: Handler<S, T, Actor>,
  options: Options = {},
) {
  return run({
    access: {
      kind: 'authed',
      ...(options.requireStepUp !== undefined ? { requireStepUp: options.requireStepUp } : {}),
    },
    schema,
    handler,
    ...(options.flag ? { flag: options.flag } : {}),
  });
}

/** Holders of at least one of the roles. Staff-only functions require two-step by default (BR1.6). */
export function roleFn<S extends z.ZodType, T>(
  role: Role | readonly Role[],
  schema: S,
  handler: Handler<S, T, Actor>,
  options: Options = {},
) {
  const roles = typeof role === 'string' ? [role] : role;
  return run({
    access: {
      kind: 'role',
      roles,
      ...(options.requireStepUp !== undefined ? { requireStepUp: options.requireStepUp } : {}),
    },
    schema,
    handler,
    ...(options.flag ? { flag: options.flag } : {}),
  });
}

/**
 * Types a server function's `data` from its shared schema without validating it at the transport:
 * validation runs inside the builder, after the session and role checks (BR1.7's fixed order).
 */
export function typedInput<S extends z.ZodType>(): (input: z.input<S>) => z.input<S> {
  return (input) => input;
}
