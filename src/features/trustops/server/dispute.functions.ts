// A11 payment dispute server functions: Finance or Admin with two-step sign-in (re-checked in the
// service). Students and Instructors are refused (AC9.4.2).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { DisputeRefInput, ExportDisputeInput, RecordDisputeInput } from './dispute.schema.ts';
import {
  exportDisputePack,
  getDisputePack,
  listDisputes,
  recordDispute,
} from './dispute.server.ts';

const NoInput = z.object({}).default({});
const STAFF = ['admin', 'finance'] as const;

export const listPaymentDisputes = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => listDisputes(actor)));

export const recordPaymentDispute = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RecordDisputeInput>())
  .handler(
    roleFn(STAFF, RecordDisputeInput, async ({ actor, input, correlationId }) =>
      recordDispute(actor, input, correlationId),
    ),
  );

export const getDisputeEvidencePack = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof DisputeRefInput>())
  .handler(
    roleFn(STAFF, DisputeRefInput, async ({ actor, input }) => getDisputePack(actor, input)),
  );

export const exportDisputeEvidencePack = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExportDisputeInput>())
  .handler(
    roleFn(STAFF, ExportDisputeInput, async ({ actor, input, correlationId }) =>
      exportDisputePack(actor, input, correlationId),
    ),
  );
