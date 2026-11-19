import { describe, expect, it } from 'vitest';
import {
  effectiveRetentionYears,
  partitionsDueForDrop,
  partitionsToEnsure,
} from './audit-retention.ts';

const names = [
  'audit_log_entry_y2026',
  'audit_log_entry_y2027',
  'audit_log_entry_y2028',
  'audit_log_entry_default',
  'other',
];

describe('audit retention (BR7.4)', () => {
  it('never goes below 10 years', () => {
    expect(effectiveRetentionYears(3)).toBe(10);
    expect(effectiveRetentionYears(undefined)).toBe(10);
    expect(effectiveRetentionYears(12)).toBe(12);
  });
  it('drops a year only when its whole range is past the cutoff', () => {
    // Cutoff 2027-01-01: y2026 ends exactly at the cutoff and is dropped; y2027 is kept.
    expect(partitionsDueForDrop(names, '2037-01-01T00:00:00.000Z', 10)).toEqual([
      'audit_log_entry_y2026',
    ]);
    expect(partitionsDueForDrop(names, '2036-12-31T23:59:00.000Z', 10)).toEqual([]);
  });
  it('keeps an entry 9 years 364 days old', () => {
    // Entry 2027-11-14, now 2037-11-13: its partition (y2027) ends 2028-01-01, after the 2027-11-13 cutoff.
    expect(partitionsDueForDrop(names, '2037-11-13T00:00:00.000Z', 10)).not.toContain(
      'audit_log_entry_y2027',
    );
  });
  it('never drops the default partition or unrelated tables', () => {
    expect(partitionsDueForDrop(names, '2099-01-01T00:00:00.000Z', 10)).toEqual([
      'audit_log_entry_y2026',
      'audit_log_entry_y2027',
      'audit_log_entry_y2028',
    ]);
  });
  it('lists this year and the next two as partitions to ensure', () => {
    expect(partitionsToEnsure('2041-03-01T00:00:00.000Z')).toEqual([2041, 2042, 2043]);
  });
});
