// One schema per KYC mutation, shared by the forms and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

/** A photo as base64 (the phone shrinks it first); at most 2 MB once decoded. */
const Photo = z.string().min(100).max(2_900_000);

export const SubmitKycInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  nidNumber: z.string().trim().min(1).max(30),
  front: Photo,
  back: Photo,
});
export type SubmitKycInput = z.input<typeof SubmitKycInput>;

export const SavePayoutAccountInput = z.object({
  rail: z.enum(['bkash', 'nagad', 'bank']),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(1).max(40),
  bankName: z.string().trim().min(2).max(120).optional(),
  branchName: z.string().trim().min(2).max(120).optional(),
  routingNumber: z.string().trim().min(1).max(15).optional(),
});
export type SavePayoutAccountInput = z.input<typeof SavePayoutAccountInput>;

export const KycDecisionInput = z.object({
  kind: z.enum(['kyc', 'account']),
  id: Id,
  decision: z.enum(['approve', 'reject']),
  /** Required for a rejection: shown to the instructor. */
  reason: z.string().trim().min(3).max(500).optional(),
});
export type KycDecisionInput = z.input<typeof KycDecisionInput>;

export const KycDocumentInput = z.object({ submissionId: Id, side: z.enum(['front', 'back']) });
export type KycDocumentInput = z.input<typeof KycDocumentInput>;
