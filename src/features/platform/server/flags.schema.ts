// One schema for the Admin flag form and the server (BR8.7).
import { z } from 'zod';

export const FlagChangeInput = z
  .object({
    flagKey: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/),
    description: z.string().trim().min(1).max(500),
    state: z.enum(['off', 'on', 'targeted']),
    targetRoles: z
      .array(z.enum(['student', 'instructor', 'admin', 'finance']))
      .max(4)
      .default([]),
    targetGoalSegmentIds: z.array(z.string().min(1).max(100)).max(200).default([]),
    rolloutPercent: z.number().int().min(0).max(100).default(100),
    /** Omitted when creating; required to change an existing flag (stale revision -> CONFLICT). */
    expectedRevision: z.number().int().min(1).optional(),
  })
  .refine(
    (v) =>
      v.state !== 'targeted' ||
      v.targetRoles.length > 0 ||
      v.targetGoalSegmentIds.length > 0 ||
      v.rolloutPercent < 100,
    { path: ['state'], message: 'targeted flags need a restriction' },
  );
export type FlagChangeInput = z.input<typeof FlagChangeInput>;
