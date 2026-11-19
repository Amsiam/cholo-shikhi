import { describe, expect, it } from 'vitest';
import { appError } from './errors.ts';
import { err, isErr, isOk, mapResult, ok, unwrapOrThrow } from './result.ts';

describe('Result<T, E>', () => {
  it('Given ok(value), Then isOk is true and the value is carried', () => {
    const r = ok(5);
    expect(isOk(r)).toBe(true);
    expect(r).toEqual({ ok: true, value: 5 });
  });

  it('Given err(error), Then isErr is true and the AppError is carried', () => {
    const r = err(appError('NOT_FOUND'));
    expect(isErr(r)).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('maps only the ok branch', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    const failure = err(appError('CONFLICT'));
    expect(mapResult(failure, (n: number) => n * 3)).toBe(failure);
  });

  it('unwrapOrThrow returns the value or throws the AppError', () => {
    expect(unwrapOrThrow(ok('x'))).toBe('x');
    expect(() => unwrapOrThrow(err(appError('FORBIDDEN')))).toThrow(/FORBIDDEN/);
  });
});
