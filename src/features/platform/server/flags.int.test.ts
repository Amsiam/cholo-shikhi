// [LT] flags service: stale revisions, validation, role resolution from the userId (BR8.7, BR8.8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createFlags } from './flags.server.ts';

let t: TestDatabase;
let flags: ReturnType<typeof createFlags>;
let admin: Actor;
const instructorId = '88888888-8888-4888-8888-888888888888';

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised) VALUES ('fa@example.test') RETURNING user_id",
  );
  admin = {
    userId: (rows[0] as { user_id: string }).user_id,
    roles: ['student', 'admin'],
    locale: 'en',
    hasStepUp: true,
  };
  flags = createFlags({
    db: t.db,
    clock: fixedClock('2026-11-13T00:00:00.000Z'),
    metrics: createMetrics(),
    rolesOf: async (userId) => (userId === instructorId ? ['student', 'instructor'] : ['student']),
  });
});
afterAll(async () => {
  await t.drop();
});

const input = {
  flagKey: 'live.quizOverlay',
  description: 'Overlay',
  state: 'targeted' as const,
  targetRoles: ['instructor' as const],
  targetGoalSegmentIds: [],
  rolloutPercent: 100,
};

describe('flags service', () => {
  it('resolves roles from the userId for role targeting (BR8.8)', async () => {
    await flags.save(admin, input, 'c1');
    expect(await flags.isEnabled('live.quizOverlay', { userId: instructorId })).toBe(true);
    expect(
      await flags.isEnabled('live.quizOverlay', { userId: '99999999-9999-4999-8999-999999999999' }),
    ).toBe(false);
    expect(await flags.isEnabled('live.quizOverlay')).toBe(false);
  });
  it('refuses a stale or missing revision with CONFLICT', async () => {
    expect(await flags.save(admin, { ...input, state: 'off' }, 'c2')).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(
      await flags.save(admin, { ...input, state: 'off', expectedRevision: 7 }, 'c3'),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const saved = await flags.save(admin, { ...input, state: 'off', expectedRevision: 1 }, 'c4');
    expect(saved).toMatchObject({ ok: true, value: { revision: 2, state: 'off' } });
  });
  it('validates BR8.7 restrictions and refuses admins without two-step', async () => {
    expect(
      await flags.save(
        admin,
        { ...input, flagKey: 'x.y', targetRoles: [], rolloutPercent: 100 },
        'c5',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await flags.save(admin, { ...input, flagKey: 'Bad Key' }, 'c6')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(await flags.save({ ...admin, hasStepUp: false }, input, 'c7')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it('lists flags', async () => {
    expect((await flags.list()).map((f) => f.flagKey)).toContain('live.quizOverlay');
  });
});
