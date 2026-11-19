// Retry timing shared by jobs (BR10.3) and the outbox relay (contract 2, BR11.6):
// wait base x 2^(n-1) after failed attempt n, with +/-20% jitter.
export function retryDelayMs(failedAttempt: number, random: () => number, baseMs = 1000): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1)
    throw new RangeError('failedAttempt must be >= 1');
  const jitter = 0.8 + 0.4 * random();
  return Math.round(baseMs * 2 ** (failedAttempt - 1) * jitter);
}

export type FailureDecision =
  | { status: 'retry_wait'; nextAttemptAt: string }
  | { status: 'failed' };

/** After failed attempt n: retry later, or give up when the last allowed attempt failed. */
export function decideAfterFailure(
  failedAttempt: number,
  maxAttempts: number,
  now: string,
  random: () => number,
  baseMs = 1000,
): FailureDecision {
  if (failedAttempt >= maxAttempts) return { status: 'failed' };
  return {
    status: 'retry_wait',
    nextAttemptAt: new Date(
      new Date(now).getTime() + retryDelayMs(failedAttempt, random, baseMs),
    ).toISOString(),
  };
}

/** The next slot of a fixed-interval recurring job at or after `now`, aligned to the epoch. */
export function nextSlot(now: string, everyMinutes: number): string {
  if (!Number.isInteger(everyMinutes) || everyMinutes < 1)
    throw new RangeError('everyMinutes must be >= 1');
  const step = everyMinutes * 60_000;
  return new Date(Math.ceil(new Date(now).getTime() / step) * step).toISOString();
}
