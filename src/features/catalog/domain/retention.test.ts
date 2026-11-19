// [TF] Step 50: SD-227 retention cutoffs. Published history is kept at least 10 years after
// retirement and never less than audit.retentionYears (NFR10.201); discarded drafts go after 1 year
// (NFR10.202). A cutoff never moves earlier than the rule allows (Feb 29 rolls forward).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  discardedDraftCutoff,
  PUBLISHED_HISTORY_MIN_YEARS,
  publishedHistoryCutoff,
  yearsBefore,
} from './retention.ts';

const at = (iso: string) => new Date(iso);

describe('retention cutoffs (SD-227)', () => {
  it('keeps published history for at least 10 years', () => {
    expect(PUBLISHED_HISTORY_MIN_YEARS).toBe(10);
    expect(publishedHistoryCutoff(at('2036-11-17T00:00:00Z'), 7).toISOString()).toBe(
      '2026-11-17T00:00:00.000Z',
    );
  });

  it('uses audit.retentionYears when it is longer than 10', () => {
    expect(publishedHistoryCutoff(at('2040-01-01T00:00:00Z'), 12).toISOString()).toBe(
      '2028-01-01T00:00:00.000Z',
    );
  });

  it('purges discarded drafts after one calendar year', () => {
    expect(discardedDraftCutoff(at('2027-11-17T06:00:00Z')).toISOString()).toBe(
      '2026-11-17T06:00:00.000Z',
    );
  });

  it('rolls 29 February forward, never backward (conservative)', () => {
    expect(yearsBefore(at('2028-02-29T00:00:00Z'), 1).toISOString()).toBe(
      '2027-03-01T00:00:00.000Z',
    );
  });

  it('refuses a negative or fractional number of years', () => {
    expect(() => yearsBefore(at('2028-01-01T00:00:00Z'), -1)).toThrow();
    expect(() => yearsBefore(at('2028-01-01T00:00:00Z'), 1.5)).toThrow();
  });

  it('never lets anything younger than 10 years through (property)', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: at('2030-01-01T00:00:00Z'),
          max: at('2100-01-01T00:00:00Z'),
          noInvalidDate: true,
        }),
        fc.integer({ min: 0, max: 40 }),
        (now, auditYears) => {
          const cutoff = publishedHistoryCutoff(now, auditYears);
          const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
          expect(now.getTime() - cutoff.getTime()).toBeGreaterThanOrEqual(tenYearsMs);
        },
      ),
      { seed: 227, numRuns: 300 },
    );
  });
});
