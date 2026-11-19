// [AT] US11.4 Keep a versioned settings registry (written before the settings module exists).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { defineSetting } from '../domain/settings.ts';
import { createSettings } from './settings.server.ts';

// Declared here the way U3 Commerce will declare it (the key is named by AC11.4.1).
const refundWindowDays = defineSetting({
  settingKey: 'subscription.refundWindowDays',
  ownerFeature: 'commerce',
  valueType: 'integer',
  min: 0,
  max: 60,
  unit: 'days',
  scope: 'global',
  blocksWhenUnset: true,
});

let t: TestDatabase;
let settings: ReturnType<typeof createSettings>;
let admin: Actor;
const clock = fixedClock('2026-11-13T00:00:00.000Z');

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised) VALUES ('sa@example.test') RETURNING user_id",
  );
  admin = {
    userId: (rows[0] as { user_id: string }).user_id,
    roles: ['student', 'admin'],
    locale: 'en',
    hasStepUp: true,
  };
  settings = createSettings({ db: t.db, clock, definitions: [refundWindowDays] });
});
afterAll(async () => {
  await t.drop();
});

describe('US11.4 Keep a versioned settings registry', () => {
  it('AC11.4.3 Given a "blocks when unset" setting, When a dependent path reads it unset, Then SETTING_NOT_SET is returned', async () => {
    expect(await settings.get(refundWindowDays)).toMatchObject({
      ok: false,
      error: { code: 'SETTING_NOT_SET' },
    });
  });

  it('AC11.4.1 Given it is not set, When an Admin sets it to 7, Then a new version is stored and audit-logged, and readers get 7', async () => {
    const saved = await settings.save(
      admin,
      { settingKey: 'subscription.refundWindowDays', value: '7', reason: 'Launch policy' },
      'corr-set-1',
    );
    expect(saved).toMatchObject({ ok: true, value: { version: 1 } });
    const read = await settings.get(refundWindowDays);
    expect(read).toMatchObject({ ok: true, value: { value: 7 } });
    const audit = await t.pool.query(
      "SELECT before, after FROM audit_log_entry WHERE action = 'platform.setting.changed' AND correlation_id = 'corr-set-1'",
    );
    expect(audit.rows[0]).toMatchObject({ before: null, after: { value: 7, version: 1 } });
  });

  it('AC11.4.2 Given a value outside its range or of the wrong type, When saved, Then it is refused; Bangla digits are normalised', async () => {
    expect(
      await settings.save(
        admin,
        { settingKey: 'subscription.refundWindowDays', value: '61', reason: 'too long' },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await settings.save(
        admin,
        { settingKey: 'subscription.refundWindowDays', value: 'seven', reason: 'bad type' },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const bangla = await settings.save(
      admin,
      { settingKey: 'subscription.refundWindowDays', value: '১৪', reason: 'বাংলা সংখ্যা' },
      'c',
    );
    expect(bangla).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await settings.get(refundWindowDays)).toMatchObject({ ok: true, value: { value: 14 } });
  });
});
