// [LT] Step 17: authoring rate limits at their edges with a controllable clock (NFR6.216, SD-218:
// the 61st write in a minute and the 11th course in a Dhaka day are refused, write nothing and
// say when to retry; Admins are not counted), and the BR6.10 / NFR6.203 refusal log line (IDs
// only, no titles). The service is built directly on a per-file schema with the real U1 audit.
import { randomBytes, randomUUID } from 'node:crypto';
import { domainToASCII } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { type Catalog, createCatalog } from './catalog.server.ts';
import { AUTHORING_WRITES_PER_MINUTE, COURSE_CREATIONS_PER_DHAKA_DAY } from './limits.ts';

let t: TestDatabase;
let goalId: string;
let catalog: Catalog;
const clock = fixedClock('2026-11-16T10:00:00.000Z'); // 16:00 in Dhaka
const lines: Array<Record<string, unknown>> = [];

const instructor = (): Actor => ({
  userId: randomUUID(),
  roles: ['student', 'instructor'],
  locale: 'en',
  hasStepUp: true,
});

beforeAll(async () => {
  t = await createTestDatabase();
  const n = randomBytes(4).toString('hex');
  const segment = await t.pool.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band)
     VALUES ($1, $2, 'academic', $3) RETURNING segment_id`,
    [`সেগমেন্ট ${n}`, `Segment ${n}`, `band_${n}`],
  );
  const goal = await t.pool.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status) VALUES ($1, 'লক্ষ্য', 'Goal', 'active')
     RETURNING goal_id`,
    [segment.rows[0]?.segment_id],
  );
  goalId = goal.rows[0]?.goal_id as string;
  const log = pino({ level: 'info' }, { write: (line: string) => lines.push(JSON.parse(line)) });
  catalog = createCatalog({
    db: t.db,
    clock,
    audit: createAudit({ clock }),
    notify: async () => undefined,
    readPoisha: async () => ok(1),
    hasInstructorRole: async () => true,
    hashId: (userId) => `h-${userId}`,
    outbox: createOutbox({ clock }),
    isFlagEnabled: async () => false,
    trialSegmentsOf: async () => [],
    toAscii: domainToASCII,
    log,
  });
});
afterAll(async () => {
  await t.drop();
});

const create = (actor: Actor, title = 'Course') =>
  catalog.createCourse(actor, { goalId, titleBn: 'কোর্স', titleEn: title }, 'corr-rate');

describe('authoring writes: 60 per minute per instructor', () => {
  it('admits the 60th write, refuses the 61st without writing, and admits again after a minute', async () => {
    const actor = instructor();
    const created = await create(actor);
    if (!created.ok) throw new Error(created.error.code);
    let version = created.value.version;
    // The creation was write 1; writes 2..60 succeed.
    for (let i = 2; i <= AUTHORING_WRITES_PER_MINUTE; i += 1) {
      const set = await catalog.setAccessDuration(
        actor,
        { courseId: created.value.courseId, expectedVersion: version, months: i % 2 === 0 ? 4 : 6 },
        'corr-rate',
      );
      if (!set.ok) throw new Error(`write ${i} refused: ${set.error.code}`);
      version = set.value.version;
    }
    const refused = await catalog.setAccessDuration(
      actor,
      { courseId: created.value.courseId, expectedVersion: version, months: 12 },
      'corr-rate',
    );
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED', i18nKey: 'errors.common.RATE_LIMITED' },
    });
    expect(refused.ok ? 0 : Number(refused.error.details?.retryAfterSeconds)).toBeGreaterThan(0);
    const { rows } = await t.pool.query(
      'SELECT version, access_duration_months FROM course WHERE course_id = $1',
      [created.value.courseId],
    );
    expect(rows[0]).toEqual({ version, access_duration_months: 4 });
    clock.advanceMs(60_000);
    expect(
      (
        await catalog.setAccessDuration(
          actor,
          { courseId: created.value.courseId, expectedVersion: version, months: 12 },
          'corr-rate',
        )
      ).ok,
    ).toBe(true);
  });
});

describe('course creation: 10 per Dhaka calendar day per instructor', () => {
  it('admits the 10th course, refuses the 11th, and admits again on the next Dhaka day', async () => {
    clock.set('2026-11-17T10:00:00.000Z');
    const actor = instructor();
    for (let i = 1; i <= COURSE_CREATIONS_PER_DHAKA_DAY; i += 1) {
      expect((await create(actor, `Course ${i}`)).ok).toBe(true);
    }
    const before = await t.pool.query(
      'SELECT count(*)::int AS n FROM course WHERE created_by = $1',
      [actor.userId],
    );
    expect(await create(actor, 'Course 11')).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    const after = await t.pool.query(
      'SELECT count(*)::int AS n FROM course WHERE created_by = $1',
      [actor.userId],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // 23:59 in Dhaka is still the same day; 00:00 the next day opens a new window.
    clock.set('2026-11-17T17:59:00.000Z');
    expect((await create(actor, 'Course 11')).ok).toBe(false);
    clock.set('2026-11-17T18:00:00.000Z');
    expect((await create(actor, 'Course 11')).ok).toBe(true);
  });

  it('does not count an Admin (who keeps U1 general limit)', async () => {
    clock.set('2026-11-19T04:00:00.000Z');
    const admin: Actor = {
      userId: randomUUID(),
      roles: ['student', 'admin'],
      locale: 'en',
      hasStepUp: true,
    };
    for (let i = 0; i <= COURSE_CREATIONS_PER_DHAKA_DAY; i += 1) {
      expect((await create(admin, `Admin course ${i}`)).ok).toBe(true);
    }
    const { rows } = await t.pool.query(
      'SELECT count(*)::int AS n FROM rate_limit_bucket WHERE bucket_key LIKE $1',
      [`%h-${admin.userId}`],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('keys buckets by a hash of the instructor, never the raw ID', async () => {
    const actor = instructor();
    await create(actor);
    const { rows } = await t.pool.query<{ bucket_key: string }>(
      'SELECT bucket_key FROM rate_limit_bucket WHERE bucket_key LIKE $1',
      [`%${actor.userId}`],
    );
    expect(rows.map((r) => r.bucket_key).sort()).toEqual([
      `catalog.authoring:h-${actor.userId}`,
      `catalog.courseCreate:h-${actor.userId}`,
    ]);
  });
});

describe('refusal logging (BR6.10, NFR6.203)', () => {
  it('logs a FORBIDDEN write as catalog.write_refused with IDs only', async () => {
    clock.set('2026-11-20T04:00:00.000Z');
    const lead = instructor();
    const title = 'Secret Course Title';
    const created = await create(lead, title);
    if (!created.ok) throw new Error(created.error.code);
    const view = await catalog.getCourseForEditing(lead, created.value.courseId);
    if (!view.ok) throw new Error(view.error.code);
    lines.length = 0;
    const co = instructor();
    // A stranger gets NOT_FOUND (an info line); a FORBIDDEN needs a role in the course.
    await catalog.setCoursePrice(
      co,
      { courseId: created.value.courseId, expectedVersion: view.value.course.version, price: '1' },
      'corr-refused',
    );
    expect(lines.at(-1)).toMatchObject({ code: 'NOT_FOUND', operation: 'setCoursePrice' });
    const section = await catalog.addSection(
      lead,
      {
        courseId: created.value.courseId,
        expectedVersion: view.value.course.version,
        titleBn: 'অংশ',
        titleEn: 'Part',
      },
      'corr',
    );
    if (!section.ok) throw new Error(section.error.code);
    const v2 = await catalog.getCourseForEditing(lead, created.value.courseId);
    if (!v2.ok) throw new Error(v2.error.code);
    const target = v2.value.sections[0];
    await catalog.assignSection(
      lead,
      {
        courseId: created.value.courseId,
        sectionId: target?.sectionId as string,
        assigneeId: co.userId,
        expectedOwnershipVersion: target?.ownershipVersion as number,
      },
      'corr',
    );
    lines.length = 0;
    const refused = await catalog.setCoursePrice(
      co,
      { courseId: created.value.courseId, expectedVersion: v2.value.course.version, price: '1' },
      'corr-refused',
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'catalog.write_refused',
      code: 'FORBIDDEN',
      actorId: co.userId,
      courseId: created.value.courseId,
      operation: 'setCoursePrice',
      correlationId: 'corr-refused',
    });
    expect(JSON.stringify(lines)).not.toContain(title);
  });
});
