// One schema per HR read and write (A7/A8 forms and the server functions share them). Money is
// integer poisha and shares are basis points; the domain re-checks both.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const NoInput = z.object({}).default({});

export const FindInstructorInput = z.object({ instructor: z.string().trim().min(3).max(320) });
export type FindInstructorInput = z.input<typeof FindInstructorInput>;

export const InstructorRefInput = z.object({ instructorId: Id });
export type InstructorRefInput = z.input<typeof InstructorRefInput>;

export const SavePolicyInput = z.object({
  instructorId: Id,
  kind: z.enum(['revenue_share', 'salary', 'per_piece', 'hybrid']),
  shareBps: z.number().optional(),
  salaryPoisha: z.number().optional(),
  perPiecePoisha: z.number().optional(),
});
export type SavePolicyInput = z.input<typeof SavePolicyInput>;

export const SaveRecordInput = z.object({
  instructorId: Id,
  salaryPoisha: z.number().nullable().optional(),
  joinedOn: Day.nullable().optional(),
  exitOn: Day.nullable().optional(),
  leaveBalanceDays: z.number().int().min(0).max(366).optional(),
});
export type SaveRecordInput = z.input<typeof SaveRecordInput>;

export const RecordLeaveInput = z.object({
  instructorId: Id,
  kind: z.enum(['leave', 'absence']),
  startsOn: Day,
  endsOn: Day,
  note: z.string().trim().max(500).optional(),
});
export type RecordLeaveInput = z.input<typeof RecordLeaveInput>;
