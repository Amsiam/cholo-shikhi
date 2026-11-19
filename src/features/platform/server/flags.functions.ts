// Admin flag screen (A10) server functions.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { ok } from '#src/lib/result.ts';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { FlagChangeInput } from './flags.schema.ts';
import { getFlags } from './flags-instance.server.ts';

const NoInput = z.object({}).default({});

export const listFlags = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async () => ok(await getFlags().list())));

export const saveFlag = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof FlagChangeInput>())
  .handler(
    roleFn('admin', FlagChangeInput, async ({ actor, input, correlationId }) =>
      getFlags().save(actor, input, correlationId),
    ),
  );
