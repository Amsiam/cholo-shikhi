import { z } from 'zod';

/** Admin audit search params (server-side pagination, validateSearch). */
export const AuditListInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  subjectType: z.string().max(80).optional(),
  subjectId: z.string().max(200).optional(),
  action: z.string().max(120).optional(),
});
export type AuditListInput = z.input<typeof AuditListInput>;
