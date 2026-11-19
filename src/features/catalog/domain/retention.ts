// SD-227 retention cutoffs (NFR10.201, NFR10.202). Plain TypeScript.

/** NFR10.201: published history stays at least this long after retirement. */
export const PUBLISHED_HISTORY_MIN_YEARS = 10;
/** NFR10.202: a discarded, never-published draft is deleted this long after it was discarded. */
export const DISCARDED_DRAFT_YEARS = 1;

/**
 * The same instant `years` calendar years earlier (UTC). A 29 February with no match rolls forward to
 * 1 March, so a cutoff is never earlier than the rule allows.
 */
export function yearsBefore(now: Date, years: number): Date {
  if (!Number.isInteger(years) || years < 0) throw new Error('years must be a whole number ≥ 0');
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(now.getUTCFullYear() - years);
  return cutoff;
}

/** Retired at or before this instant: never sooner than 10 years nor than audit.retentionYears. */
export function publishedHistoryCutoff(now: Date, auditRetentionYears: number): Date {
  return yearsBefore(now, Math.max(PUBLISHED_HISTORY_MIN_YEARS, auditRetentionYears));
}

export function discardedDraftCutoff(now: Date): Date {
  return yearsBefore(now, DISCARDED_DRAFT_YEARS);
}
