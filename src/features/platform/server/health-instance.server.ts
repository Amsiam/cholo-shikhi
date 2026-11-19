import { getEnv } from '#src/lib/env.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { createValkey, pingValkey, type ValkeyClient } from '#src/server/valkey.server.ts';
import { createOutboxRepository } from '../data/outbox.repository.ts';
import { createHealth } from './health.server.ts';

let valkey: ValkeyClient | undefined;
let shared: ReturnType<typeof createHealth> | undefined;

export function getHealth(): ReturnType<typeof createHealth> {
  if (!shared) {
    const db = getDb();
    const outboxRepo = createOutboxRepository();
    shared = createHealth({
      db,
      clock: systemClock,
      metrics,
      pingValkey: async () => {
        valkey ??= createValkey(getEnv().VALKEY_URL, { lazyConnect: true });
        return pingValkey(valkey);
      },
      relayBacklogSeconds: async () => {
        const oldest = await outboxRepo.oldestWaiting(db);
        return oldest ? (Date.now() - oldest.getTime()) / 1000 : 0;
      },
    });
  }
  return shared;
}
