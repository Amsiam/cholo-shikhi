import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decideAfterFailure, nextSlot, retryDelayMs } from './retry.ts';

describe('retryDelayMs (contract 2: about 1, 2, 4 and 8 s)', () => {
  it('doubles per attempt with no jitter at random = 0.5', () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n, () => 0.5))).toEqual([1000, 2000, 4000, 8000]);
  });
  it('property: jitter stays within +/-20%', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (n, r) => {
          const d = retryDelayMs(n, () => r);
          const nominal = 1000 * 2 ** (n - 1);
          return d >= Math.floor(nominal * 0.8) && d <= Math.ceil(nominal * 1.2);
        },
      ),
      { seed: 20261113, numRuns: 300 },
    );
  });
  it('rejects attempt numbers below 1', () => {
    expect(() => retryDelayMs(0, () => 0.5)).toThrow();
  });
});

describe('decideAfterFailure', () => {
  it('retries until the last allowed attempt, then fails', () => {
    expect(decideAfterFailure(1, 5, '2026-11-13T00:00:00.000Z', () => 0.5)).toEqual({
      status: 'retry_wait',
      nextAttemptAt: '2026-11-13T00:00:01.000Z',
    });
    expect(decideAfterFailure(5, 5, '2026-11-13T00:00:00.000Z', () => 0.5)).toEqual({
      status: 'failed',
    });
  });
});

describe('nextSlot', () => {
  it('aligns to the interval and keeps an exact slot', () => {
    expect(nextSlot('2026-11-13T10:07:00.000Z', 15)).toBe('2026-11-13T10:15:00.000Z');
    expect(nextSlot('2026-11-13T10:15:00.000Z', 15)).toBe('2026-11-13T10:15:00.000Z');
    expect(() => nextSlot('2026-11-13T10:15:00.000Z', 0)).toThrow();
  });
});
