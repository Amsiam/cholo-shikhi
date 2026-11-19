// What the Catalog runs in the worker process (`pnpm dev:worker`): the image visibility consumer and
// the image jobs (Step 46), the OD-207 moderation signals job, and the SD-227 retention jobs, which
// run daily as the catalog_retention role (Step 50, approved by the human on 2026-11-17).
import type { AppError } from '#src/lib/errors.ts';
import type { Json } from '#src/lib/json.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import type { Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';
import {
  type CatalogConsumer,
  createImageVisibility,
  IMAGE_JOBS,
} from './catalog-image-visibility.server.ts';
import { getImageStorage } from './catalog-images-instance.server.ts';
import {
  createModeration,
  MODERATION_JOB,
  type ModerationDeps,
} from './catalog-moderation.server.ts';
import { createCatalogRetention, RETENTION_JOBS } from './catalog-retention.server.ts';

/** Structural twins of Platform's job types (Catalog imports no Platform internals). */
type CatalogJobHandler = (ctx: {
  payload: unknown;
  correlationId: string;
}) => Promise<Result<Json, AppError>>;
type CatalogRecurringJob = { name: string; everyMinutes: number };

export const CATALOG_RECURRING_JOBS: readonly CatalogRecurringJob[] = [
  { name: IMAGE_JOBS.reconcile, everyMinutes: 1 },
  { name: IMAGE_JOBS.orphanSweep, everyMinutes: 24 * 60 },
  { name: MODERATION_JOB, everyMinutes: 5 },
  { name: RETENTION_JOBS.publishedHistory, everyMinutes: 24 * 60 },
  { name: RETENTION_JOBS.discardedDrafts, everyMinutes: 24 * 60 },
];

export function createCatalogWorker(deps: {
  db: Database;
  clock: Clock;
  metrics: Metrics;
  hashId(userId: string): string;
  notify: ModerationDeps['notify'];
  /** Contract 2 setting audit.retentionYears (default 10, never below 10). */
  auditRetentionYears(): Promise<number>;
  schedule(job: {
    name: string;
    runAt: string;
    payload: Json;
    idempotencyKey: string;
  }): Promise<unknown>;
}) {
  const visibility = createImageVisibility({
    db: deps.db,
    clock: deps.clock,
    storage: getImageStorage(),
    log: getLogger().child({ component: 'catalog' }),
    metrics: deps.metrics,
    scheduleApply: async (courseId, eventId) => {
      await deps.schedule({
        name: IMAGE_JOBS.applyVisibility,
        runAt: deps.clock.now(),
        payload: { courseId },
        idempotencyKey: `${IMAGE_JOBS.applyVisibility}:${eventId}`,
      });
    },
  });
  const moderation = createModeration({
    db: deps.db,
    clock: deps.clock,
    log: getLogger().child({ component: 'catalog' }),
    hashId: deps.hashId,
    notify: deps.notify,
  });
  const retention = createCatalogRetention({
    clock: deps.clock,
    storage: getImageStorage(),
    log: getLogger().child({ component: 'catalog' }),
    auditRetentionYears: deps.auditRetentionYears,
  });
  return {
    registerConsumers(outbox: { registerConsumer<P>(consumer: CatalogConsumer<P>): void }): void {
      outbox.registerConsumer(visibility.consumer());
    },
    jobHandlers(): Record<string, CatalogJobHandler> {
      return {
        ...visibility.jobHandlers(),
        ...moderation.jobHandlers(),
        ...retention.jobHandlers(deps.db),
      };
    },
  };
}
