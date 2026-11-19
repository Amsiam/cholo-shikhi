// [LT] Step 44: migration 0007_u2_catalog_images (forward-only, expand-only) on real PostgreSQL: the
// catalog_image and lesson_version_image tables (SD-217, SD-220), their constraints, and the
// data-class comments (NFR5.201). Cross-unit IDs (uploaded_by) are not foreign keys (ADR-020).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '#src/server/migrations.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';

const IMAGE_TABLES = ['catalog_image', 'lesson_version_image'];

let t: TestDatabase;
let courseId: string;

const key = () => `img/${randomBytes(16).toString('base64url')}`;

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
  const course = await t.pool.query<{ course_id: string }>(
    `INSERT INTO course (goal_id, title_bn, title_en, created_by) VALUES ($1, 'কোর্স', 'Course', $2) RETURNING course_id`,
    [goal.rows[0]?.goal_id, randomUUID()],
  );
  courseId = course.rows[0]?.course_id as string;
});
afterAll(async () => {
  await t.drop();
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
  throw new Error('expected the statement to be refused');
}

const insertImage = (overrides: Record<string, unknown> = {}) => {
  const row = {
    course_id: courseId,
    kind: 'inline',
    storage_key: key(),
    variant_widths: [400, 800, 1600],
    width: 1600,
    height: 900,
    ...overrides,
  };
  return t.pool.query<{ image_id: string; desired_state: string; actual_state: string }>(
    `INSERT INTO catalog_image (course_id, kind, storage_key, variant_widths, width, height, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING image_id, desired_state, actual_state`,
    [
      row.course_id,
      row.kind,
      row.storage_key,
      row.variant_widths,
      row.width,
      row.height,
      randomUUID(),
    ],
  );
};

describe('migration 0007_u2_catalog_images', () => {
  it('follows 0006 and creates both image tables', async () => {
    const tags = loadMigrations().map((m) => m.tag);
    expect(tags.indexOf('0007_u2_catalog_images')).toBe(
      tags.indexOf('0006_u2_catalog_products') + 1,
    );
    const { rows } = await t.pool.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      [t.schemaName],
    );
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(IMAGE_TABLES));
  });

  it('tags every image column with a data class (NFR5.201)', async () => {
    const { rows } = await t.pool.query(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = ANY($2)
         AND coalesce(col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position), '') NOT LIKE 'data-class C_%'`,
      [t.schemaName, IMAGE_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it('stores a new image as active in both its desired and actual state', async () => {
    const { rows } = await insertImage();
    expect(rows[0]).toMatchObject({ desired_state: 'active', actual_state: 'active' });
  });

  it('accepts only 128-bit random keys under img/ and refuses a reused key (SD-217)', async () => {
    expect(await code(insertImage({ storage_key: 'img/course-cover.webp' }))).toBe('23514');
    expect(await code(insertImage({ storage_key: `covers/${randomUUID()}` }))).toBe('23514');
    const reused = key();
    await insertImage({ storage_key: reused });
    expect(await code(insertImage({ storage_key: reused }))).toBe('23505');
  });

  it('refuses an unknown kind or state, a width above 1600 and an empty variant list', async () => {
    expect(await code(insertImage({ kind: 'svg' }))).toBe('23514');
    expect(await code(insertImage({ width: 1601 }))).toBe('23514');
    expect(await code(insertImage({ variant_widths: [] }))).toBe('23514');
    const { rows } = await insertImage();
    expect(
      await code(
        t.pool.query(`UPDATE catalog_image SET desired_state = 'gone' WHERE image_id = $1`, [
          rows[0]?.image_id,
        ]),
      ),
    ).toBe('23514');
  });

  it('refuses an image of a course that does not exist and a dangling lesson reference', async () => {
    expect(await code(insertImage({ course_id: randomUUID() }))).toBe('23503');
    const { rows } = await insertImage();
    expect(
      await code(
        t.pool.query(
          'INSERT INTO lesson_version_image (lesson_version_id, image_id) VALUES ($1, $2)',
          [randomUUID(), rows[0]?.image_id],
        ),
      ),
    ).toBe('23503');
  });

  it('keeps uploaded_by a plain U1 user ID, not a foreign key (ADR-020)', async () => {
    const { rows } = await t.pool.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1 AND tc.table_name = 'catalog_image' AND tc.constraint_type = 'FOREIGN KEY'`,
      [t.schemaName],
    );
    expect(rows.map((r) => r.column_name)).toEqual(['course_id']);
  });
});
