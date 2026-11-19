// [LT] Step 50 (approved by the human on 2026-11-17): SD-227 retention on real PostgreSQL, with the
// catalog_retention role and grants of migration 0009. This file checks:
// - eligibility: only rows past their cutoff, not referenced by a live product or (by default) a
//   payout period, are selected (NFR10.201, NFR10.202);
// - the application role cannot purge: the immutability triggers refuse it (NFR6.206, SD-207);
// - end to end, catalog_retention purges exactly the eligible rows, review history included (R-05);
// - catalog_retention holds least privilege: no update of the review history, no other table.
import { randomBytes, randomUUID } from 'node:crypto';
import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '#src/lib/logger.ts';
import { fixedClock } from '#src/lib/time.ts';
import { unwrapTx, withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import {
  createCatalogRetention,
  RETENTION_JOBS,
  withRetentionRole,
} from './catalog-retention.server.ts';
import { createMemoryImageStorage } from './image-ports.server.ts';

let t: TestDatabase;
let goalId: string;
const NOW = '2037-06-01T00:00:00.000Z';
const clock = fixedClock(NOW);

beforeAll(async () => {
  t = await createTestDatabase();
  const n = randomBytes(4).toString('hex');
  const segment = await t.pool.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band)
     VALUES ($1, $2, 'academic', $3) RETURNING segment_id`,
    [`সেগমেন্ট ${n}`, `Segment ${n}`, `band_${n}`],
  );
  const goal = await t.pool.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status) VALUES ($1, $2, $2, 'active') RETURNING goal_id`,
    [segment.rows[0]?.segment_id, `Goal ${n}`],
  );
  goalId = goal.rows[0]?.goal_id as string;
});
afterAll(async () => {
  await t.drop();
});

const one = async <T>(text: string, values: unknown[]) =>
  (await t.pool.query(text, values)).rows[0] as T;

/** A course with one section whose published version has a lesson, a review row and a period. */
async function course(status: 'retired' | 'published', retiredAt: string | null) {
  const { course_id: courseId } = await one<{ course_id: string }>(
    `INSERT INTO course (goal_id, title_bn, title_en, created_by, status, retired_at)
     VALUES ($1, 'কোর্স', 'Course', $2, $3, $4) RETURNING course_id`,
    [goalId, randomUUID(), status, retiredAt],
  );
  const { section_id: sectionId } = await one<{ section_id: string }>(
    'INSERT INTO section (course_id, position) VALUES ($1, 1) RETURNING section_id',
    [courseId],
  );
  const { section_version_id: versionId } = await one<{ section_version_id: string }>(
    `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state, published_at)
     VALUES ($1, 1, 'অংশ', 'Section', 'published', '2020-01-01T00:00:00Z') RETURNING section_version_id`,
    [sectionId],
  );
  const { lesson_id: lessonId } = await one<{ lesson_id: string }>(
    `INSERT INTO lesson (section_id, kind, created_by) VALUES ($1, 'text', $2) RETURNING lesson_id`,
    [sectionId, randomUUID()],
  );
  await t.pool.query(
    `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_en) VALUES ($1, $2, 1, 'Lesson')`,
    [lessonId, versionId],
  );
  await t.pool.query(
    `INSERT INTO ownership_period (section_id, instructor_id, valid_from, valid_to, assigned_by, reason)
     VALUES ($1, $2, '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z', $3, 'default_lead')`,
    [sectionId, randomUUID(), randomUUID()],
  );
  await t.pool.query(
    `INSERT INTO section_review (section_id, section_version_id, action, from_state, to_state, actor_id, comment, decided_at)
     VALUES ($1, $2, 'approved', 'in_review', 'approved', $3, 'ঠিক আছে', '2020-01-01T00:00:00Z')`,
    [sectionId, versionId, randomUUID()],
  );
  return { courseId, sectionId, versionId };
}

/** A never-published working copy discarded at `discardedAt`. */
async function discardedDraft(discardedAt: string, publishedAt: string | null = null) {
  const { courseId } = await course('published', null);
  const { section_id: sectionId } = await one<{ section_id: string }>(
    'INSERT INTO section (course_id, position) VALUES ($1, 2) RETURNING section_id',
    [courseId],
  );
  const { section_version_id: versionId } = await one<{ section_version_id: string }>(
    `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state, published_at)
     VALUES ($1, 1, 'খসড়া', 'Draft', 'discarded', $2) RETURNING section_version_id`,
    [sectionId, publishedAt],
  );
  await t.pool.query(
    `INSERT INTO section_review (section_id, section_version_id, action, from_state, to_state, actor_id, comment, decided_at)
     VALUES ($1, $2, 'discarded', 'draft', 'discarded', $3, NULL, $4)`,
    [sectionId, versionId, randomUUID(), discardedAt],
  );
  return versionId;
}

async function inPublishedPlan(courseId: string) {
  const { plan_id: planId } = await one<{ plan_id: string }>(
    `INSERT INTO subscription_plan (goal_id, name_bn, name_en, created_by) VALUES ($1, 'প্ল্যান', 'Plan', $2) RETURNING plan_id`,
    [goalId, randomUUID()],
  );
  const { plan_version_id: versionId } = await one<{ plan_version_id: string }>(
    `INSERT INTO subscription_plan_version (plan_id, version_number, monthly_price_poisha, published_at, published_by)
     VALUES ($1, 1, 50000, now(), $2) RETURNING plan_version_id`,
    [planId, randomUUID()],
  );
  await t.pool.query(
    `INSERT INTO subscription_plan_version_item (plan_version_id, item_type, course_id) VALUES ($1, 'course', $2)`,
    [versionId, courseId],
  );
  await t.pool.query(
    `UPDATE subscription_plan SET status = 'published', current_version_id = $2 WHERE plan_id = $1`,
    [planId, versionId],
  );
}

const retention = (
  overrides: { auditYears?: number; payouts?: (courseId: string) => Promise<boolean> } = {},
) =>
  createCatalogRetention({
    clock,
    storage: createMemoryImageStorage(clock),
    log: createLogger({ level: 'silent' }),
    auditRetentionYears: async () => overrides.auditYears ?? 10,
    ...(overrides.payouts ? { isReferencedByPayouts: overrides.payouts } : {}),
  });

const noPayouts = async () => false;

describe('catalog.retention.publishedHistory eligibility (NFR10.201)', () => {
  it('selects a course retired more than 10 years ago and nothing younger', async () => {
    const old = await course('retired', '2027-05-01T00:00:00Z');
    const young = await course('retired', '2028-01-01T00:00:00Z');
    const live = await course('published', null);
    const due = await retention({ payouts: noPayouts }).dueCourses(t.db);
    expect(due).toContain(old.courseId);
    expect(due).not.toContain(young.courseId);
    expect(due).not.toContain(live.courseId);
  });

  it('waits for audit.retentionYears when it is longer than 10', async () => {
    const old = await course('retired', '2026-01-01T00:00:00Z');
    expect(await retention({ payouts: noPayouts, auditYears: 12 }).dueCourses(t.db)).not.toContain(
      old.courseId,
    );
  });

  it('keeps a course a live plan refers to', async () => {
    const old = await course('retired', '2025-01-01T00:00:00Z');
    await inPublishedPlan(old.courseId);
    expect(await retention({ payouts: noPayouts }).dueCourses(t.db)).not.toContain(old.courseId);
  });

  it('keeps everything while the U9 payout port is missing (fail closed)', async () => {
    await course('retired', '2020-01-01T00:00:00Z');
    expect(await retention().dueCourses(t.db)).toEqual([]);
  });
});

describe('catalog.retention.discardedDrafts eligibility (NFR10.202)', () => {
  it('selects a never-published draft discarded over a year ago, not a recent or published one', async () => {
    const old = await discardedDraft('2036-05-01T00:00:00Z');
    const recent = await discardedDraft('2036-12-01T00:00:00Z');
    const wasPublished = await discardedDraft('2035-01-01T00:00:00Z', '2034-01-01T00:00:00Z');
    const due = await retention().dueDrafts(t.db);
    expect(due).toContain(old);
    expect(due).not.toContain(recent);
    expect(due).not.toContain(wasPublished);
  });
});

describe('the purge as the application role (NFR6.206, SD-207)', () => {
  it('is refused by the immutability triggers and deletes nothing', async () => {
    const old = await course('retired', '2026-01-01T00:00:00Z');
    const before = await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM section_version WHERE section_id = $1',
      [old.sectionId],
    );
    await expect(
      withTransaction(t.db, (tx) =>
        retention({ payouts: noPayouts }).purgePublishedHistory(unwrapTx(tx)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    const after = await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM section_version WHERE section_id = $1',
      [old.sectionId],
    );
    expect(after.n).toBe(before.n);
  });

  it('cannot purge a discarded draft or its review history either', async () => {
    await discardedDraft('2035-02-01T00:00:00Z');
    await expect(
      withTransaction(t.db, (tx) => retention().purgeDiscardedDrafts(unwrapTx(tx))),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

/** An inline image row uploaded at `createdAt` (no lesson version refers to it). */
async function inlineImage(createdAt: string) {
  const { courseId } = await course('published', null);
  const storageKey = `img/${randomBytes(16).toString('base64url')}`;
  const { image_id: imageId } = await one<{ image_id: string }>(
    `INSERT INTO catalog_image (course_id, kind, storage_key, variant_widths, width, height, uploaded_by, created_at)
     VALUES ($1, 'inline', $2, '{400}', 400, 300, $3, $4) RETURNING image_id`,
    [courseId, storageKey, randomUUID(), createdAt],
  );
  return { imageId, storageKey };
}

const count = async (table: string, column: string, id: string) =>
  (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id]))
    .n;

describe('the purge as catalog_retention, end to end (R-05, SD-227)', () => {
  it('the role exists and cannot sign in (migration 0009 creates it NOLOGIN where Ansible has not)', async () => {
    const role = await one<{ rolcanlogin: boolean } | undefined>(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'catalog_retention'`,
      [],
    );
    expect(role).toEqual({ rolcanlogin: false });
  });

  it('deletes the whole published history of a due course and keeps every other course', async () => {
    const due = await course('retired', '2026-03-01T00:00:00Z');
    const young = await course('retired', '2030-01-01T00:00:00Z');
    const result = await withRetentionRole(t.db, (exec) =>
      retention({ payouts: noPayouts }).purgePublishedHistory(exec),
    );
    expect(result.courses).toBeGreaterThanOrEqual(1);
    expect(await count('section_version', 'section_id', due.sectionId)).toBe(0);
    expect(await count('section_review', 'section_id', due.sectionId)).toBe(0);
    expect(await count('ownership_period', 'section_id', due.sectionId)).toBe(0);
    expect(await count('lesson_version', 'section_version_id', due.versionId)).toBe(0);
    // The course row itself is kept (it is not on the NFR10.201 list).
    expect(await count('course', 'course_id', due.courseId)).toBe(1);
    expect(await count('section_version', 'section_id', young.sectionId)).toBe(1);
    expect(await count('section_review', 'section_id', young.sectionId)).toBe(1);
    expect(await count('ownership_period', 'section_id', young.sectionId)).toBe(1);
  });

  it('deletes a due discarded draft with its review history, and a due unreferenced image with its objects', async () => {
    const draft = await discardedDraft('2035-03-01T00:00:00Z');
    const recentDraft = await discardedDraft('2036-12-15T00:00:00Z');
    const oldImage = await inlineImage('2036-01-01T00:00:00Z');
    const newImage = await inlineImage('2037-05-01T00:00:00Z');
    const storage = createMemoryImageStorage(clock);
    await storage.put('public', `${oldImage.storageKey}/400.webp`, new Uint8Array([1]));
    await storage.put('quarantine', `${oldImage.storageKey}/400.webp`, new Uint8Array([1]));
    const service = createCatalogRetention({
      clock,
      storage,
      log: createLogger({ level: 'silent' }),
      auditRetentionYears: async () => 10,
    });
    const result = await withRetentionRole(t.db, (exec) => service.purgeDiscardedDrafts(exec));
    expect(result.drafts).toBeGreaterThanOrEqual(1);
    expect(await count('section_version', 'section_version_id', draft)).toBe(0);
    expect(await count('section_review', 'section_version_id', draft)).toBe(0);
    expect(await count('section_version', 'section_version_id', recentDraft)).toBe(1);
    expect(await count('section_review', 'section_version_id', recentDraft)).toBe(1);
    expect(await count('catalog_image', 'image_id', oldImage.imageId)).toBe(0);
    expect(await storage.exists('public', `${oldImage.storageKey}/400.webp`)).toBe(false);
    expect(await storage.exists('quarantine', `${oldImage.storageKey}/400.webp`)).toBe(false);
    expect(await count('catalog_image', 'image_id', newImage.imageId)).toBe(1);
  });
});

describe('catalog_retention holds least privilege (migration 0009)', () => {
  const asRetention = (statement: SQL) =>
    withRetentionRole(t.db, (exec) => exec.execute(statement));
  const sqlState = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (error: { code?: string; cause?: { code?: string } }) => error.cause?.code ?? error.code,
    );

  it('still cannot update the review history (BR8.7 holds for every role)', async () => {
    const { versionId } = await course('published', null);
    expect(
      await sqlState(
        asRetention(
          sql`UPDATE section_review SET comment = 'x' WHERE section_version_id = ${versionId}`,
        ),
      ),
    ).toBe('42501');
  });

  it('cannot delete a course, insert a review row or touch a table outside its grants', async () => {
    const { courseId, sectionId, versionId } = await course('published', null);
    expect(await sqlState(asRetention(sql`DELETE FROM course WHERE course_id = ${courseId}`))).toBe(
      '42501',
    );
    expect(
      await sqlState(
        asRetention(
          sql`INSERT INTO section_review (section_id, section_version_id, action, from_state, to_state, actor_id, decided_at)
           VALUES (${sectionId}, ${versionId}, 'submitted', 'draft', 'in_review', ${randomUUID()}, now())`,
        ),
      ),
    ).toBe('42501');
    expect(await sqlState(asRetention(sql`SELECT count(*) FROM goal`))).toBe('42501');
    expect(
      await sqlState(
        asRetention(sql`UPDATE section SET position = 9 WHERE section_id = ${sectionId}`),
      ),
    ).toBe('42501');
  });

  it('names the two jobs the worker registers (see catalog-worker.int.test.ts)', () => {
    expect(Object.values(RETENTION_JOBS)).toEqual([
      'catalog.retention.publishedHistory',
      'catalog.retention.discardedDrafts',
    ]);
  });
});
