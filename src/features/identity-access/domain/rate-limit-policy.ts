// Failure counters (item ii) with refusal before the password check (item iv). BR2.12, BR3.7, BR5.6.
export type RateLimitedAction =
  | 'sign_in'
  | 'sign_up'
  | 'reset_request'
  | 'verification_resend'
  | 'two_factor';

export type RateLimitPolicy = { maxAttempts: number; windowMs: number };

/** Defaults; the keys match the settings named in rules.md (auth.signIn.maxFailures, …). */
export const DEFAULT_RATE_LIMITS: Record<RateLimitedAction, RateLimitPolicy> = {
  sign_in: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  two_factor: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  // Request counters, stricter than ordinary traffic (BR2.12).
  sign_up: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  reset_request: { maxAttempts: 3, windowMs: 15 * 60 * 1000 },
  verification_resend: { maxAttempts: 3, windowMs: 15 * 60 * 1000 },
};

export type Bucket = { windowStartedAt: string; failureCount: number; blockedUntil: string | null };

const ms = (iso: string) => new Date(iso).getTime();

/** True while the bucket refuses attempts. An expired window never blocks. */
export function isBlocked(bucket: Bucket | null, policy: RateLimitPolicy, now: string): boolean {
  if (!bucket) return false;
  if (bucket.blockedUntil && ms(now) < ms(bucket.blockedUntil)) return true;
  const isWindowOpen = ms(now) - ms(bucket.windowStartedAt) < policy.windowMs;
  return isWindowOpen && bucket.failureCount >= policy.maxAttempts;
}

/** Records one counted attempt; reaching the limit blocks until the window passes. */
export function recordAttempt(bucket: Bucket | null, policy: RateLimitPolicy, now: string): Bucket {
  const isWindowOpen = bucket !== null && ms(now) - ms(bucket.windowStartedAt) < policy.windowMs;
  const base: Bucket = isWindowOpen
    ? bucket
    : { windowStartedAt: now, failureCount: 0, blockedUntil: null };
  const failureCount = base.failureCount + 1;
  const blockedUntil =
    failureCount >= policy.maxAttempts
      ? new Date(ms(base.windowStartedAt) + policy.windowMs).toISOString()
      : null;
  return { windowStartedAt: base.windowStartedAt, failureCount, blockedUntil };
}
