// BR7.4: audit entries are kept for audit.retentionYears, default 10, never less than 10.
// Retention removes whole yearly partitions, so a row is never updated or deleted (BR7.3).
export const MIN_AUDIT_RETENTION_YEARS = 10;
const PARTITION = /^audit_log_entry_y(\d{4})$/;

export function effectiveRetentionYears(requested: number | undefined): number {
  return Math.max(MIN_AUDIT_RETENTION_YEARS, Math.floor(requested ?? MIN_AUDIT_RETENTION_YEARS));
}

/**
 * A yearly partition may be dropped only when every instant it can hold is older than the
 * retention period: its exclusive upper bound (1 January of the next year) is at or before
 * `now - retentionYears`. The default partition is never dropped.
 */
export function partitionsDueForDrop(
  partitionNames: readonly string[],
  now: string,
  retentionYears: number,
): string[] {
  const nowDate = new Date(now);
  const cutoff = Date.UTC(
    nowDate.getUTCFullYear() - effectiveRetentionYears(retentionYears),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
    nowDate.getUTCHours(),
    nowDate.getUTCMinutes(),
  );
  return partitionNames
    .filter((name) => {
      const match = PARTITION.exec(name);
      if (!match) return false;
      return Date.UTC(Number(match[1]) + 1, 0, 1) <= cutoff;
    })
    .sort();
}

/** The yearly partitions that must exist ahead of `now` (this year and the next two). */
export function partitionsToEnsure(now: string): number[] {
  const year = new Date(now).getUTCFullYear();
  return [year, year + 1, year + 2];
}
