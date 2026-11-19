// [LT] Step 23: the SectionVersion review machine (functional-spec §3.2), who may fire each event,
// the return comment, and a model-based property that no sequence approves unseen edits.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkVersion } from './course.ts';
import {
  checkWorkingCopyEditable,
  decideReviewEvent,
  REVIEW_ACTION_OF,
  type ReviewEvent,
  type ReviewState,
  transitionReview,
  validateReturnComment,
} from './review.ts';

const STATES: ReviewState[] = [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
  'discarded',
];
const EVENTS: ReviewEvent[] = [
  'submit',
  'approve',
  'return',
  'selfApprove',
  'reopen',
  'adminApprove',
  'reset',
  'publish',
  'supersede',
  'discard',
];

describe('transitionReview (§3.2)', () => {
  it.each([
    ['draft', 'submit', 'in_review'],
    ['in_review', 'approve', 'approved'],
    ['in_review', 'return', 'draft'],
    ['in_review', 'reset', 'draft'],
    ['draft', 'selfApprove', 'approved'],
    ['draft', 'adminApprove', 'approved'],
    ['in_review', 'adminApprove', 'approved'],
    ['approved', 'reopen', 'draft'],
    ['approved', 'publish', 'published'],
    ['published', 'supersede', 'superseded'],
    ['draft', 'discard', 'discarded'],
    ['in_review', 'discard', 'discarded'],
    ['approved', 'discard', 'discarded'],
  ] as const)('%s --%s--> %s', (from, event, to) => {
    expect(transitionReview(from, event)).toEqual({ ok: true, value: to });
  });

  it('refuses every pair outside the table with invalidTransition', () => {
    const allowed = new Set([
      'draft:submit',
      'in_review:approve',
      'in_review:return',
      'in_review:reset',
      'draft:selfApprove',
      'draft:adminApprove',
      'in_review:adminApprove',
      'approved:reopen',
      'approved:publish',
      'published:supersede',
      'draft:discard',
      'in_review:discard',
      'approved:discard',
    ]);
    for (const state of STATES) {
      for (const event of EVENTS) {
        if (allowed.has(`${state}:${event}`)) continue;
        expect(transitionReview(state, event)).toMatchObject({
          ok: false,
          error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.invalidTransition' },
        });
      }
    }
  });

  it('superseded and discarded are terminal', () => {
    for (const event of EVENTS) {
      expect(transitionReview('superseded', event).ok).toBe(false);
      expect(transitionReview('discarded', event).ok).toBe(false);
    }
  });

  it('records one SectionReview action per event', () => {
    expect(REVIEW_ACTION_OF.selfApprove).toBe('self_approved');
    expect(REVIEW_ACTION_OF.reset).toBe('reset_by_reassignment');
  });
});

describe('checkWorkingCopyEditable (BR8.2, BR8.8)', () => {
  it('only a draft accepts edits', () => {
    expect(checkWorkingCopyEditable('draft').ok).toBe(true);
    for (const s of ['in_review', 'approved'] as const) {
      expect(checkWorkingCopyEditable(s)).toMatchObject({
        ok: false,
        error: { i18nKey: 'errors.catalog.workingCopyReadOnly' },
      });
    }
  });
});

describe('validateReturnComment (BR8.5)', () => {
  it('trims and accepts 1..2000 characters', () => {
    expect(validateReturnComment('  ভালো  ')).toEqual({ ok: true, value: 'ভালো' });
    expect(validateReturnComment('a'.repeat(2000)).ok).toBe(true);
  });
  it.each(['', '   ', '\n\t'])('refuses %j as required', (c) => {
    expect(validateReturnComment(c)).toMatchObject({
      ok: false,
      error: { fieldErrors: { comment: ['errors.catalog.returnCommentRequired'] } },
    });
  });
  it('refuses 2001 characters', () => {
    expect(validateReturnComment('a'.repeat(2001))).toMatchObject({
      ok: false,
      error: { fieldErrors: { comment: ['errors.catalog.returnCommentTooLong'] } },
    });
  });
});

describe('decideReviewEvent (BR6.8, BR8.3–BR8.6)', () => {
  const co = { isLead: false, isOwner: true, isAdmin: false };
  const lead = { isLead: true, isOwner: false, isAdmin: false };
  const leadOwner = { isLead: true, isOwner: true, isAdmin: false };
  const admin = { isLead: false, isOwner: false, isAdmin: true };
  const other = { isLead: false, isOwner: false, isAdmin: false };

  it('the owner submits and reopens; anyone else is notSectionOwner (Admins excepted)', () => {
    for (const e of ['submit', 'reopen'] as const) {
      expect(decideReviewEvent(e, co).ok).toBe(true);
      expect(decideReviewEvent(e, admin).ok).toBe(true);
      expect(decideReviewEvent(e, lead)).toMatchObject({
        ok: false,
        error: { i18nKey: 'errors.catalog.notSectionOwner' },
      });
    }
  });
  it('the Lead approves and returns; a Co-instructor is notLead', () => {
    for (const e of ['approve', 'return'] as const) {
      expect(decideReviewEvent(e, lead).ok).toBe(true);
      expect(decideReviewEvent(e, admin).ok).toBe(true);
      expect(decideReviewEvent(e, co)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
      });
    }
  });
  it('only the Lead who owns the section self-approves', () => {
    expect(decideReviewEvent('selfApprove', leadOwner).ok).toBe(true);
    expect(decideReviewEvent('selfApprove', lead)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(decideReviewEvent('selfApprove', co)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(decideReviewEvent('selfApprove', admin).ok).toBe(false);
    expect(decideReviewEvent('selfApprove', other).ok).toBe(false);
  });
});

describe('property: no sequence approves unseen edits (BR12.1, BR12.2)', () => {
  // A model of one working copy: every edit and every transition bumps the version; every request
  // carries the version its sender last saw. "Unseen" = an approve whose sender saw an older content.
  type Op = {
    kind: 'edit' | 'submit' | 'approve' | 'return' | 'reopen' | 'selfApprove';
    lag: number;
  };
  const op = fc.record({
    kind: fc.constantFrom('edit', 'submit', 'approve', 'return', 'reopen', 'selfApprove'),
    lag: fc.nat({ max: 3 }),
  }) as fc.Arbitrary<Op>;

  it('every successful approve was based on the latest content', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        let state: ReviewState = 'draft';
        let version = 1;
        let contentVersion = 1;
        const history: number[] = [1];
        for (const o of ops) {
          const seen = history[Math.max(0, history.length - 1 - o.lag)] as number;
          if (!checkVersion(version, seen).ok) continue;
          if (o.kind === 'edit') {
            if (!checkWorkingCopyEditable(state).ok) continue;
            version += 1;
            contentVersion = version;
          } else {
            const next = transitionReview(state, o.kind);
            if (!next.ok) continue;
            if (next.value === 'approved' && seen < contentVersion) return false;
            state = next.value;
            version += 1;
          }
          history.push(version);
        }
        return true;
      }),
      { seed: 2301, numRuns: 500 },
    );
  });
});
