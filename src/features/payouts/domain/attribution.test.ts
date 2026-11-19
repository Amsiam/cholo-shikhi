// [UT] US7.13: resolving an ambiguous attribution case, and the dry-run lines it marks.
import { describe, expect, it } from 'vitest';
import { disputedInstructors, isOverrideReason, resolveRefusal } from './attribution.ts';

const open = { state: 'open' as const, claimantIds: ['tasnim', 'rafiq'] };

describe('resolveRefusal', () => {
  it('AC7.13.1: confirms a claimant as owner with a reason', () => {
    expect(
      resolveRefusal(open, 'tasnim', 'Section authored by Tasnim per the upload log.'),
    ).toBeNull();
  });
  it('refuses a resolved case, a non-claimant owner and a missing or short reason', () => {
    expect(resolveRefusal({ ...open, state: 'resolved' }, 'tasnim', 'A long enough reason.')).toBe(
      'errors.attribution.resolved',
    );
    expect(resolveRefusal(open, 'someone', 'A long enough reason.')).toBe(
      'errors.attribution.notClaimant',
    );
    expect(resolveRefusal(open, 'tasnim', undefined)).toBe('errors.attribution.reason');
    expect(resolveRefusal(open, 'tasnim', '   short   ')).toBe('errors.attribution.reason');
  });
  it('a reason of exactly 10 characters is enough', () => {
    expect(isOverrideReason('0123456789')).toBe(true);
    expect(isOverrideReason('012345678')).toBe(false);
  });
});

describe('disputedInstructors (AC7.13.2)', () => {
  it('marks every claimant of an open case, and nobody for resolved cases', () => {
    const marked = disputedInstructors([
      open,
      { state: 'resolved', claimantIds: ['karim'] },
      { state: 'open', claimantIds: ['rafiq', 'nadia'] },
    ]);
    expect([...marked].sort()).toEqual(['nadia', 'rafiq', 'tasnim']);
    expect(disputedInstructors([]).size).toBe(0);
  });
});
