// Payout cycle server functions. Finance and Admins run and commit cycles and record failures and
// releases; recording a payment needs the Admin role with two-step sign-in (checked in the service).
// Instructors read only their own cycles and statements.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  CommitCycleInput,
  CycleMonthInput,
  LineRefInput,
  RecordFailureInput,
  RecordPaymentInput,
} from './payouts.schema.ts';
import {
  commitCycle,
  dryRunCycle,
  myCycleStatement,
  myPayoutCycles,
  payoutsOverview,
  recordFailure,
  recordPayment,
  releaseLine,
} from './payouts.server.ts';

const NoInput = z.object({}).default({});
const FINANCE = ['admin', 'finance'] as const;
const STAFF = ['instructor', 'admin'] as const;

export const getPayoutsOverview = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(FINANCE, NoInput, async () => payoutsOverview()));

export const dryRunPayoutCycle = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CycleMonthInput>())
  .handler(roleFn(FINANCE, CycleMonthInput, async ({ input }) => dryRunCycle(input)));

export const commitPayoutCycle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CommitCycleInput>())
  .handler(
    roleFn(FINANCE, CommitCycleInput, async ({ actor, input, correlationId }) =>
      commitCycle(actor, input, correlationId),
    ),
  );

export const recordPayoutPayment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RecordPaymentInput>())
  .handler(
    roleFn('admin', RecordPaymentInput, async ({ actor, input, correlationId }) =>
      recordPayment(actor, input, correlationId),
    ),
  );

export const recordPayoutFailure = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RecordFailureInput>())
  .handler(
    roleFn(FINANCE, RecordFailureInput, async ({ actor, input, correlationId }) =>
      recordFailure(actor, input, correlationId),
    ),
  );

export const releaseHeldPayout = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LineRefInput>())
  .handler(
    roleFn(FINANCE, LineRefInput, async ({ actor, input, correlationId }) =>
      releaseLine(actor, input, correlationId),
    ),
  );

export const getMyPayoutCycles = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => myPayoutCycles(actor)));

export const getMyCycleStatement = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CycleMonthInput>())
  .handler(
    roleFn(STAFF, CycleMonthInput, async ({ actor, input }) => myCycleStatement(actor, input)),
  );
