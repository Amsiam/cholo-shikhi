// Contract 4: identity.AccountCreated v1 (written by the user_account insert trigger, BR2.3).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const AccountCreatedV1 = z.object({
  userId: Id,
  createdAt: z.string(),
  referralCode: z.string().max(32).nullable(),
  deviceFingerprintHash: z.string().length(64).nullable(),
});
export type AccountCreatedV1 = z.infer<typeof AccountCreatedV1>;
