// One Zod schema per Goals mutation and read, shared by the A4 / S1 / S12 forms and the server
// functions (team.md Validation). Shape and bounds live here; the business rules that need data
// (empty-after-trim names, duplicates, status machine) are the domain's, with field-specific keys.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { SEGMENT_TYPES } from '../domain/goals.ts';

const Name = z.string().max(200);
const SortOrder = z.coerce.number().int().min(0).max(10_000);
const Version = z.number().int().min(1);

/** An edit (an ID is present) must say which version it was based on (BR12.1). */
function requireVersionOnEdit(idKey: string) {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
    if (value[idKey] !== undefined && value.expectedVersion === undefined) {
      ctx.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'required' });
    }
  };
}

export const SegmentSaveInput = z
  .object({
    segmentId: Id.optional(),
    expectedVersion: Version.optional(),
    nameBn: Name,
    nameEn: Name,
    segmentType: z.enum(SEGMENT_TYPES),
    battleBand: z.string().max(60),
    sortOrder: SortOrder,
  })
  .superRefine(requireVersionOnEdit('segmentId'));
export type SegmentSaveInput = z.input<typeof SegmentSaveInput>;

export const SegmentDeleteInput = z.object({ segmentId: Id, expectedVersion: Version });
export type SegmentDeleteInput = z.input<typeof SegmentDeleteInput>;

export const GoalSaveInput = z
  .object({
    goalId: Id.optional(),
    expectedVersion: Version.optional(),
    segmentId: Id,
    nameBn: Name,
    nameEn: Name,
    status: z.enum(['inactive', 'active']),
    sortOrder: SortOrder,
  })
  .superRefine(requireVersionOnEdit('goalId'));
export type GoalSaveInput = z.input<typeof GoalSaveInput>;

export const GoalRetireInput = z.object({ goalId: Id, expectedVersion: Version });
export type GoalRetireInput = z.input<typeof GoalRetireInput>;

export const PageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageInput = z.input<typeof PageInput>;

export const GoalsAdminListInput = PageInput.extend({ segmentId: Id.optional() });
export type GoalsAdminListInput = z.input<typeof GoalsAdminListInput>;

export const ChooseGoalInput = z.object({ goalId: Id });
export type ChooseGoalInput = z.input<typeof ChooseGoalInput>;

/** BR2.6: sent only after the Student confirmed the streak warning in the S12 dialog. */
export const ChangeGoalInput = z.object({ goalId: Id, acknowledgedStreakReset: z.boolean() });
export type ChangeGoalInput = z.input<typeof ChangeGoalInput>;

export const NoInput = z.object({}).default({});
