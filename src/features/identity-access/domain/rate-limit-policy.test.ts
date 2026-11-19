// BR3.7 / AC1.2.3: attempt L is evaluated normally, attempt L+1 is refused until the window passes.
import { describe, expect, it } from 'vitest';
import { type Bucket, DEFAULT_RATE_LIMITS, isBlocked, recordAttempt } from './rate-limit-policy.ts';

const policy = DEFAULT_RATE_LIMITS.sign_in;
const T0 = '2026-11-13T10:00:00.000Z';
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

describe('rate-limit policy', () => {
  it('does not block an empty bucket', () => {
    expect(isBlocked(null, policy, T0)).toBe(false);
  });
  it('allows L attempts and blocks the L+1th inside the window', () => {
    let bucket: Bucket | null = null;
    for (let i = 0; i < 5; i++) {
      expect(isBlocked(bucket, policy, at(i))).toBe(false);
      bucket = recordAttempt(bucket, policy, at(i));
    }
    expect(isBlocked(bucket, policy, at(5))).toBe(true);
    expect(bucket?.blockedUntil).toBe(at(15));
  });
  it('unblocks once the window has passed and starts a fresh window', () => {
    let bucket: Bucket | null = null;
    for (let i = 0; i < 5; i++) bucket = recordAttempt(bucket, policy, at(0));
    expect(isBlocked(bucket, policy, at(15))).toBe(false);
    const fresh = recordAttempt(bucket, policy, at(16));
    expect(fresh).toEqual({ windowStartedAt: at(16), failureCount: 1, blockedUntil: null });
  });
  it('uses stricter request limits for reset and resend', () => {
    expect(DEFAULT_RATE_LIMITS.reset_request.maxAttempts).toBeLessThan(
      DEFAULT_RATE_LIMITS.sign_in.maxAttempts,
    );
  });
});
