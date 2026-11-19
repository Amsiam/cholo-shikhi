import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import type { FlagRole } from '../domain/flags.ts';
import { createFlags, type Flags } from './flags.server.ts';
import { getInstrument } from './instrument.server.ts';

let shared: Flags | undefined;

export function getFlags(): Flags {
  if (!shared) {
    shared = createFlags({
      db: getDb(),
      clock: systemClock,
      metrics,
      instrument: getInstrument(),
      rolesOf: async (userId) => {
        const identity = getIdentity();
        const roles: FlagRole[] = ['student'];
        for (const role of ['instructor', 'admin', 'finance'] as const) {
          if (await identity.hasRole(userId, role)) roles.push(role);
        }
        return roles;
      },
    });
  }
  return shared;
}
