// [LT] BR8.2/BR8.3 evaluation, including rollout determinism as a property test.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateFlag, type FlagDefinition, rolloutBucket } from './flags.ts';

const PROPERTY = { seed: 20261113, numRuns: 300 } as const;
const base: FlagDefinition = {
  flagKey: 'a.b',
  state: 'targeted',
  targetRoles: [],
  targetGoalSegmentIds: [],
  rolloutPercent: 100,
};
const user = { userId: 'u-1', roles: ['student' as const] };

describe('evaluateFlag (BR8.2)', () => {
  it('unknown key is off; off is off; on is on for everyone, even anonymous', () => {
    expect(evaluateFlag(undefined, user)).toEqual({ isEnabled: false, reason: 'unknown' });
    expect(evaluateFlag({ ...base, state: 'off' }, user).isEnabled).toBe(false);
    expect(evaluateFlag({ ...base, state: 'on' }, { roles: [] }).isEnabled).toBe(true);
  });
  it('targets roles', () => {
    const flag = { ...base, targetRoles: ['instructor'] };
    expect(evaluateFlag(flag, user)).toEqual({ isEnabled: false, reason: 'role' });
    expect(evaluateFlag(flag, { ...user, roles: ['student', 'instructor'] }).isEnabled).toBe(true);
  });
  it('targets segments only when the caller supplies one (BR8.9)', () => {
    const flag = { ...base, targetGoalSegmentIds: ['seg-bcs'] };
    expect(evaluateFlag(flag, user)).toEqual({ isEnabled: false, reason: 'segment_missing' });
    expect(evaluateFlag(flag, { ...user, goalSegmentId: 'seg-hsc' }).reason).toBe('segment');
    expect(evaluateFlag(flag, { ...user, goalSegmentId: 'seg-bcs' }).isEnabled).toBe(true);
  });
  it('requires every dimension to match', () => {
    const flag = {
      ...base,
      targetRoles: ['student'],
      targetGoalSegmentIds: ['s'],
      rolloutPercent: 0,
    };
    expect(evaluateFlag(flag, { ...user, goalSegmentId: 's' })).toEqual({
      isEnabled: false,
      reason: 'rollout',
    });
  });
  it('a partial rollout never enables an anonymous caller', () => {
    expect(evaluateFlag({ ...base, rolloutPercent: 99 }, { roles: [] }).reason).toBe('rollout');
  });
});

describe('rollout (BR8.3)', () => {
  it('property: the same user and flag always land in the same bucket in 0..99', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1, maxLength: 30 }), (userId, flagKey) => {
        const a = rolloutBucket(flagKey, userId);
        return a === rolloutBucket(flagKey, userId) && a >= 0 && a < 100;
      }),
      PROPERTY,
    );
  });
  it('property: raising the percentage never switches an enabled user off', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 100 }),
        (userId, p1, extra) => {
          const p2 = Math.min(100, p1 + extra);
          const before = evaluateFlag(
            { ...base, rolloutPercent: p1 },
            { userId, roles: [] },
          ).isEnabled;
          const after = evaluateFlag(
            { ...base, rolloutPercent: p2 },
            { userId, roles: [] },
          ).isEnabled;
          return !before || after;
        },
      ),
      PROPERTY,
    );
  });
  it('enables roughly the configured share of users', () => {
    const users = Array.from({ length: 4000 }, (_, i) => `user-${i}`);
    const enabled = users.filter(
      (userId) => evaluateFlag({ ...base, rolloutPercent: 25 }, { userId, roles: [] }).isEnabled,
    ).length;
    expect(enabled / users.length).toBeGreaterThan(0.21);
    expect(enabled / users.length).toBeLessThan(0.29);
  });
});
