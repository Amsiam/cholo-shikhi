// One schema per dispute action (A11 forms and the server functions share them).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const RecordDisputeInput = z.object({
  paymentId: Id,
  gatewayCaseRef: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(10).max(1000),
});
export type RecordDisputeInput = z.input<typeof RecordDisputeInput>;

export const DisputeRefInput = z.object({ disputeId: Id });
export type DisputeRefInput = z.input<typeof DisputeRefInput>;

export const ExportDisputeInput = z.object({
  disputeId: Id,
  format: z.enum(['pdf', 'csv']),
  locale: z.enum(['bn', 'en']),
});
export type ExportDisputeInput = z.input<typeof ExportDisputeInput>;
