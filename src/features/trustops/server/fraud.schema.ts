// One schema per fraud review action (A3 forms and the server functions share them).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const FRAUD_KIND = z.enum(['vault_gaming', 'quiz_collusion', 'referral_fraud']);

export const FraudQueueInput = z.object({ kind: FRAUD_KIND.optional() }).default({});
export type FraudQueueInput = z.input<typeof FraudQueueInput>;

export const FlagAccountInput = z.object({
  kind: FRAUD_KIND,
  /** The account's email address or ID. */
  user: z.string().trim().min(3).max(320),
  reason: z.string().max(1000).optional(),
});
export type FlagAccountInput = z.input<typeof FlagAccountInput>;

export const DecideFlagInput = z.object({
  flagId: Id,
  /** `reinstate` reverses a ban (the account's suspension is lifted). */
  action: z.enum(['clear', 'ban', 'reinstate']),
  reason: z.string().max(1000).optional(),
});
export type DecideFlagInput = z.input<typeof DecideFlagInput>;
