// Contract 5 (Goals part) and contract 6 public surface of Goals. Other units import only from here.
// Server-only, in-process functions: none of them is a server function or an HTTP route (NFR6.201).
// Route and UI code calls the server functions in ./server/goals.functions.ts instead.
import type { AppError } from '#src/lib/errors.ts';
import type { Result } from '#src/lib/result.ts';
import { SegmentView, StudentGoal } from './domain/contract5.schema.ts';
import { getGoals } from './server/goals-instance.server.ts';

export { GOAL_CHANGED, GoalChangedV1 } from './domain/goal-changed.schema.ts';
/** BR1.9: a course, exam package or plan is filed only under an active Goal (used by Catalog). */
export { checkGoalAcceptsNewProducts } from './domain/goals.ts';
export { SegmentView, StudentGoal };

/** The student's current Goal. NOT_FOUND = no Goal chosen yet (contract 5). */
export async function getCurrentGoal(
  userId: string,
): Promise<Result<StudentGoal, AppError<'NOT_FOUND'>>> {
  return getGoals().getCurrentGoal(userId);
}

/** An active Goal by ID, for the public catalog. NOT_FOUND for a missing or non-active Goal. */
export async function getActiveGoal(
  goalId: string,
): Promise<
  Result<
    { goalId: string; segmentId: string; nameBn: string; nameEn: string },
    AppError<'NOT_FOUND'>
  >
> {
  return getGoals().getActiveGoal(goalId);
}

/** The segment's current type and battle band (contract 5, BR13.5). */
export async function getSegment(
  segmentId: string,
): Promise<Result<SegmentView, AppError<'NOT_FOUND'>>> {
  return getGoals().getSegment(segmentId);
}

/** IDs of every Goal (any status) in the segments, for Marketing targeting (contract 5, BR13.6). */
export async function listGoalsInSegments(segmentIds: string[]): Promise<string[]> {
  return getGoals().listGoalsInSegments(segmentIds);
}
