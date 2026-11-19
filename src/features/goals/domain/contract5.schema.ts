// Contract 5 (Goals part) shared schemas, exactly as contract-summary.md §5 declares them.
import { z } from 'zod';
import { Id, UtcInstant } from '#src/lib/ids.ts';

export const SegmentView = z.object({
  segmentId: Id,
  segmentType: z.string(),
  battleBand: z.string(),
});
export type SegmentView = z.infer<typeof SegmentView>;

export const StudentGoal = z.object({
  userId: Id,
  goalId: Id,
  segmentId: Id,
  selectedAt: UtcInstant,
});
export type StudentGoal = z.infer<typeof StudentGoal>;
