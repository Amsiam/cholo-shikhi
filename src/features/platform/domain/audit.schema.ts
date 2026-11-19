// Contract 3 AuditEntry. Before/after values are redacted before storage (BR7.5).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const AuditEntry = z.object({
  actorId: z.union([Id, z.literal('system')]),
  action: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i),
  subjectType: z.string().min(1).max(80),
  subjectId: z.string().min(1).max(200),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().max(1000).optional(),
  correlationId: z.string().min(1).max(100),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
