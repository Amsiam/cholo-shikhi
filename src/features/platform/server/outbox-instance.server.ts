// The process-wide outbox. Consuming features register on it at start-up (contract 2).
import { systemClock } from '#src/lib/time.ts';
import { createOutbox, type Outbox } from './outbox.server.ts';

export const outbox: Outbox = createOutbox({ clock: systemClock });
