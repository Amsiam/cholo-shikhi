// [LT] Step 6: Goals domain rules (BR1.2–BR1.9, BR2.2–BR2.8, functional-spec §3.4), plus a
// fast-check property: no event sequence moves a Goal through an illegal transition.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkGoalAcceptsNewProducts,
  checkSegmentChange,
  checkSegmentDeletable,
  checkVersion,
  decideGoalSelection,
  GOAL_NAME_MAX,
  GOAL_STATUSES,
  type GoalEvent,
  type GoalStatus,
  groupActiveGoals,
  initialGoalStatus,
  noActiveGoalsNoticeKey,
  SEGMENT_NAME_MAX,
  statusEventFor,
  transitionGoal,
  validateGoalFields,
  validateSegmentFields,
} from './goals.ts';

const NOW = '2026-11-16T06:00:00.000Z';
const segment = {
  nameBn: ' এইচএসসি ',
  nameEn: ' HSC ',
  segmentType: 'academic',
  battleBand: 'hsc',
  sortOrder: 0,
};

describe('validateSegmentFields (BR1.2)', () => {
  it('accepts and trims a valid segment', () => {
    expect(validateSegmentFields(segment)).toEqual({
      ok: true,
      value: { ...segment, nameBn: 'এইচএসসি', nameEn: 'HSC' },
    });
  });

  it('refuses an empty name, a too-long name and a duplicate, field by field', () => {
    const result = validateSegmentFields(
      { ...segment, nameBn: '   ', nameEn: 'x'.repeat(SEGMENT_NAME_MAX + 1) },
      {},
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: {
          nameBn: ['errors.goals.nameRequired'],
          nameEn: ['errors.goals.nameTooLong'],
        },
      },
    });
    expect(validateSegmentFields(segment, { nameEn: true })).toMatchObject({
      ok: false,
      error: { fieldErrors: { nameEn: ['errors.goals.nameDuplicate'] } },
    });
  });

  it('refuses an unknown type, a non-key battle band and a negative sort order', () => {
    const result = validateSegmentFields({
      ...segment,
      segmentType: 'other',
      battleBand: 'Class 6-8',
      sortOrder: -1,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? {} : result.error.fieldErrors).toEqual({
      segmentType: ['errors.validation.invalid_value'],
      battleBand: ['errors.goals.battleBandInvalid'],
      sortOrder: ['errors.validation.too_small'],
    });
  });
});

describe('validateGoalFields (BR1.3)', () => {
  const goal = { nameBn: 'বিসিএস', nameEn: 'BCS', sortOrder: 2 };
  it('accepts both names in a known segment', () => {
    expect(validateGoalFields(goal, { isSegmentKnown: true }).ok).toBe(true);
  });
  it('refuses a missing Bangla or English name with a field error on that name', () => {
    expect(validateGoalFields({ ...goal, nameBn: '' }, { isSegmentKnown: true })).toMatchObject({
      ok: false,
      error: { fieldErrors: { nameBn: ['errors.goals.nameRequired'] } },
    });
    expect(
      validateGoalFields(
        { ...goal, nameEn: 'y'.repeat(GOAL_NAME_MAX + 1) },
        { isSegmentKnown: true },
      ),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { nameEn: ['errors.goals.nameTooLong'] } },
    });
  });
  it('refuses an unknown segment and a duplicate name in the segment', () => {
    expect(
      validateGoalFields(goal, { isSegmentKnown: false, clashes: { nameBn: true } }),
    ).toMatchObject({
      ok: false,
      error: {
        fieldErrors: {
          segmentId: ['errors.goals.segmentNotFound'],
          nameBn: ['errors.goals.nameDuplicate'],
        },
      },
    });
  });
});

describe('checkVersion (BR12.1)', () => {
  it('passes the stored version and refuses any other with staleVersion', () => {
    expect(checkVersion(3, 3)).toEqual({ ok: true, value: undefined });
    expect(checkVersion(3, 2)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
    expect(checkVersion(3, undefined).ok).toBe(false);
  });
});

describe('Goal status machine (§3.4, BR1.4)', () => {
  it('allows exactly the documented transitions', () => {
    expect(transitionGoal('inactive', 'activate')).toEqual({ ok: true, value: 'active' });
    expect(transitionGoal('active', 'deactivate')).toEqual({ ok: true, value: 'inactive' });
    expect(transitionGoal('inactive', 'retire')).toEqual({ ok: true, value: 'retired' });
    expect(transitionGoal('active', 'retire')).toEqual({ ok: true, value: 'retired' });
    expect(transitionGoal('active', 'activate').ok).toBe(false);
    expect(transitionGoal('inactive', 'deactivate').ok).toBe(false);
  });

  it('keeps retired terminal with goalRetired', () => {
    for (const event of ['activate', 'deactivate', 'retire'] as const) {
      expect(transitionGoal('retired', event)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.goalRetired' },
      });
    }
    expect(statusEventFor('retired', 'active').ok).toBe(false);
  });

  it('maps a save with a status to its event, or none when unchanged', () => {
    expect(statusEventFor('inactive', 'active')).toEqual({ ok: true, value: 'activate' });
    expect(statusEventFor('active', 'inactive')).toEqual({ ok: true, value: 'deactivate' });
    expect(statusEventFor('active', 'active')).toEqual({ ok: true, value: null });
    expect(initialGoalStatus('inactive')).toBe('inactive');
  });

  it('property: no event sequence ever reaches an illegal transition', () => {
    const LEGAL = new Set([
      'inactive>activate>active',
      'active>deactivate>inactive',
      'inactive>retire>retired',
      'active>retire>retired',
    ]);
    fc.assert(
      fc.property(
        fc.constantFrom<'inactive' | 'active'>('inactive', 'active'),
        fc.array(fc.constantFrom<GoalEvent>('activate', 'deactivate', 'retire'), { maxLength: 40 }),
        (start, events) => {
          let state: GoalStatus = initialGoalStatus(start);
          let wasRetired = false;
          for (const event of events) {
            const next = transitionGoal(state, event);
            if (next.ok) {
              expect(LEGAL.has(`${state}>${event}>${next.value}`)).toBe(true);
              state = next.value;
            } else {
              expect(next.error.code).toBe('INVALID_STATE');
            }
            if (wasRetired) expect(state).toBe('retired');
            wasRetired ||= state === 'retired';
            expect(GOAL_STATUSES).toContain(state);
          }
        },
      ),
      { seed: 20261116, numRuns: 500 },
    );
  });
});

describe('segment rules (BR1.5, BR1.7, BR1.9)', () => {
  it('fixes a used Goal in its segment but lets an unused one move', () => {
    expect(checkSegmentChange('a', 'a', { selectionCount: 5, productCount: 0 }).ok).toBe(true);
    expect(checkSegmentChange('a', 'b', { selectionCount: 0, productCount: 0 }).ok).toBe(true);
    expect(checkSegmentChange('a', 'b', { selectionCount: 1, productCount: 0 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.segmentFixed' },
    });
    expect(checkSegmentChange('a', 'b', { selectionCount: 0, productCount: 2 }).ok).toBe(false);
  });

  it('deletes a segment only with no linked Goals and reports the count', () => {
    expect(checkSegmentDeletable(0).ok).toBe(true);
    expect(checkSegmentDeletable(3)).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICT',
        i18nKey: 'errors.goals.segmentHasGoals',
        details: { linkedGoalCount: 3 },
      },
    });
  });

  it('files new products only under an active Goal', () => {
    expect(checkGoalAcceptsNewProducts({ status: 'active' }).ok).toBe(true);
    for (const goal of [
      undefined,
      { status: 'inactive' as const },
      { status: 'retired' as const },
    ]) {
      expect(checkGoalAcceptsNewProducts(goal)).toMatchObject({
        ok: false,
        error: { fieldErrors: { goalId: ['errors.goals.goalNotActive'] } },
      });
    }
  });
});

describe('decideGoalSelection (BR2.4–BR2.8)', () => {
  const active = { goalId: 'g-new', segmentId: 's-1', status: 'active' as const };

  it('opens the first selection with previousGoalId null', () => {
    expect(
      decideGoalSelection({ mode: 'choose', current: null, target: active, now: NOW }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'open',
        previousGoalId: null,
        newGoalId: 'g-new',
        newSegmentId: 's-1',
        changedAt: NOW,
      },
    });
  });

  it('changes Goal only with the streak acknowledgement (BR2.6)', () => {
    const base = {
      mode: 'change' as const,
      current: { goalId: 'g-old' },
      target: active,
      now: NOW,
    };
    expect(decideGoalSelection(base)).toMatchObject({
      ok: false,
      error: {
        fieldErrors: { acknowledgedStreakReset: ['errors.goals.streakResetNotAcknowledged'] },
      },
    });
    expect(decideGoalSelection({ ...base, acknowledgedStreakReset: true })).toMatchObject({
      ok: true,
      value: { kind: 'open', previousGoalId: 'g-old', newGoalId: 'g-new' },
    });
  });

  it('treats re-selecting the current Goal as a no-op, even a retired one (BR2.8, BR1.4)', () => {
    const retired = { ...active, goalId: 'g-old', status: 'retired' as const };
    expect(
      decideGoalSelection({
        mode: 'change',
        current: { goalId: 'g-old' },
        target: retired,
        acknowledgedStreakReset: true,
        now: NOW,
      }),
    ).toEqual({ ok: true, value: { kind: 'noop', goalId: 'g-old' } });
  });

  it('refuses a non-active or unknown target (BR1.4) and a second first choice', () => {
    for (const target of [undefined, { ...active, status: 'inactive' as const }]) {
      expect(
        decideGoalSelection({ mode: 'choose', current: null, target, now: NOW }),
      ).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', i18nKey: 'errors.goals.goalNotActive' },
      });
    }
    expect(
      decideGoalSelection({
        mode: 'choose',
        current: { goalId: 'g-old' },
        target: active,
        now: NOW,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.alreadyHasGoal' },
    });
  });
});

describe('groupActiveGoals (BR2.2)', () => {
  it('groups active Goals by segment in sortOrder and hides empty segments', () => {
    const segments = [
      { segmentId: 's2', nameBn: 'খ', nameEn: 'B', sortOrder: 1 },
      { segmentId: 's1', nameBn: 'ক', nameEn: 'A', sortOrder: 0 },
      { segmentId: 's3', nameBn: 'গ', nameEn: 'C', sortOrder: 2 },
    ];
    const goal = (goalId: string, segmentId: string, sortOrder: number, status: GoalStatus) => ({
      goalId,
      segmentId,
      nameBn: goalId,
      nameEn: goalId,
      sortOrder,
      status,
    });
    const groups = groupActiveGoals(segments, [
      goal('g2', 's1', 2, 'active'),
      goal('g1', 's1', 1, 'active'),
      goal('g3', 's2', 0, 'active'),
      goal('g4', 's3', 0, 'retired'),
      goal('g5', 's2', 1, 'inactive'),
    ]);
    expect(groups.map((g) => [g.segmentId, g.goals.map((x) => x.goalId)])).toEqual([
      ['s1', ['g1', 'g2']],
      ['s2', ['g3']],
    ]);
  });

  it('returns no groups when no Goal is active', () => {
    expect(
      groupActiveGoals([{ segmentId: 's', nameBn: 'ক', nameEn: 'A', sortOrder: 0 }], []),
    ).toEqual([]);
  });
});

describe('noActiveGoalsNoticeKey (BR2.3)', () => {
  it('is one key per Dhaka calendar day', () => {
    // 2026-11-16 17:59Z is 23:59 in Dhaka; 18:00Z is the next Dhaka day.
    expect(noActiveGoalsNoticeKey('2026-11-16T17:59:00.000Z')).toBe(
      'goals.noActiveGoals:2026-11-16',
    );
    expect(noActiveGoalsNoticeKey('2026-11-16T18:00:00.000Z')).toBe(
      'goals.noActiveGoals:2026-11-17',
    );
    expect(noActiveGoalsNoticeKey('2026-11-16T00:00:00.000Z')).toBe(
      'goals.noActiveGoals:2026-11-16',
    );
  });
});
