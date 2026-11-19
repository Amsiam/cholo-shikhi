// [AT] US11.3 Ship features behind flags (written before the flags module exists).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { guard } from '#src/server/fn-core.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createFlags } from './flags.server.ts';

let t: TestDatabase;
let flags: ReturnType<typeof createFlags>;
let adminId: string;
const admin = (): Actor => ({
  userId: adminId,
  roles: ['student', 'admin'],
  locale: 'en',
  hasStepUp: true,
});
const student: Actor = {
  userId: '77777777-7777-4777-8777-777777777777',
  roles: ['student'],
  locale: 'bn',
  hasStepUp: false,
};
const request = new Request('http://localhost:3000/_serverFn/feature', { method: 'POST' });

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised, email_verified, status) VALUES ('flag-admin@example.test', true, 'active') RETURNING user_id",
  );
  adminId = (rows[0] as { user_id: string }).user_id;
  flags = createFlags({
    db: t.db,
    clock: fixedClock('2026-11-13T00:00:00.000Z'),
    metrics: createMetrics(),
    rolesOf: async () => ['student'],
  });
});
afterAll(async () => {
  await t.drop();
});

const featureFn = (isFlagEnabled: (key: string, ctx: { userId?: string }) => Promise<boolean>) =>
  guard(
    {
      access: { kind: 'authed' },
      schema: z.object({}),
      flag: 'appshell.installPrompt',
      handler: async () => ok('feature ran'),
    },
    { request, rawInput: {}, getActor: async () => ok(student), isFlagEnabled },
  );

describe('US11.3 Ship features behind flags', () => {
  it('AC11.3.1 Given a flag that is off, When a function behind it is called, Then it returns FEATURE_DISABLED', async () => {
    const created = await flags.save(
      admin(),
      {
        flagKey: 'appshell.installPrompt',
        description: 'Install prompt',
        state: 'off',
        targetRoles: [],
        targetGoalSegmentIds: [],
        rolloutPercent: 100,
      },
      'corr-flag-1',
    );
    expect(created.ok).toBe(true);
    expect(await featureFn(flags.isEnabled)).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' },
    });
  });

  it('AC11.3.2 Given I toggle a flag on, When the next request arrives, Then the feature is available and the toggle is audit-logged', async () => {
    const current = await flags.get('appshell.installPrompt');
    const saved = await flags.save(
      admin(),
      {
        flagKey: 'appshell.installPrompt',
        description: 'Install prompt',
        state: 'on',
        targetRoles: [],
        targetGoalSegmentIds: [],
        rolloutPercent: 100,
        expectedRevision: current?.revision,
      },
      'corr-flag-2',
    );
    expect(saved.ok).toBe(true);
    expect(await featureFn(flags.isEnabled)).toEqual({ ok: true, value: 'feature ran' });
    const audit = await t.pool.query<{ before: { state: string }; after: { state: string } }>(
      "SELECT before, after FROM audit_log_entry WHERE action = 'platform.flag.changed' AND correlation_id = 'corr-flag-2'",
    );
    expect(audit.rows[0]).toMatchObject({ before: { state: 'off' }, after: { state: 'on' } });
  });

  it('AC11.3.3 Given a non-Admin, When they try to toggle a flag, Then it is refused', async () => {
    const r = await flags.save(
      student,
      {
        flagKey: 'appshell.installPrompt',
        description: 'x',
        state: 'off',
        targetRoles: [],
        targetGoalSegmentIds: [],
        rolloutPercent: 100,
      },
      'c',
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect((await flags.get('appshell.installPrompt'))?.state).toBe('on');
  });
});
