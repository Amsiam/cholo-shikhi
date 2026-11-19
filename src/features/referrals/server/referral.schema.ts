// One schema per referral action, shared by the screens and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const NoInput = z.object({}).default({});
export type NoInput = z.input<typeof NoInput>;

/** A referral link's code (opaque, 10 characters). */
export const ReferralCodeInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{10}$/),
});
export type ReferralCodeInput = z.input<typeof ReferralCodeInput>;

/** The owner-operator's decision on a withdrawal; a rejection needs a reason. */
export const DecideWithdrawalInput = z.object({
  withdrawalId: Id,
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});
export type DecideWithdrawalInput = z.input<typeof DecideWithdrawalInput>;
