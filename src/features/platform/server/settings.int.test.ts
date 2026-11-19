// [LT] settings service: defaults, versioning, step-up, scope, reference validators (BR9.9).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { DEFAULT_SETTING_VERSION_ID, defineSetting } from '../domain/settings.ts';
import { U1_SETTINGS } from '../domain/u1-settings.ts';
import { createSettings } from './settings.server.ts';

const trialCourse = defineSetting({
  settingKey: 'trial.courseId',
  ownerFeature: 'catalog',
  valueType: 'string',
  scope: 'goal_segment',
  blocksWhenUnset: true,
  referenceValidator: 'catalog.publishedCourse',
});

let t: TestDatabase;
let settings: ReturnType<typeof createSettings>;
let admin: Actor;
const clock = fixedClock('2026-11-13T00:00:00.000Z');

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised) VALUES ('si@example.test') RETURNING user_id",
  );
  admin = {
    userId: (rows[0] as { user_id: string }).user_id,
    roles: ['student', 'admin'],
    locale: 'en',
    hasStepUp: true,
  };
  settings = createSettings({
    db: t.db,
    clock,
    definitions: [...Object.values(U1_SETTINGS), trialCourse],
  });
});
afterAll(async () => {
  await t.drop();
});

describe('settings service', () => {
  it('returns a declared default (SMS off) with the default marker', async () => {
    expect(await settings.get(U1_SETTINGS.smsEnabled)).toEqual({
      ok: true,
      value: { value: false, settingVersionId: DEFAULT_SETTING_VERSION_ID },
    });
  });
  it('refuses an undeclared key on read and on save (BR9.1)', async () => {
    const ghost = { ...U1_SETTINGS.smsEnabled, settingKey: 'ghost.key' };
    expect((await settings.get(ghost)).ok).toBe(false);
    expect(
      await settings.save(admin, { settingKey: 'ghost.key', value: true, reason: 'nope' }, 'c'),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('requires Admin with two-step (BR9.6)', async () => {
    expect(
      await settings.save(
        { ...admin, hasStepUp: false },
        { settingKey: 'notifications.smsEnabled', value: true, reason: 'on' },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
  it('stores each save as a new immutable version and honours a future effectiveFrom', async () => {
    await settings.save(
      admin,
      { settingKey: 'notifications.maxAttempts', value: 6, reason: 'first' },
      'c',
    );
    await settings.save(
      admin,
      {
        settingKey: 'notifications.maxAttempts',
        value: 8,
        reason: 'later',
        effectiveFrom: '2026-12-01T00:00:00.000Z',
      },
      'c',
    );
    expect(await settings.get(U1_SETTINGS.notificationMaxAttempts)).toMatchObject({
      ok: true,
      value: { value: 6 },
    });
    clock.set('2026-12-02T00:00:00.000Z');
    expect(await settings.get(U1_SETTINGS.notificationMaxAttempts)).toMatchObject({
      ok: true,
      value: { value: 8 },
    });
    clock.set('2026-11-13T00:00:00.000Z');
    expect(
      await settings.save(
        admin,
        {
          settingKey: 'notifications.maxAttempts',
          value: 7,
          reason: 'past',
          effectiveFrom: '2020-01-01T00:00:00.000Z',
        },
        'c',
      ),
    ).toMatchObject({ ok: false });
  });
  it('refuses a segment scope on a global setting', async () => {
    expect(
      await settings.save(
        admin,
        {
          settingKey: 'notifications.smsEnabled',
          scopeKey: 'seg-a',
          value: true,
          reason: 'scoped',
        },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
  it('refuses a save needing an unregistered reference validator, then uses it once registered (BR9.9)', async () => {
    const input = {
      settingKey: 'trial.courseId',
      scopeKey: 'seg-bcs',
      value: 'course-1',
      reason: 'trial course',
    };
    expect(await settings.save(admin, input, 'c')).toMatchObject({
      ok: false,
      error: { code: 'SETTING_VALIDATOR_UNAVAILABLE' },
    });
    settings.registerReferenceValidator(
      'catalog.publishedCourse',
      async (value) => value === 'course-1',
    );
    expect((await settings.save(admin, input, 'c')).ok).toBe(true);
    expect(await settings.save(admin, { ...input, value: 'draft-course' }, 'c')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(await settings.get(trialCourse, 'seg-bcs')).toMatchObject({
      ok: true,
      value: { value: 'course-1' },
    });
  });
});
