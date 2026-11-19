// [AT] Contract 1 envelope: an AppError reaches the client only as { code, i18nKey, fieldErrors? };
// stack traces, SQL and messages never leave the server (BR19.1).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  appError,
  fromZodError,
  isAppError,
  toClientError,
  toClientErrorFromUnknown,
  unexpectedError,
} from './errors.ts';

describe('contract 1 error envelope', () => {
  it('Given an AppError, When it crosses the boundary, Then only code, i18nKey and fieldErrors remain', () => {
    const error = appError('NOT_FOUND', { details: { courseId: 'c1' } });
    expect(toClientError(error)).toEqual({ code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' });
  });

  it('Given a validation failure, Then fieldErrors carry i18n keys per field', () => {
    const schema = z.object({ email: z.email(), password: z.string().min(12) });
    const parsed = schema.safeParse({ email: 'nope', password: 'short' });
    if (parsed.success) throw new Error('expected failure');
    const client = toClientError(fromZodError(parsed.error));
    expect(client.code).toBe('VALIDATION_FAILED');
    expect(client.fieldErrors?.email?.[0]).toMatch(/^errors\.validation\./);
    expect(client.fieldErrors?.password?.[0]).toBe('errors.validation.too_small');
  });

  it('Given an unexpected exception with SQL in it, Then the client sees a generic error and no SQL or stack', () => {
    const thrown = new Error(
      'duplicate key value violates unique constraint "user_email_key" SELECT * FROM user',
    );
    const client = toClientErrorFromUnknown(thrown, 'corr-123');
    const serialised = JSON.stringify(client);
    expect(client.code).toBe('INTERNAL_ERROR');
    expect(serialised).not.toMatch(/SELECT|constraint|stack|at Object/);
    expect(client.correlationId).toBe('corr-123');
  });

  it('Given an AppError thrown as an exception, Then it is mapped to its own envelope, not the generic one', () => {
    const client = toClientErrorFromUnknown(appError('FORBIDDEN'), 'c');
    expect(client.code).toBe('FORBIDDEN');
  });

  it('serialises to plain JSON with no prototype or undefined fields', () => {
    const client = toClientError(appError('RATE_LIMITED'));
    expect(JSON.parse(JSON.stringify(client))).toEqual(client);
    expect(Object.keys(client)).toEqual(['code', 'i18nKey']);
  });
});

describe('error helpers', () => {
  it('uses a feature namespace for non-common codes', () => {
    expect(appError('STEP_UP_REQUIRED', { namespace: 'identity' }).i18nKey).toBe(
      'errors.identity.STEP_UP_REQUIRED',
    );
  });

  it('recognises AppError shapes and rejects other values', () => {
    expect(isAppError(appError('CONFLICT'))).toBe(true);
    expect(isAppError({ code: 'X' })).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError('CONFLICT')).toBe(false);
  });

  it('builds a generic unexpected error with the correlation ID', () => {
    expect(unexpectedError('abc')).toEqual({
      code: 'INTERNAL_ERROR',
      i18nKey: 'errors.common.INTERNAL_ERROR',
      correlationId: 'abc',
    });
  });

  it('maps nested Zod paths to dotted field names', () => {
    const schema = z.object({ profile: z.object({ name: z.string().min(1) }) });
    const parsed = schema.safeParse({ profile: { name: '' } });
    if (parsed.success) throw new Error('expected failure');
    expect(Object.keys(fromZodError(parsed.error).fieldErrors ?? {})).toEqual(['profile.name']);
  });

  it('uses _form for root-level validation issues', () => {
    const parsed = z.string().safeParse(5);
    if (parsed.success) throw new Error('expected failure');
    expect(fromZodError(parsed.error).fieldErrors?._form).toEqual([
      'errors.validation.invalid_type',
    ]);
  });
});
