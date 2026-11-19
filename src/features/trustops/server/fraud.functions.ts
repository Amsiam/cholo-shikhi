// A3 fraud review server functions: Admins with two-step sign-in only (re-checked in the service).
// Finance cannot flag, clear or ban (AC8.11.3).
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { DecideFlagInput, FlagAccountInput, FraudQueueInput } from './fraud.schema.ts';
import { decideFlag, flagAccount, fraudQueue } from './fraud.server.ts';

export const listFraudQueue = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof FraudQueueInput>())
  .handler(roleFn('admin', FraudQueueInput, async ({ actor, input }) => fraudQueue(actor, input)));

export const flagFraudAccount = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof FlagAccountInput>())
  .handler(
    roleFn('admin', FlagAccountInput, async ({ actor, input, correlationId }) =>
      flagAccount(actor, input, correlationId),
    ),
  );

export const decideFraudFlag = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DecideFlagInput>())
  .handler(
    roleFn('admin', DecideFlagInput, async ({ actor, input, correlationId }) =>
      decideFlag(actor, input, correlationId),
    ),
  );
