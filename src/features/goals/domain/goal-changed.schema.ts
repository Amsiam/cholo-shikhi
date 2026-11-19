// Contract 6: goals.GoalChanged v1 (aggregate key = userId; consumers U5 MistakeVault, U6
// Engagement). IDs and instants only (BR2.5, NFR5.203): a strict object refuses any extra field.
import { z } from 'zod';
import { Id, UtcInstant } from '#src/lib/ids.ts';

export const GOAL_CHANGED = { type: 'goals.GoalChanged', version: 1 } as const;

export const GoalChangedV1 = z.strictObject({
  userId: Id,
  /** null on the first-sign-in choice. */
  previousGoalId: Id.nullable(),
  newGoalId: Id,
  newSegmentId: Id,
  changedAt: UtcInstant,
});
export type GoalChangedV1 = z.infer<typeof GoalChangedV1>;

export const GOALS_EVENTS = [
  { ...GOAL_CHANGED, schema: GoalChangedV1, aggregateKey: 'userId' },
] as const;
