// `pnpm dev:worker`: the background process. Runs the outbox relay (contract 2) and the job
// scheduler (US11.5). Locally one process; production runs several (infra Q4).
import { hostname } from 'node:os';
import pg from 'pg';
import {
  CATALOG_RECURRING_JOBS,
  createCatalogWorker,
} from '#src/features/catalog/server/catalog-worker.server.ts';
import { getNotifications } from '#src/features/notifications/server/notifications-instance.server.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { getInstrument } from '#src/features/platform/server/instrument.server.ts';
import { createJobs } from '#src/features/platform/server/jobs.server.ts';
import { outbox } from '#src/features/platform/server/outbox-instance.server.ts';
import { getSettings } from '#src/features/platform/server/settings-instance.server.ts';
import { getEnv } from '#src/lib/env.ts';
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { keyedHash } from '#src/server/crypto.server.ts';
import { closeDb, getDb } from '#src/server/db.ts';
import { registerWorkerConsumers } from './consumers.ts';
import { createJobHandlers, RECURRING_JOBS } from './job-handlers.ts';
import { createRelay } from './relay.ts';

const log = getLogger().child({ component: 'worker' });
const env = getEnv();
const workerId = `${hostname()}:${process.pid}`;
const db = getDb();

const notifications = getNotifications();
registerWorkerConsumers(notifications);
// U2 Catalog: the image visibility consumer, image jobs, moderation signals and retention jobs
// (catalog Steps 46, 50).
const catalogWorker = createCatalogWorker({
  db,
  clock: systemClock,
  metrics,
  hashId: (userId) => keyedHash(env.IDENTIFIER_HASH_KEY, userId),
  notify: (tx, request, correlationId) => notifications.notify(tx, request, correlationId),
  auditRetentionYears: async () => {
    const years = await getSettings().get(U1_SETTINGS.auditRetentionYears);
    return years.ok ? years.value.value : 10;
  },
  schedule: (job) => jobs.schedule(job),
});
catalogWorker.registerConsumers(outbox);

const relay = createRelay({
  db,
  outbox,
  clock: systemClock,
  workerId,
  metrics,
  instrument: getInstrument(),
  // Paging is deferred (human decision 2026-11-13): alerts are structured log events.
  onAlert: (alert) => log.error(alert, 'relay alert'),
});
const jobs = createJobs({
  db,
  clock: systemClock,
  workerId,
  handlers: {
    ...createJobHandlers({ db, clock: systemClock, settings: getSettings() }),
    ...catalogWorker.jobHandlers(),
  },
  metrics,
  onAlert: (alert) => log.error(alert, 'job alert'),
});

const listenClient = new pg.Client({ connectionString: env.DATABASE_URL });
await listenClient.connect();
const stopRelay = await relay.start(listenClient);

let isRunning = true;
const jobLoop = (async () => {
  while (isRunning) {
    try {
      await jobs.ensureRecurring([...RECURRING_JOBS, ...CATALOG_RECURRING_JOBS]);
      await jobs.tick();
      // Push/email/SMS deliveries; each channel retries on its own (BR12.10).
      await notifications.dispatchDue();
    } catch (error) {
      log.error({ err: error, code: 'JOB_TICK_FAILED' }, 'job tick failed; retrying');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})();

log.info({ workerId }, 'worker started: relay and job scheduler running');

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'worker stopping');
  isRunning = false;
  await stopRelay();
  await jobLoop;
  await listenClient.end();
  await closeDb();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
