// Contract 1: Result<T, E>. Expected failures are values; only bugs and infrastructure faults throw.
import type { AppError } from './errors.ts';

export type { AppError, CommonErrorCode } from './errors.ts';

export type Result<T, E extends AppError = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

export function isOk<T, E extends AppError>(
  r: Result<T, E>,
): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E extends AppError>(
  r: Result<T, E>,
): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

export function mapResult<T, U, E extends AppError>(
  r: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** For places where a failure is a bug (tests, start-up wiring). Throws an AppErrorException. */
export function unwrapOrThrow<T, E extends AppError>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new AppErrorException(r.error);
}

/** An AppError carried as an exception, for the rare paths that must throw (e.g. middleware). */
export class AppErrorException extends Error {
  readonly appError: AppError;
  constructor(error: AppError) {
    super(error.code);
    this.name = 'AppErrorException';
    this.appError = error;
  }
}
