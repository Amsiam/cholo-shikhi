// Contract 1: AppError and the client-facing envelope { code, i18nKey, fieldErrors? } (BR19.1).
import type { z } from 'zod';

export type AppError<C extends string = string> = {
  readonly code: C;
  readonly i18nKey: `errors.${string}`;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
};

export type CommonErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'SETTING_NOT_SET'
  | 'FEATURE_DISABLED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED';

/** The only error shape that crosses the server-function boundary. */
export type ClientError = {
  readonly code: string;
  readonly i18nKey: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly correlationId?: string;
};

/**
 * Builds an AppError. Common codes use `errors.common.<CODE>`; feature codes need a namespace,
 * giving `errors.<namespace>.<CODE>`.
 */
export function appError<C extends string>(
  code: C,
  options: {
    namespace?: string;
    fieldErrors?: Record<string, readonly string[]>;
    details?: Record<string, string | number | boolean>;
  } = {},
): AppError<C> {
  const namespace = options.namespace ?? 'common';
  return {
    code,
    i18nKey: `errors.${namespace}.${code}`,
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; i18nKey?: unknown };
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.i18nKey === 'string' &&
    candidate.i18nKey.startsWith('errors.')
  );
}

/** Maps a Zod error to VALIDATION_FAILED with per-field i18n keys (never raw messages). */
export function fromZodError(error: z.ZodError): AppError<'VALIDATION_FAILED'> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : '_form';
    const key = `errors.validation.${issue.code}`;
    const list = fieldErrors[field] ?? [];
    if (!list.includes(key)) list.push(key);
    fieldErrors[field] = list;
  }
  return appError('VALIDATION_FAILED', { fieldErrors });
}

/** Strips everything but code, i18nKey and fieldErrors. `details` stay on the server. */
export function toClientError(error: AppError): ClientError {
  return {
    code: error.code,
    i18nKey: error.i18nKey,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  };
}

export function unexpectedError(correlationId: string): ClientError {
  return { code: 'INTERNAL_ERROR', i18nKey: 'errors.common.INTERNAL_ERROR', correlationId };
}

/**
 * Maps anything thrown to a client error. AppErrors (or exceptions carrying one) keep their
 * code; every other value becomes the generic INTERNAL_ERROR so no message, SQL or stack leaks.
 */
export function toClientErrorFromUnknown(thrown: unknown, correlationId: string): ClientError {
  if (isAppError(thrown)) return toClientError(thrown);
  if (typeof thrown === 'object' && thrown !== null && 'appError' in thrown) {
    const carried = (thrown as { appError: unknown }).appError;
    if (isAppError(carried)) return toClientError(carried);
  }
  return unexpectedError(correlationId);
}
