// [LT] Steps 46 and 50: the worker wiring of the Catalog (consumer, job handlers, recurring jobs),
// including the retention jobs that run as catalog_retention (approved by the human on 2026-11-17).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { CATALOG_RECURRING_JOBS, createCatalogWorker } from './catalog-worker.server.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('createCatalogWorker', () => {
  const clock = fixedClock('2026-11-17T00:00:00.000Z');
  const scheduled: Array<{ name: string; idempotencyKey: string }> = [];
  const build = () =>
    createCatalogWorker({
      db: t.db,
      clock,
      metrics: createMetrics(),
      hashId: (userId) => `h:${userId}`,
      notify: async () => undefined,
      auditRetentionYears: async () => 10,
      schedule: async (job) => {
        scheduled.push(job);
      },
    });

  it('registers the catalog.imageVisibility consumer for ContentVisibilityChanged v1', () => {
    const outbox = createOutbox({ clock });
    build().registerConsumers(outbox);
    expect(
      outbox.consumersFor('catalog.ContentVisibilityChanged', 1).map((c) => c.consumerName),
    ).toEqual(['catalog.imageVisibility']);
    expect(() => build().registerConsumers(outbox)).toThrow();
  });

  it('declares the image, moderation and retention jobs with their schedules', () => {
    expect(Object.keys(build().jobHandlers()).sort()).toEqual([
      'catalog.image.applyVisibility',
      'catalog.image.orphanSweep',
      'catalog.image.reconcile',
      'catalog.moderation.signals',
      'catalog.retention.discardedDrafts',
      'catalog.retention.publishedHistory',
    ]);
    expect(CATALOG_RECURRING_JOBS).toEqual([
      { name: 'catalog.image.reconcile', everyMinutes: 1 },
      { name: 'catalog.image.orphanSweep', everyMinutes: 1440 },
      { name: 'catalog.moderation.signals', everyMinutes: 5 },
      { name: 'catalog.retention.publishedHistory', everyMinutes: 1440 },
      { name: 'catalog.retention.discardedDrafts', everyMinutes: 1440 },
    ]);
  });

  it('runs both retention jobs as catalog_retention against an empty catalog (Step 50)', async () => {
    const handlers = build().jobHandlers();
    expect(
      await handlers['catalog.retention.publishedHistory']?.(
        ctx('catalog.retention.publishedHistory'),
      ),
    ).toEqual({ ok: true, value: { courses: 0, rows: 0 } });
    expect(
      await handlers['catalog.retention.discardedDrafts']?.(
        ctx('catalog.retention.discardedDrafts'),
      ),
    ).toEqual({ ok: true, value: { drafts: 0, rows: 0, images: 0 } });
  });

  it('runs the reconciler and the sweep as jobs against an empty catalog', async () => {
    const handlers = build().jobHandlers();
    expect(await handlers['catalog.image.reconcile']?.(ctx('catalog.image.reconcile'))).toEqual({
      ok: true,
      value: { applied: 0 },
    });
    expect(await handlers['catalog.image.orphanSweep']?.(ctx('catalog.image.orphanSweep'))).toEqual(
      {
        ok: true,
        value: { deleted: 0 },
      },
    );
  });
});

function ctx(jobName: string) {
  return {
    jobRunId: '00000000-0000-4000-8000-000000000001',
    jobName,
    payload: {},
    attempt: 1,
    correlationId: 'c',
  };
}
