// Contract 3 identity types (Zod + TypeScript).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const Role = z.enum(['student', 'instructor', 'admin', 'finance']);
export type Role = z.infer<typeof Role>;
export const StaffRole = z.enum(['instructor', 'admin', 'finance']);
export type StaffRole = z.infer<typeof StaffRole>;
/** Contract 3 lists lead/co_instructor too; U1 only ever returns employee or contractor (BR4.9). */
export const InstructorType = z.enum(['lead', 'co_instructor', 'employee', 'contractor']);
export type InstructorType = z.infer<typeof InstructorType>;

export const Actor = z.object({
  userId: Id,
  roles: z.array(Role),
  locale: z.enum(['bn', 'en']),
  hasStepUp: z.boolean(),
});
export type Actor = z.infer<typeof Actor>;

export const JobActor = z.object({ kind: z.literal('job'), jobName: z.string() });
export type JobActor = z.infer<typeof JobActor>;
