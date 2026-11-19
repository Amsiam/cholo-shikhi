// One schema per attribution queue action (A7 forms and the server functions share them).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const OpenCaseInput = z.object({
  courseId: Id,
  sectionId: Id,
  claimantIds: z.array(Id).min(1).max(10),
  description: z.string().trim().min(10).max(1000),
});
export type OpenCaseInput = z.input<typeof OpenCaseInput>;

export const ResolveCaseInput = z.object({
  caseId: Id,
  ownerId: Id,
  reason: z.string().max(1000).optional(),
});
export type ResolveCaseInput = z.input<typeof ResolveCaseInput>;

export const CaseCourseInput = z.object({ course: z.string().trim().min(8).max(500) });
export type CaseCourseInput = z.input<typeof CaseCourseInput>;
