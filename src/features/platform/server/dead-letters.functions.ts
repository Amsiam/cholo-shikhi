import { createServerFn } from '@tanstack/react-start';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  createDeadLetters,
  DeadLetterActionInput,
  DeadLetterListInput,
} from './dead-letters.server.ts';

export const listDeadLetters = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof DeadLetterListInput>())
  .handler(
    roleFn('admin', DeadLetterListInput, ({ actor, input }) =>
      createDeadLetters({ db: getDb(), clock: systemClock }).list(actor, input),
    ),
  );

export const resolveDeadLetter = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DeadLetterActionInput>())
  .handler(
    roleFn('admin', DeadLetterActionInput, ({ actor, input, correlationId }) =>
      createDeadLetters({ db: getDb(), clock: systemClock }).resolve(actor, input, correlationId),
    ),
  );
