// [LT] US7.23: the payout engine reproduces every golden case exactly, to the poisha, and the cases
// cannot change without a matching manifest (the human approves the values, not the AI).
import { describe, expect, it } from 'vitest';
import {
  goldenCases,
  goldenCasesHash,
  goldenManifest,
  isGoldenApproved,
  manifestApproves,
  runGoldenCase,
} from './golden.ts';

describe('golden payout examples', () => {
  it('AC7.23.2: the cases file matches its manifest hash', () => {
    expect(goldenManifest().sha256).toBe(goldenCasesHash());
  });

  it('an approved manifest names who approved it and when', () => {
    const m = goldenManifest();
    expect(['draft', 'approved']).toContain(m.status);
    if (m.status === 'approved') {
      expect(m.approvedBy).toBeTruthy();
      expect(m.approvedAt).toBeTruthy();
    }
  });

  it('approval needs status, approver, date and the exact hash', () => {
    const ok = { status: 'approved', approvedBy: 'owner', approvedAt: '2026-11-19', sha256: 'h' };
    expect(manifestApproves(ok, 'h')).toBe(true);
    expect(manifestApproves({ ...ok, status: 'draft' }, 'h')).toBe(false);
    expect(manifestApproves({ ...ok, approvedBy: null }, 'h')).toBe(false);
    expect(manifestApproves({ ...ok, approvedAt: null }, 'h')).toBe(false);
    expect(manifestApproves(ok, 'tampered')).toBe(false);
    expect(isGoldenApproved()).toBe(goldenManifest().status === 'approved');
  });

  for (const c of goldenCases()) {
    it(`AC7.23.1: ${c.id} reproduces exactly`, () => {
      for (const cycle of runGoldenCase(c)) expect(cycle.actual).toEqual(cycle.expected);
    });
  }
});
