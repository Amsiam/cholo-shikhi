// KYC (I6) and Finance review (A6) server functions. Instructors see and change only their own;
// the queue, decisions and documents are for Finance and Admins.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  KycDecisionInput,
  KycDocumentInput,
  SavePayoutAccountInput,
  SubmitKycInput,
} from './kyc.schema.ts';
import {
  decideKyc,
  getMyKyc,
  kycDocument,
  kycOfInstructor,
  kycQueue,
  savePayoutAccount,
  submitKyc,
} from './kyc.server.ts';

const NoInput = z.object({}).default({});
const FINANCE = ['admin', 'finance'] as const;

export const getMyKycStatus = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('instructor', NoInput, async ({ actor }) => getMyKyc(actor)));

export const submitMyKyc = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SubmitKycInput>())
  .handler(
    roleFn('instructor', SubmitKycInput, async ({ actor, input }) => submitKyc(actor, input)),
  );

export const saveMyPayoutAccount = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePayoutAccountInput>())
  .handler(
    roleFn('instructor', SavePayoutAccountInput, async ({ actor, input, correlationId }) =>
      savePayoutAccount(actor, input, correlationId),
    ),
  );

export const listKycQueue = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(FINANCE, NoInput, async () => kycQueue()));

export const decideKycItem = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof KycDecisionInput>())
  .handler(
    roleFn(FINANCE, KycDecisionInput, async ({ actor, input, correlationId }) =>
      decideKyc(actor, input, correlationId),
    ),
  );

export const getKycDocument = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof KycDocumentInput>())
  .handler(roleFn(FINANCE, KycDocumentInput, async ({ input }) => kycDocument(input)));

const InstructorInput = z.object({ instructorId: z.uuid() });

/** The staff profile page: one instructor's KYC and payout account, masked, for an Admin. */
export const getInstructorKyc = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof InstructorInput>())
  .handler(
    roleFn('admin', InstructorInput, async ({ input }) => kycOfInstructor(input.instructorId)),
  );
