// One schema per payout action, shared by the Finance screen and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const CycleMonthInput = z.object({ month: Month });
export type CycleMonthInput = z.input<typeof CycleMonthInput>;

export const CommitCycleInput = z.object({
  month: Month,
  /** The dry run's input hash; a commit is refused if the inputs changed since (dry_run_stale). */
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CommitCycleInput = z.input<typeof CommitCycleInput>;

export const RecordPaymentInput = z.object({
  lineId: Id,
  /** The reference bKash, Nagad or the bank gave for this payment. */
  providerRef: z.string().trim().min(3).max(100),
  /** One key per payment attempt, made by the screen; a retry with the same key never pays twice. */
  idempotencyKey: z.string().min(16).max(100),
});
export type RecordPaymentInput = z.input<typeof RecordPaymentInput>;

export const RecordFailureInput = z.object({
  lineId: Id,
  /** Why the payment failed (shown to the instructor); never an account number. */
  note: z.string().trim().min(3).max(300),
});
export type RecordFailureInput = z.input<typeof RecordFailureInput>;

export const LineRefInput = z.object({ lineId: Id });
export type LineRefInput = z.input<typeof LineRefInput>;
