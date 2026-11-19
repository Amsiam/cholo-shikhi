// [LT] Step 27: the catalog.publishedCourse reference validator (UC23; BR4.9; foundation CR-3),
// registered through U1's existing settings port. A trial-policy save that names a draft course is
// refused with VALIDATION_FAILED on the trialCourseId field; a published course is accepted. This
// completes U1's Deferred AC2.23.1 and AC2.23.2 on the U2 side. trial.policy itself is declared by
// the unit that owns trials, so the test declares the same shape locally.
import { randomUUID } from 'node:crypto';
import { domainToASCII } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '#src/features/identity-access/index.ts';
import { createAudit, defineSetting } from '#src/features/platform/index.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createSettings } from '#src/features/platform/server/settings.server.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { type Catalog, createCatalog } from './catalog.server.ts';
import { PUBLISHED_COURSE_VALIDATOR, registerCatalogWithPlatform } from './register.server.ts';

const trialPolicy = defineSetting({
  settingKey: 'trial.policy',
  ownerFeature: 'commerce',
  valueType: 'record',
  scope: 'goal_segment',
  blocksWhenUnset: true,
  recordFields: [
    { name: 'trialCourseId', type: 'string', referenceValidator: PUBLISHED_COURSE_VALIDATOR },
  ],
});

let t: TestDatabase;
let catalog: Catalog;
let settings: ReturnType<typeof createSettings>;
let admin: Actor;
let draftId: string;
let publishedId: string;
const clock = fixedClock('2026-11-16T06:00:00.000Z');

beforeAll(async () => {
  t = await createTestDatabase();
  const { rows } = await t.pool.query<{ user_id: string }>(
    "INSERT INTO user_account (email_normalised) VALUES ('trial-admin@example.test') RETURNING user_id",
  );
  admin = {
    userId: rows[0]?.user_id as string,
    roles: ['student', 'admin'],
    locale: 'en',
    hasStepUp: true,
  };
  catalog = createCatalog({
    db: t.db,
    clock,
    audit: createAudit({ clock }),
    notify: async () => undefined,
    readPoisha: async () => ok(1),
    hasInstructorRole: async () => true,
    hashId: (id) => `h-${id}`,
    outbox: createOutbox({ clock }),
    isFlagEnabled: async () => false,
    trialSegmentsOf: async () => [],
    toAscii: domainToASCII,
    log: pino({ level: 'silent' }),
  });
  settings = createSettings({ db: t.db, clock, definitions: [trialPolicy] });
  const segment = await t.pool.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band, sort_order)
     VALUES ('বিসিএস ট্রায়াল', 'BCS trial', 'job_aspirant', 'bcs_trial', 1) RETURNING segment_id`,
  );
  const goal = await t.pool.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status, sort_order)
     VALUES ($1, 'বিসিএস প্রিলি', 'BCS Prelim', 'active', 1) RETURNING goal_id`,
    [segment.rows[0]?.segment_id],
  );
  const insert = (status: string) =>
    t.pool.query<{ course_id: string }>(
      `INSERT INTO course (goal_id, title_bn, title_en, status, created_by, first_published_at)
       VALUES ($1, 'কোর্স', 'Course', $2, $3, ${status === 'published' ? 'now()' : 'NULL'}) RETURNING course_id`,
      [goal.rows[0]?.goal_id, status, admin.userId],
    );
  draftId = (await insert('draft')).rows[0]?.course_id as string;
  publishedId = (await insert('published')).rows[0]?.course_id as string;
});
afterAll(async () => {
  await t.drop();
});

const save = (trialCourseId: string) =>
  settings.save(
    admin,
    {
      settingKey: 'trial.policy',
      scopeKey: 'segment-bcs',
      value: { trialCourseId },
      reason: 'trial course',
    },
    'corr-trial',
  );

describe('catalog.publishedCourse (BR4.9)', () => {
  it('before registration, a trial.policy save fails closed (validator unavailable)', async () => {
    expect(await save(publishedId)).toMatchObject({
      ok: false,
      error: { code: 'SETTING_VALIDATOR_UNAVAILABLE' },
    });
  });

  it('AC2.23.1 a trial.policy naming a draft course is refused on the trialCourseId field', async () => {
    registerCatalogWithPlatform(settings, catalog);
    expect(await save(draftId)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { 'value.trialCourseId': ['errors.validation.reference'] },
      },
    });
  });

  it('AC2.23.2 a trial.policy naming a published course is accepted and versioned', async () => {
    expect((await save(publishedId)).ok).toBe(true);
    expect(await settings.get(trialPolicy, 'segment-bcs')).toMatchObject({
      ok: true,
      value: { value: { trialCourseId: publishedId } },
    });
  });

  it('refuses a malformed ID and an unknown course; checks the status at save time', async () => {
    for (const value of ['not-an-id', randomUUID()]) {
      expect((await save(value)).ok).toBe(false);
    }
    expect(await catalog.isPublishedCourse(42)).toBe(false);
    await t.pool.query(`UPDATE course SET status = 'retired' WHERE course_id = $1`, [publishedId]);
    expect((await save(publishedId)).ok).toBe(false);
    await t.pool.query(`UPDATE course SET status = 'published' WHERE course_id = $1`, [
      publishedId,
    ]);
  });

  it('a failing registration throws instead of leaving the instance half-ready (RD-208)', () => {
    const broken = {
      registerReferenceValidator: vi.fn(() => {
        throw new Error('port unavailable');
      }),
    };
    expect(() => registerCatalogWithPlatform(broken, catalog)).toThrow('port unavailable');
  });
});
