// The process-wide IdentityAccess instance, built from the validated environment.

import { createDevMailboxSender } from '#src/features/notifications/server/email-sender.server.ts';
import { getInstrument } from '#src/features/platform/server/instrument.server.ts';
import { getEnv } from '#src/lib/env.ts';
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { createIdentity, type Identity } from './identity.server.ts';

let shared: Identity | undefined;

export function getIdentity(): Identity {
  if (!shared) {
    const env = getEnv();
    const log = getLogger().child({ component: 'email' });
    shared = createIdentity({
      db: getDb(),
      env,
      // EMAIL_TRANSPORT accepts only 'dev-mailbox' until the provider is chosen (plan assumption 2).
      emailSender: createDevMailboxSender(undefined, (message) => log.info(message)),
      clock: systemClock,
      metrics,
      instrument: getInstrument(),
    });
  }
  return shared;
}
