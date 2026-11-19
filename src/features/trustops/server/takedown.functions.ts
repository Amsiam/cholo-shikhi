// A11 copyright takedown server functions: Admins with two-step sign-in (re-checked in the service).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { DecideTakedownInput, LogTakedownInput, TargetsInput } from './takedown.schema.ts';
import { decideTakedown, listTakedowns, logTakedown, takedownTargets } from './takedown.server.ts';

const NoInput = z.object({}).default({});

export const listTakedownNotices = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => listTakedowns(actor)));

export const getTakedownTargets = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof TargetsInput>())
  .handler(
    roleFn('admin', TargetsInput, async ({ actor, input }) => takedownTargets(actor, input)),
  );

export const logTakedownNotice = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LogTakedownInput>())
  .handler(
    roleFn('admin', LogTakedownInput, async ({ actor, input, correlationId }) =>
      logTakedown(actor, input, correlationId),
    ),
  );

export const decideTakedownNotice = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DecideTakedownInput>())
  .handler(
    roleFn('admin', DecideTakedownInput, async ({ actor, input, correlationId }) =>
      decideTakedown(actor, input, correlationId),
    ),
  );
