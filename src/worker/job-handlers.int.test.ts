// [LT] the worker's recurring job handlers run against the database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { createSettings } from '#src/features/platform/server/settings.server.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createJobHandlers, RECURRING_JOBS } from './job-handlers.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

const ctx = {
  jobRunId: '00000000-0000-4000-8000-000000000001',
  payload: {},
  attempt: 1,
  correlationId: 'c',
};

describe('job handlers', () => {
  it('declares the recurring jobs', () => {
    expect(RECURRING_JOBS.map((j) => j.name)).toEqual([
      'platform.auditRetention',
      'platform.renderedRetention',
      'platform.healthProbe',
      'commerce.expireSwitches',
      'commerce.expirePendingPayments',
    ]);
  });

  it('runs audit retention with the configured years (never below 10)', async () => {
    const clock = fixedClock('2026-11-13T00:00:00.000Z');
    const handlers = createJobHandlers({
      db: t.db,
      clock,
      settings: createSettings({ db: t.db, clock, definitions: Object.values(U1_SETTINGS) }),
    });
    const result = await handlers['platform.auditRetention']?.({
      ...ctx,
      jobName: 'platform.auditRetention',
    });
    expect(result).toEqual({ ok: true, value: { dropped: [], retentionYears: 10 } });
  });

  it('purges expired rendered documents', async () => {
    const clock = fixedClock('2026-11-13T00:00:00.000Z');
    const handlers = createJobHandlers({
      db: t.db,
      clock,
      settings: createSettings({ db: t.db, clock, definitions: [] }),
    });
    expect(
      await handlers['platform.renderedRetention']?.({
        ...ctx,
        jobName: 'platform.renderedRetention',
      }),
    ).toEqual({ ok: true, value: { purged: 0 } });
  });
});
