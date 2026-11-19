// [LT] Step 3: contract 6 goals.GoalChanged v1 carries IDs and instants only (BR2.5, NFR5.203).
import { describe, expect, it } from 'vitest';
import { freeTextPaths } from '#src/test/schema-inspect.ts';
import { GOAL_CHANGED, GOALS_EVENTS, GoalChangedV1 } from './goal-changed.schema.ts';

const valid = {
  userId: '0b0f7a2e-5d7c-4a8e-9a77-2f0b1e5d8c01',
  previousGoalId: null,
  newGoalId: '1c1f7a2e-5d7c-4a8e-9a77-2f0b1e5d8c02',
  newSegmentId: '2d2f7a2e-5d7c-4a8e-9a77-2f0b1e5d8c03',
  changedAt: '2026-11-16T06:00:00.000Z',
};

describe('goals.GoalChanged v1 (contract 6)', () => {
  it('is the contract type and version', () => {
    expect(GOAL_CHANGED).toEqual({ type: 'goals.GoalChanged', version: 1 });
    expect(GOALS_EVENTS[0].aggregateKey).toBe('userId');
  });

  it('accepts a first choice (previousGoalId null) and a change', () => {
    expect(GoalChangedV1.parse(valid)).toEqual(valid);
    expect(GoalChangedV1.safeParse({ ...valid, previousGoalId: valid.newGoalId }).success).toBe(
      true,
    );
  });

  it('has no free-text field', () => {
    expect(freeTextPaths(GoalChangedV1)).toEqual([]);
  });

  it('refuses a Goal name or any other extra field', () => {
    expect(GoalChangedV1.safeParse({ ...valid, goalName: 'BCS' }).success).toBe(false);
  });

  it('refuses a non-UUID ID and a non-ISO instant', () => {
    expect(GoalChangedV1.safeParse({ ...valid, userId: 'student-1' }).success).toBe(false);
    expect(GoalChangedV1.safeParse({ ...valid, changedAt: '16/11/2026' }).success).toBe(false);
  });
});
