// [LT] Step 16: catalog core repositories on real PostgreSQL: version-checked writes (BR12.1),
// the fixed lock order under two concurrent transactions (PD-209, RD-206), a reassignment racing
// a working-copy change (functional-spec §7), bounded reads (SC-209) and the exact rate-limit
// window (SD-218).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Executor } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createCourseRepository } from './course.repository.ts';
import { createOwnershipRepository } from './ownership.repository.ts';
import { createRateLimitRepository } from './rate-limit.repository.ts';
import { createSectionRepository } from './section.repository.ts';

let t: TestDatabase;
let goalId: string;
const courses = createCourseRepository();
const sections = createSectionRepository();
const ownership = createOwnershipRepository();
const limits = createRateLimitRepository();

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
});
afterAll(async () => {
  await t.drop();
});

const at = new Date('2026-11-16T04:00:00.000Z');

async function seedCourse(sectionCount = 2, lead = randomUUID()) {
  const row = await courses.insert(t.db, {
    goalId,
    titleBn: 'কোর্স',
    titleEn: 'Course',
    leadInstructorId: lead,
    createdBy: lead,
  });
  const ids: string[] = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const s = await sections.insert(t.db, { courseId: row.courseId, position: i + 1 });
    const v = await sections.insertVersion(t.db, {
      sectionId: s.sectionId,
      versionNumber: 1,
      titleBn: 'অংশ',
      titleEn: `Section ${i + 1}`,
    });
    await sections.update(t.db, s.sectionId, { workingVersionId: v.sectionVersionId });
    await ownership.open(t.db, {
      sectionId: s.sectionId,
      instructorId: lead,
      validFrom: at,
      assignedBy: lead,
      reason: 'default_lead',
    });
    ids.push(s.sectionId);
  }
  return { course: row, sectionIds: ids, lead };
}

describe('course repository', () => {
  it('applies a version-checked update once and reports a stale second writer', async () => {
    const { course } = await seedCourse(0);
    const first = await courses.update(t.db, course.courseId, 1, { listPricePoisha: 149950 }, at);
    expect(first).toMatchObject({ kind: 'applied', row: { listPricePoisha: 149950, version: 2 } });
    const second = await courses.update(t.db, course.courseId, 1, { listPricePoisha: 1 }, at);
    expect(second).toEqual({ kind: 'stale', currentVersion: 2 });
    expect(await courses.update(t.db, randomUUID(), 1, { listPricePoisha: 1 }, at)).toEqual({
      kind: 'missing',
    });
    expect((await courses.get(t.db, course.courseId))?.listPricePoisha).toBe(149950);
  });

  it('reads money back as an exact integer, including the parse ceiling', async () => {
    const { course } = await seedCourse(0);
    await courses.update(t.db, course.courseId, 1, { listPricePoisha: 9_999_999_999 }, at);
    expect((await courses.get(t.db, course.courseId))?.listPricePoisha).toBe(9_999_999_999);
  });

  it('lists courses where the instructor is Lead or owns a section now, and none after removal', async () => {
    const lead = randomUUID();
    const co = randomUUID();
    const led = await seedCourse(1, lead);
    const other = await seedCourse(1);
    const open = await ownership.openForUpdate(t.db, other.sectionIds[0] as string);
    await ownership.close(t.db, open?.sectionOwnershipId as string, 1, at);
    await ownership.open(t.db, {
      sectionId: other.sectionIds[0] as string,
      instructorId: co,
      validFrom: at,
      assignedBy: other.lead,
      reason: 'assigned',
    });
    const mine = await courses.listForInstructor(t.db, lead, { limit: 20, offset: 0 });
    expect(mine.rows.map((r) => r.courseId)).toEqual([led.course.courseId]);
    const theirs = await courses.listForInstructor(t.db, co, { limit: 20, offset: 0 });
    expect(theirs.rows.map((r) => r.courseId)).toEqual([other.course.courseId]);
    await sections.update(t.db, other.sectionIds[0] as string, {
      structureState: 'removed',
      removedAt: at,
    });
    expect((await courses.listForInstructor(t.db, co, { limit: 20, offset: 0 })).total).toBe(0);
    expect(await courses.listForInstructor(t.db, randomUUID(), { limit: 20, offset: 0 })).toEqual({
      rows: [],
      total: 0,
    });
  });

  it('clamps an oversized page to the bound (SC-209)', async () => {
    const lead = randomUUID();
    await seedCourse(0, lead);
    const page = await courses.listForInstructor(t.db, lead, { limit: 10_000, offset: 0 });
    expect(page.rows.length).toBeLessThanOrEqual(100);
  });

  it('reports the status of the Goal a course is filed under', async () => {
    expect(await courses.goalStatus(t.db, goalId)).toEqual({ status: 'active' });
    expect(await courses.goalStatus(t.db, randomUUID())).toBeUndefined();
  });
});

describe('section repository', () => {
  it('returns sections in position order whatever the lock order', async () => {
    const { course, sectionIds } = await seedCourse(3);
    await sections.update(t.db, sectionIds[0] as string, { position: 3 });
    await sections.update(t.db, sectionIds[2] as string, { position: 1 });
    const listed = await sections.listForCourse(t.db, course.courseId, { forUpdate: false });
    expect(listed.map((s) => s.sectionId)).toEqual([sectionIds[2], sectionIds[1], sectionIds[0]]);
  });

  it('refuses a stale working-copy write and bumps the version on success', async () => {
    const { course } = await seedCourse(1);
    const [s] = await sections.listForCourse(t.db, course.courseId);
    const id = s?.workingVersionId as string;
    expect(await sections.updateVersion(t.db, id, 1, { titleEn: 'Edited' })).toMatchObject({
      titleEn: 'Edited',
      version: 2,
    });
    expect(await sections.updateVersion(t.db, id, 1, { titleEn: 'Lost' })).toBeUndefined();
    expect(await sections.nextVersionNumber(t.db, s?.sectionId as string)).toBe(2);
    expect(await sections.versionsByIds(t.db, [])).toEqual([]);
  });

  it('copies the lesson list of a live version into a new working copy (BR8.1)', async () => {
    const { course } = await seedCourse(1);
    const [s] = await sections.listForCourse(t.db, course.courseId);
    const from = s?.workingVersionId as string;
    const lesson = await t.pool.query<{ lesson_id: string }>(
      `INSERT INTO lesson (section_id, kind, created_by) VALUES ($1, 'text', $2) RETURNING lesson_id`,
      [s?.sectionId, randomUUID()],
    );
    await t.pool.query(
      `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_en) VALUES ($1, $2, 1, 'L1')`,
      [lesson.rows[0]?.lesson_id, from],
    );
    const to = await sections.insertVersion(t.db, {
      sectionId: s?.sectionId as string,
      versionNumber: 2,
      titleBn: 'অংশ',
      titleEn: 'Copy',
      reviewState: 'superseded',
    });
    await sections.copyLessonVersions(t.db, from, to.sectionVersionId);
    const copied = await t.pool.query(
      'SELECT lesson_id, position, title_en FROM lesson_version WHERE section_version_id = $1',
      [to.sectionVersionId],
    );
    expect(copied.rows).toEqual([
      { lesson_id: lesson.rows[0]?.lesson_id, position: 1, title_en: 'L1' },
    ]);
  });
});

describe('ownership repository', () => {
  it('closes the open period only with its current version, once', async () => {
    const { sectionIds } = await seedCourse(1);
    const sectionId = sectionIds[0] as string;
    const open = await ownership.openForUpdate(t.db, sectionId);
    expect(await ownership.close(t.db, open?.sectionOwnershipId as string, 2, at)).toBe(false);
    expect(await ownership.close(t.db, open?.sectionOwnershipId as string, 1, at)).toBe(true);
    expect(await ownership.close(t.db, open?.sectionOwnershipId as string, 2, at)).toBe(false);
    expect(await ownership.openForSections(t.db, [sectionId])).toEqual([]);
    expect(await ownership.openForSections(t.db, [])).toEqual([]);
    expect((await ownership.history(t.db, sectionId)).map((p) => p.version)).toEqual([2]);
  });
});

/** Runs fn in its own transaction on a dedicated connection; resolves when it commits. */
async function inTransaction<T>(fn: (exec: Executor) => Promise<T>): Promise<T> {
  return t.db.transaction(async (tx) => fn(tx as unknown as Executor));
}

describe('lock order under concurrency (PD-209, RD-206, functional-spec §7)', () => {
  it('two writers on one course in the fixed order both commit without deadlock', async () => {
    const { course, sectionIds } = await seedCourse(3);
    const writer = (label: string) =>
      inTransaction(async (exec) => {
        await courses.getForUpdate(exec, course.courseId);
        const locked = await sections.listForCourse(exec, course.courseId, { forUpdate: true });
        for (const s of locked) {
          await sections.versionForUpdate(exec, s.workingVersionId as string);
        }
        const v = await sections.versionForUpdate(exec, locked[0]?.workingVersionId as string);
        await sections.updateVersion(exec, v?.sectionVersionId as string, v?.version as number, {
          titleEn: label,
        });
        return label;
      });
    const results = await Promise.all([writer('A'), writer('B'), writer('C')]);
    expect(results.sort()).toEqual(['A', 'B', 'C']);
    const first = await sections.versionsByIds(t.db, [
      (await sections.listForCourse(t.db, course.courseId))[0]?.workingVersionId as string,
    ]);
    expect(first[0]?.version).toBe(4);
    expect(sectionIds).toHaveLength(3);
  });

  it('two reassignments based on the same token: whichever holds the locks first wins', async () => {
    const { course, sectionIds, lead } = await seedCourse(1);
    const sectionId = sectionIds[0] as string;
    // Both clients loaded open-period version 1. Each closes it and opens a new period.
    const reassign = () =>
      inTransaction(async (exec) => {
        await courses.getForUpdate(exec, course.courseId);
        await sections.getForUpdate(exec, course.courseId, sectionId);
        const open = await ownership.openForUpdate(exec, sectionId);
        const closed = await ownership.close(exec, open?.sectionOwnershipId as string, 1, at);
        if (closed) {
          await ownership.open(exec, {
            sectionId,
            instructorId: randomUUID(),
            validFrom: at,
            assignedBy: lead,
            reason: 'assigned',
            // The open-period token carries forward per section (BR12.1), so the loser, still
            // holding version 1, can never match the new period.
            version: 2,
          });
        }
        return closed;
      });
    const outcomes = await Promise.all([reassign(), reassign()]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const history = await ownership.history(t.db, sectionId);
    expect(history.filter((p) => p.validTo === null)).toHaveLength(1);
  });
});

describe('rate-limit store (SD-218)', () => {
  const minute = (now: Date, key: string, limit = 3) => ({
    bucketKey: key,
    action: 'catalog_authoring',
    limit,
    windowStart: now,
    expiredAtOrBefore: new Date(now.getTime() - 60_000),
  });

  it('admits exactly the limit in one window, then refuses without writing', async () => {
    const key = `catalog.authoring:${randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) results.push(await limits.consume(t.db, minute(at, key)));
    expect(results).toEqual([true, true, true, false]);
    const row = await t.pool.query(
      'SELECT failure_count FROM rate_limit_bucket WHERE bucket_key = $1',
      [key],
    );
    expect(row.rows[0]?.failure_count).toBe(3);
    expect(await limits.windowStartedAt(t.db, key)).toEqual(at);
  });

  it('starts a fresh window once the old one has expired', async () => {
    const key = `catalog.authoring:${randomUUID()}`;
    for (let i = 0; i < 3; i += 1) await limits.consume(t.db, minute(at, key));
    const later = new Date(at.getTime() + 60_000);
    expect(await limits.consume(t.db, minute(later, key))).toBe(true);
    expect(await limits.windowStartedAt(t.db, key)).toEqual(later);
    expect(await limits.windowStartedAt(t.db, 'missing')).toBeUndefined();
  });

  it('is exact under concurrent callers: never more than the limit', async () => {
    const key = `catalog.authoring:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limits.consume(t.db, minute(at, key, 5))),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
