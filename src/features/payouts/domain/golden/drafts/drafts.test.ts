// [LT] The DRAFT golden payout examples (items behind payouts.payrollAndAttribution): the new code
// reproduces every draft exactly, the drafts cannot change without the manifest hash following, and
// the draft set is never treated as approved until the human approves it. The approved set
// (../golden-cases.json) is untouched and still reproduces (../golden.test.ts).
import { describe, expect, it } from 'vitest';
import { goldenCasesHash, goldenManifest, isGoldenApproved } from '../golden.ts';
import {
  draftCases,
  draftCasesHash,
  draftManifest,
  isDraftGoldenApproved,
  runDraftCase,
} from './drafts.ts';

describe('draft golden payout examples', () => {
  it('the draft cases file matches its manifest hash', () => {
    expect(draftManifest().sha256).toBe(draftCasesHash());
  });

  it('the draft approval is separate from the approved set', () => {
    expect(draftCasesHash()).not.toBe(goldenCasesHash());
    expect(draftManifest().file).toBe('draft-cases.json');
    // The approved set's approval never approves the drafts.
    expect(isGoldenApproved()).toBe(goldenManifest().status === 'approved');
    expect(isDraftGoldenApproved()).toBe(
      draftManifest().status === 'approved' &&
        !!draftManifest().approvedBy &&
        !!draftManifest().approvedAt,
    );
  });

  it('every draft explains its arithmetic and has unique IDs', () => {
    const ids = draftCases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of draftCases()) expect(c.explanation.length).toBeGreaterThan(40);
  });

  for (const c of draftCases()) {
    it(`${c.id} reproduces exactly`, () => {
      const run = runDraftCase(c);
      expect(run.actual).toEqual(run.expected);
    });
  }
});
