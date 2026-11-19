// [LT] Step 14: migration 0005_u2_catalog_core (forward-only, expand-only) on real PostgreSQL:
// the immutability triggers (NFR6.206, SD-207), the ownership no-overlap constraint trigger
// (RD-215 fallback), the append-only review history (BR8.7), integer money columns and the
// data-class comments (NFR5.201).
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '#src/server/migrations.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';

let t: TestDatabase;
let goalId: string;
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

async function rejects(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
  throw new Error('expected the statement to be refused');
}

async function insertCourse(client: pg.Pool | pg.PoolClient = t.pool): Promise<string> {
  const { rows } = await client.query<{ course_id: string }>(
    `INSERT INTO course (goal_id, title_bn, title_en, created_by) VALUES ($1, 'কোর্স', 'Course', $2)
     RETURNING course_id`,
    [goalId, randomUUID()],
  );
  return rows[0]?.course_id as string;
}

async function insertSection(courseId: string, position = 1): Promise<string> {
  const { rows } = await t.pool.query<{ section_id: string }>(
    'INSERT INTO section (course_id, position) VALUES ($1, $2) RETURNING section_id',
    [courseId, position],
  );
  return rows[0]?.section_id as string;
}

async function insertVersion(sectionId: string, state: string, number = 1): Promise<string> {
  const { rows } = await t.pool.query<{ section_version_id: string }>(
    `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state)
     VALUES ($1, $2, 'অংশ', 'Section', $3) RETURNING section_version_id`,
    [sectionId, number, state],
  );
  return rows[0]?.section_version_id as string;
}

async function insertLessonVersion(sectionVersionId: string, sectionId: string, position = 1) {
  const lesson = await t.pool.query<{ lesson_id: string }>(
    `INSERT INTO lesson (section_id, kind, created_by) VALUES ($1, 'text', $2) RETURNING lesson_id`,
    [sectionId, randomUUID()],
  );
  const { rows } = await t.pool.query<{ lesson_version_id: string }>(
    `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_en)
     VALUES ($1, $2, $3, 'Lesson') RETURNING lesson_version_id`,
    [lesson.rows[0]?.lesson_id, sectionVersionId, position],
  );
  return rows[0]?.lesson_version_id as string;
}

async function openPeriod(sectionId: string, from: string, to: string | null = null) {
  const { rows } = await t.pool.query<{ section_ownership_id: string }>(
    `INSERT INTO ownership_period (section_id, instructor_id, valid_from, valid_to, assigned_by, reason)
     VALUES ($1, $2, $3, $4, $5, 'default_lead') RETURNING section_ownership_id`,
    [sectionId, randomUUID(), from, to, randomUUID()],
  );
  return rows[0]?.section_ownership_id as string;
}

describe('migration 0005_u2_catalog_core', () => {
  it('follows 0004 and creates every catalog core table', async () => {
    const tags = loadMigrations().map((m) => m.tag);
    expect(tags.indexOf('0005_u2_catalog_core')).toBe(tags.indexOf('0004_u2_goals') + 1);
    const { rows } = await t.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [t.schemaName],
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'course',
        'section',
        'section_version',
        'lesson',
        'lesson_version',
        'ownership_period',
        'section_review',
        'blocked_domain',
      ]),
    );
  });

  it('stores money as bigint integer poisha, never numeric or real', async () => {
    const { rows } = await t.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND (column_name LIKE '%poisha%' OR data_type IN ('numeric', 'real', 'double precision'))
         AND table_name IN ('course', 'section', 'section_version', 'lesson', 'lesson_version', 'ownership_period')`,
      [t.schemaName],
    );
    expect(rows).toEqual([{ column_name: 'list_price_poisha', data_type: 'bigint' }]);
  });

  it('tags every catalog column with a data class (NFR5.201)', async () => {
    const { rows } = await t.pool.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
       WHERE c.table_schema = $1
         AND c.table_name IN ('course', 'section', 'section_version', 'lesson', 'lesson_version', 'ownership_period', 'section_review', 'blocked_domain')
         AND coalesce(col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position), '') NOT LIKE 'data-class C_%'`,
      [t.schemaName],
    );
    expect(rows).toEqual([]);
  });

  it('refuses a price below 1 poisha and a duration other than 4, 6 or 12 months', async () => {
    const courseId = await insertCourse();
    expect(
      await rejects(
        t.pool.query('UPDATE course SET list_price_poisha = 0 WHERE course_id = $1', [courseId]),
      ),
    ).toBe('23514');
    expect(
      await rejects(
        t.pool.query('UPDATE course SET access_duration_months = 5 WHERE course_id = $1', [
          courseId,
        ]),
      ),
    ).toBe('23514');
  });

  it('keeps at most one working copy and one live version per section (BR8.1)', async () => {
    const sectionId = await insertSection(await insertCourse());
    await insertVersion(sectionId, 'draft', 1);
    expect(await rejects(insertVersion(sectionId, 'in_review', 2))).toBe('23505');
    await insertVersion(sectionId, 'published', 3);
    expect(await rejects(insertVersion(sectionId, 'published', 4))).toBe('23505');
  });
});

describe('immutability triggers (NFR6.206, SD-207)', () => {
  it('refuses UPDATE and DELETE of a published section version, but allows published -> superseded', async () => {
    const sectionId = await insertSection(await insertCourse());
    const live = await insertVersion(sectionId, 'published');
    expect(
      await rejects(
        t.pool.query(`UPDATE section_version SET title_en = 'x' WHERE section_version_id = $1`, [
          live,
        ]),
      ),
    ).toBe('42501');
    expect(
      await rejects(
        t.pool.query('DELETE FROM section_version WHERE section_version_id = $1', [live]),
      ),
    ).toBe('42501');
    await t.pool.query(
      `UPDATE section_version SET review_state = 'superseded', superseded_at = now() WHERE section_version_id = $1`,
      [live],
    );
    expect(
      await rejects(
        t.pool.query(
          `UPDATE section_version SET review_state = 'published' WHERE section_version_id = $1`,
          [live],
        ),
      ),
    ).toBe('42501');
  });

  it('lets a draft working copy change freely', async () => {
    const sectionId = await insertSection(await insertCourse());
    const draft = await insertVersion(sectionId, 'draft');
    await t.pool.query(
      `UPDATE section_version SET title_en = 'Edited' WHERE section_version_id = $1`,
      [draft],
    );
    const { rows } = await t.pool.query(
      'SELECT title_en FROM section_version WHERE section_version_id = $1',
      [draft],
    );
    expect(rows[0]?.title_en).toBe('Edited');
  });

  it('refuses authored edits of a published lesson version but accepts a U4 technical status push', async () => {
    const sectionId = await insertSection(await insertCourse());
    const live = await insertVersion(sectionId, 'published');
    const lessonVersionId = await insertLessonVersion(live, sectionId);
    expect(
      await rejects(
        t.pool.query(`UPDATE lesson_version SET title_en = 'x' WHERE lesson_version_id = $1`, [
          lessonVersionId,
        ]),
      ),
    ).toBe('42501');
    expect(
      await rejects(
        t.pool.query('DELETE FROM lesson_version WHERE lesson_version_id = $1', [lessonVersionId]),
      ),
    ).toBe('42501');
    await t.pool.query(
      `UPDATE lesson_version SET media_status = 'ready', caption_languages = '{bn}' WHERE lesson_version_id = $1`,
      [lessonVersionId],
    );
  });

  it('refuses any change of a lesson version in a superseded section version', async () => {
    const sectionId = await insertSection(await insertCourse());
    const old = await insertVersion(sectionId, 'superseded');
    const lessonVersionId = await insertLessonVersion(old, sectionId);
    expect(
      await rejects(
        t.pool.query(
          `UPDATE lesson_version SET media_status = 'failed' WHERE lesson_version_id = $1`,
          [lessonVersionId],
        ),
      ),
    ).toBe('42501');
  });

  it('allows an open ownership period to close once, then refuses every change and every delete', async () => {
    const sectionId = await insertSection(await insertCourse());
    const period = await openPeriod(sectionId, '2026-11-01T00:00:00Z');
    expect(
      await rejects(
        t.pool.query('DELETE FROM ownership_period WHERE section_ownership_id = $1', [period]),
      ),
    ).toBe('42501');
    expect(
      await rejects(
        t.pool.query(
          `UPDATE ownership_period SET reason = 'assigned' WHERE section_ownership_id = $1`,
          [period],
        ),
      ),
    ).toBe('42501');
    await t.pool.query(
      `UPDATE ownership_period SET valid_to = '2026-11-05T00:00:00Z', version = version + 1
       WHERE section_ownership_id = $1`,
      [period],
    );
    expect(
      await rejects(
        t.pool.query(
          `UPDATE ownership_period SET valid_to = '2026-11-06T00:00:00Z' WHERE section_ownership_id = $1`,
          [period],
        ),
      ),
    ).toBe('42501');
  });

  it('keeps the review history append-only (BR8.7)', async () => {
    const sectionId = await insertSection(await insertCourse());
    const draft = await insertVersion(sectionId, 'draft');
    const { rows } = await t.pool.query<{ section_review_id: string }>(
      `INSERT INTO section_review (section_id, section_version_id, action, from_state, to_state, actor_id, decided_at)
       VALUES ($1, $2, 'submitted', 'draft', 'in_review', $3, now()) RETURNING section_review_id`,
      [sectionId, draft, randomUUID()],
    );
    const id = rows[0]?.section_review_id;
    expect(
      await rejects(
        t.pool.query(`UPDATE section_review SET comment = 'x' WHERE section_review_id = $1`, [id]),
      ),
    ).toBe('42501');
    expect(
      await rejects(t.pool.query('DELETE FROM section_review WHERE section_review_id = $1', [id])),
    ).toBe('42501');
  });
});

describe('ownership no-overlap (RD-215, the trigger layer)', () => {
  it('refuses a period that overlaps a closed one and a second open period', async () => {
    const sectionId = await insertSection(await insertCourse());
    await openPeriod(sectionId, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z');
    expect(
      await rejects(openPeriod(sectionId, '2026-11-05T00:00:00Z', '2026-11-12T00:00:00Z')),
    ).toBe('23P01');
    await openPeriod(sectionId, '2026-11-10T00:00:00Z');
    expect(await rejects(openPeriod(sectionId, '2026-11-20T00:00:00Z'))).toBe('23505');
  });

  it('accepts back-to-back periods that close and open at the same instant (BR6.5)', async () => {
    const sectionId = await insertSection(await insertCourse());
    await openPeriod(sectionId, '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
    await openPeriod(sectionId, '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z');
    const { rows } = await t.pool.query(
      'SELECT count(*)::int AS n FROM ownership_period WHERE section_id = $1',
      [sectionId],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('serialises two concurrent writers so overlapping periods never both commit', async () => {
    const sectionId = await insertSection(await insertCourse());
    const a = await t.pool.connect();
    const b = await t.pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const insert = (client: pg.PoolClient, from: string, to: string) =>
        client.query(
          `INSERT INTO ownership_period (section_id, instructor_id, valid_from, valid_to, assigned_by, reason)
           VALUES ($1, $2, $3, $4, $5, 'assigned')`,
          [sectionId, randomUUID(), from, to, randomUUID()],
        );
      await insert(a, '2026-12-01T00:00:00Z', '2026-12-10T00:00:00Z');
      const second = insert(b, '2026-12-05T00:00:00Z', '2026-12-15T00:00:00Z').then(
        () => 'inserted',
        (error: { code?: string }) => error.code,
      );
      await a.query('COMMIT');
      expect(await second).toBe('23P01');
      await b.query('ROLLBACK');
    } finally {
      a.release();
      b.release();
    }
  });
});

describe('migration 0008_u2_ownership_gist (RD-215, Step 49, approved 2026-11-17)', () => {
  it('follows 0007, and 0009 (the retention role) follows it', () => {
    const tags = loadMigrations().map((m) => m.tag);
    expect(tags.indexOf('0008_u2_ownership_gist')).toBe(tags.indexOf('0007_u2_catalog_images') + 1);
    expect(tags.indexOf('0009_u2_catalog_retention_role')).toBe(
      tags.indexOf('0008_u2_ownership_gist') + 1,
    );
  });

  it('installs btree_gist and adds the exclusion constraint on ownership periods', async () => {
    const ext = await t.pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    expect(ext.rowCount).toBe(1);
    const { rows } = await t.pool.query<{ contype: string; def: string }>(
      `SELECT c.contype, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = $1 AND c.conname = 'ownership_period_no_overlap_ex'`,
      [t.schemaName],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contype).toBe('x');
    expect(rows[0]?.def).toContain('EXCLUDE USING gist');
  });

  it('refuses an overlap by the constraint alone, with the fallback trigger switched off', async () => {
    const sectionId = await insertSection(await insertCourse());
    const client = await t.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE ownership_period DISABLE TRIGGER ownership_period_no_overlap',
      );
      await client.query(
        `INSERT INTO ownership_period (section_id, instructor_id, valid_from, valid_to, assigned_by, reason)
         VALUES ($1, $2, '2027-01-01T00:00:00Z', '2027-01-10T00:00:00Z', $3, 'default_lead')`,
        [sectionId, randomUUID(), randomUUID()],
      );
      const overlap = await client
        .query(
          `INSERT INTO ownership_period (section_id, instructor_id, valid_from, valid_to, assigned_by, reason)
           VALUES ($1, $2, '2027-01-05T00:00:00Z', NULL, $3, 'assigned')`,
          [sectionId, randomUUID(), randomUUID()],
        )
        .then(
          () => ({ code: 'inserted', constraint: '' }),
          (error: { code?: string; constraint?: string }) => ({
            code: error.code,
            constraint: error.constraint,
          }),
        );
      expect(overlap).toEqual({ code: '23P01', constraint: 'ownership_period_no_overlap_ex' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('still accepts back-to-back periods ([) bounds, BR6.5)', async () => {
    const sectionId = await insertSection(await insertCourse());
    await openPeriod(sectionId, '2027-02-01T00:00:00Z', '2027-02-02T00:00:00Z');
    await openPeriod(sectionId, '2027-02-02T00:00:00Z');
    const { rows } = await t.pool.query(
      'SELECT count(*)::int AS n FROM ownership_period WHERE section_id = $1',
      [sectionId],
    );
    expect(rows[0]?.n).toBe(2);
  });
});
