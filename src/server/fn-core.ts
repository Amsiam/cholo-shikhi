// The server-function pipeline behind publicFn / authedFn / roleFn (BR1.1–BR1.7, contract 1):
// session -> role -> step-up -> feature flag -> Zod input -> handler -> error mapping. Deny by default.
// Framework-free so it is unit-testable; src/server/fn.ts binds it to TanStack Start.
import type { z } from 'zod';
import type { Actor, Role } from '#src/features/identity-access/domain/actor.schema.ts';
import { correlationIdFrom, currentCorrelationId } from '#src/lib/correlation.ts';
import {
  type AppError,
  appError,
  type ClientError,
  fromZodError,
  toClientError,
  unexpectedError,
} from '#src/lib/errors.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Result } from '#src/lib/result.ts';

export type Access =
  | { kind: 'public' }
  | { kind: 'authed'; requireStepUp?: boolean }
  | { kind: 'role'; roles: readonly Role[]; requireStepUp?: boolean };

export type ServerFnResult<T> = { ok: true; value: T } | { ok: false; error: ClientError };

export type HandlerContext<I, A> = { input: I; actor: A; correlationId: string; request: Request };

export type GuardSpec<S extends z.ZodType, T, A> = {
  access: Access;
  schema: S;
  /** Optional feature flag; an off flag answers FEATURE_DISABLED (BR8.4). */
  flag?: string;
  handler: (ctx: HandlerContext<z.output<S>, A>) => Promise<Result<T, AppError>>;
};

export type GuardDeps = {
  request: Request;
  rawInput: unknown;
  getActor: (request: Request) => Promise<Result<Actor, AppError>>;
  isFlagEnabled?: (flagKey: string, ctx: { userId?: string }) => Promise<boolean>;
};

const STAFF_ROLES: ReadonlySet<Role> = new Set(['instructor', 'admin', 'finance']);

function refuse<T>(error: AppError): ServerFnResult<T> {
  return { ok: false, error: toClientError(error) };
}

async function authorise(access: Access, deps: GuardDeps): Promise<Result<Actor | null, AppError>> {
  if (access.kind === 'public') return { ok: true, value: null };
  const actor = await deps.getActor(deps.request);
  if (!actor.ok) return { ok: false, error: appError('UNAUTHENTICATED') };
  const needsRole = access.kind === 'role' ? access.roles : [];
  if (needsRole.length > 0 && !needsRole.some((role) => actor.value.roles.includes(role))) {
    return { ok: false, error: appError('FORBIDDEN') };
  }
  // BR1.6: every staff function needs a session whose two-step check passed, unless opted out.
  const isStaffOnly = needsRole.length > 0 && needsRole.every((role) => STAFF_ROLES.has(role));
  const needsStepUp = access.requireStepUp ?? isStaffOnly;
  if (needsStepUp && !actor.value.hasStepUp) {
    return { ok: false, error: appError('STEP_UP_REQUIRED', { namespace: 'identity' }) };
  }
  return actor;
}

export async function guard<S extends z.ZodType, T, A extends Actor | null = Actor>(
  spec: GuardSpec<S, T, A>,
  deps: GuardDeps,
): Promise<ServerFnResult<T>> {
  const correlationId =
    currentCorrelationId() ?? correlationIdFrom(deps.request.headers.get('x-correlation-id'));
  try {
    const actor = await authorise(spec.access, deps);
    if (!actor.ok) return refuse(actor.error);
    if (
      spec.flag &&
      !(await (deps.isFlagEnabled?.(spec.flag, actor.value ? { userId: actor.value.userId } : {}) ??
        false))
    ) {
      return refuse(appError('FEATURE_DISABLED'));
    }
    const parsed = spec.schema.safeParse(deps.rawInput);
    if (!parsed.success) return refuse(fromZodError(parsed.error));
    const handler = spec.handler as (
      ctx: HandlerContext<z.output<S>, Actor | null>,
    ) => Promise<Result<T, AppError>>;
    const result = await handler({
      input: parsed.data,
      actor: actor.value,
      correlationId,
      request: deps.request,
    });
    return result.ok ? { ok: true, value: result.value } : refuse(result.error);
  } catch (error) {
    // Caught once, logged with the correlation ID, returned as a generic error (BR19.1).
    getLogger().error(
      { err: error, correlationId, code: 'UNEXPECTED_ERROR' },
      'server function failed',
    );
    return { ok: false, error: unexpectedError(correlationId) };
  }
}
