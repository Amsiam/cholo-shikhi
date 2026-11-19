// One schema per takedown action, shared by the A11 forms and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const TargetsInput = z.object({ course: z.string().trim().min(8).max(500) });
export type TargetsInput = z.input<typeof TargetsInput>;

export const LogTakedownInput = z.object({
  courseId: Id,
  contentType: z.enum(['course', 'section', 'lesson']),
  contentId: Id,
  claimant: z.string().trim().min(2).max(200),
  claimantContact: z.string().trim().min(3).max(300),
  claim: z.string().trim().min(10).max(2000),
  evidence: z.string().trim().min(5).max(4000),
});
export type LogTakedownInput = z.input<typeof LogTakedownInput>;

export const DecideTakedownInput = z.object({
  noticeId: Id,
  action: z.enum(['honour', 'reject', 'reverse']),
  reason: z.string().max(1000).optional(),
});
export type DecideTakedownInput = z.input<typeof DecideTakedownInput>;
