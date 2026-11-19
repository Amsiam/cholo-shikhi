// [LT] Step 39: migration 0006_u2_catalog_products (forward-only, expand-only) on real PostgreSQL:
// the immutable version rows (NFR6.206, BR10.3, BR10.6), the plan item Goal check (BR10.1), the
// product table constraints, integer money columns and the data-class comments (NFR5.201).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '#src/server/migrations.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';

const PRODUCT_TABLES = [
  'exam_package',
  'exam_package_version',
  'subscription_plan',
  'subscription_plan_version',
  'subscription_plan_version_item',
  'practice_pack',
];

let t: TestDatabase;
let goalId: string;
let otherGoalId: string;

async function insertGoal(segmentId: string, name: string) {
  const { rows } = await t.pool.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status) VALUES ($1, $2, $2, 'active') RETURNING goal_id`,
    [segmentId, name],
  );
  return rows[0]?.goal_id as string;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const n = randomBytes(4).toString('hex');
  const segment = await t.pool.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band)
     VALUES ($1, $2, 'academic', $3) RETURNING segment_id`,
    [`সেগমেন্ট ${n}`, `Segment ${n}`, `band_${n}`],
  );
  const segmentId = segment.rows[0]?.segment_id as string;
  goalId = await insertGoal(segmentId, `Goal A ${n}`);
  otherGoalId = await insertGoal(segmentId, `Goal B ${n}`);
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

async function insertExam(goal = goalId): Promise<string> {
  const { rows } = await t.pool.query<{ exam_package_id: string }>(
    `INSERT INTO exam_package (goal_id, title_bn, title_en, list_price_poisha, created_by)
     VALUES ($1, 'পরীক্ষা', 'Exam', 49900, $2) RETURNING exam_package_id`,
    [goal, randomUUID()],
  );
  return rows[0]?.exam_package_id as string;
}
async function insertExamVersion(examPackageId: string, versionNumber = 1): Promise<string> {
  const { rows } = await t.pool.query<{ exam_package_version_id: string }>(
    `INSERT INTO exam_package_version (exam_package_id, version_number, question_ids, time_limit_minutes, published_at, published_by)
     VALUES ($1, $2, ARRAY[$3::uuid], 60, now(), $4) RETURNING exam_package_version_id`,
    [examPackageId, versionNumber, randomUUID(), randomUUID()],
  );
  return rows[0]?.exam_package_version_id as string;
}
async function insertCourse(goal = goalId): Promise<string> {
  const { rows } = await t.pool.query<{ course_id: string }>(
    `INSERT INTO course (goal_id, title_bn, title_en, created_by) VALUES ($1, 'কোর্স', 'Course', $2) RETURNING course_id`,
    [goal, randomUUID()],
  );
  return rows[0]?.course_id as string;
}
async function insertPlanVersion(goal = goalId) {
  const plan = await t.pool.query<{ plan_id: string }>(
    `INSERT INTO subscription_plan (goal_id, name_bn, name_en, created_by) VALUES ($1, 'প্ল্যান', 'Plan', $2) RETURNING plan_id`,
    [goal, randomUUID()],
  );
  const planId = plan.rows[0]?.plan_id as string;
  const { rows } = await t.pool.query<{ plan_version_id: string }>(
    `INSERT INTO subscription_plan_version (plan_id, version_number, monthly_price_poisha, published_at, published_by)
     VALUES ($1, 1, 39900, now(), $2) RETURNING plan_version_id`,
    [planId, randomUUID()],
  );
  return { planId, planVersionId: rows[0]?.plan_version_id as string };
}
const addCourseItem = (planVersionId: string, courseId: string) =>
  t.pool.query(
    `INSERT INTO subscription_plan_version_item (plan_version_id, item_type, course_id) VALUES ($1, 'course', $2)`,
    [planVersionId, courseId],
  );

describe('migration 0006_u2_catalog_products', () => {
  it('follows 0005 and creates every product table', async () => {
    const tags = loadMigrations().map((m) => m.tag);
    expect(tags.indexOf('0006_u2_catalog_products')).toBe(tags.indexOf('0005_u2_catalog_core') + 1);
    const { rows } = await t.pool.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      [t.schemaName],
    );
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(PRODUCT_TABLES));
  });

  it('stores every product money column as bigint integer poisha, never numeric or real', async () => {
    const { rows } = await t.pool.query<{ column_name: string; data_type: string }>(
      `SELECT table_name || '.' || column_name AS column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = ANY($2)
         AND (column_name LIKE '%poisha%' OR data_type IN ('numeric', 'real', 'double precision'))
       ORDER BY 1`,
      [t.schemaName, PRODUCT_TABLES],
    );
    expect(rows).toEqual([
      { column_name: 'exam_package.list_price_poisha', data_type: 'bigint' },
      { column_name: 'practice_pack.list_price_poisha', data_type: 'bigint' },
      { column_name: 'subscription_plan.draft_monthly_price_poisha', data_type: 'bigint' },
      { column_name: 'subscription_plan_version.monthly_price_poisha', data_type: 'bigint' },
    ]);
  });

  it('tags every product column with a data class (NFR5.201)', async () => {
    const { rows } = await t.pool.query(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = ANY($2)
         AND coalesce(col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position), '') NOT LIKE 'data-class C_%'`,
      [t.schemaName, PRODUCT_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it('refuses UPDATE and DELETE of an exam package version (BR10.3, NFR6.206)', async () => {
    const versionId = await insertExamVersion(await insertExam());
    expect(
      await code(
        t.pool.query(
          'UPDATE exam_package_version SET time_limit_minutes = 90 WHERE exam_package_version_id = $1',
          [versionId],
        ),
      ),
    ).toBe('42501');
    expect(
      await code(
        t.pool.query('DELETE FROM exam_package_version WHERE exam_package_version_id = $1', [
          versionId,
        ]),
      ),
    ).toBe('42501');
  });

  it('refuses UPDATE and DELETE of a plan version and of its items (BR10.6, NFR6.206)', async () => {
    const { planVersionId } = await insertPlanVersion();
    await addCourseItem(planVersionId, await insertCourse());
    for (const sql of [
      'UPDATE subscription_plan_version SET monthly_price_poisha = 1 WHERE plan_version_id = $1',
      'DELETE FROM subscription_plan_version WHERE plan_version_id = $1',
      `UPDATE subscription_plan_version_item SET item_type = 'course' WHERE plan_version_id = $1`,
      'DELETE FROM subscription_plan_version_item WHERE plan_version_id = $1',
    ]) {
      expect(await code(t.pool.query(sql, [planVersionId]))).toBe('42501');
    }
  });

  it('keeps the draft fields of the product rows editable', async () => {
    const examPackageId = await insertExam();
    await t.pool.query(
      `UPDATE exam_package SET draft_question_ids = ARRAY[$2::uuid], draft_time_limit_minutes = 30, version = version + 1
       WHERE exam_package_id = $1`,
      [examPackageId, randomUUID()],
    );
    const { rows } = await t.pool.query(
      'SELECT version FROM exam_package WHERE exam_package_id = $1',
      [examPackageId],
    );
    expect(rows[0]).toEqual({ version: 2 });
  });

  it('accepts a plan item of the plan Goal and refuses one of another Goal (BR10.1)', async () => {
    const { planVersionId } = await insertPlanVersion();
    await addCourseItem(planVersionId, await insertCourse(goalId));
    expect(await code(addCourseItem(planVersionId, await insertCourse(otherGoalId)))).toBe('23514');
    const foreignExam = await insertExam(otherGoalId);
    expect(
      await code(
        t.pool.query(
          `INSERT INTO subscription_plan_version_item (plan_version_id, item_type, exam_package_id) VALUES ($1, 'exam_package', $2)`,
          [planVersionId, foreignExam],
        ),
      ),
    ).toBe('23514');
  });

  it('refuses a plan item whose type does not match its reference, and a duplicate item', async () => {
    const { planVersionId } = await insertPlanVersion();
    const courseId = await insertCourse();
    expect(
      await code(
        t.pool.query(
          `INSERT INTO subscription_plan_version_item (plan_version_id, item_type, course_id) VALUES ($1, 'exam_package', $2)`,
          [planVersionId, courseId],
        ),
      ),
    ).toBe('23514');
    await addCourseItem(planVersionId, courseId);
    expect(await code(addCourseItem(planVersionId, courseId))).toBe('23505');
  });

  it('refuses a published exam package or plan without a current version', async () => {
    expect(
      await code(
        t.pool.query(`UPDATE exam_package SET status = 'published' WHERE exam_package_id = $1`, [
          await insertExam(),
        ]),
      ),
    ).toBe('23514');
    const { planId } = await insertPlanVersion();
    expect(
      await code(
        t.pool.query(`UPDATE subscription_plan SET status = 'published' WHERE plan_id = $1`, [
          planId,
        ]),
      ),
    ).toBe('23514');
  });

  it('refuses a 0-poisha price, a time limit outside 1 to 600 and a version without questions', async () => {
    expect(
      await code(
        t.pool.query(
          `INSERT INTO exam_package (goal_id, title_bn, title_en, list_price_poisha, created_by) VALUES ($1, 'ক', 'A', 0, $2)`,
          [goalId, randomUUID()],
        ),
      ),
    ).toBe('23514');
    const examPackageId = await insertExam();
    expect(
      await code(
        t.pool.query(
          'UPDATE exam_package SET draft_time_limit_minutes = 601 WHERE exam_package_id = $1',
          [examPackageId],
        ),
      ),
    ).toBe('23514');
    expect(
      await code(
        t.pool.query(
          `INSERT INTO exam_package_version (exam_package_id, version_number, question_ids, time_limit_minutes, published_at, published_by)
           VALUES ($1, 1, '{}', 60, now(), $2)`,
          [examPackageId, randomUUID()],
        ),
      ),
    ).toBe('23514');
  });

  it('refuses a second version with the same number (BR10.3)', async () => {
    const examPackageId = await insertExam();
    await insertExamVersion(examPackageId, 1);
    expect(await code(insertExamVersion(examPackageId, 1))).toBe('23505');
    await insertExamVersion(examPackageId, 2);
  });

  it('refuses a Practice Pack without question sets or with more than 50 (BR10.9)', async () => {
    const courseId = await insertCourse();
    const insertPack = (sets: string[]) =>
      t.pool.query(
        `INSERT INTO practice_pack (course_id, title_bn, title_en, list_price_poisha, question_set_ids, created_by)
         VALUES ($1, 'প্যাক', 'Pack', 19900, $2::uuid[], $3)`,
        [courseId, sets, randomUUID()],
      );
    expect(await code(insertPack([]))).toBe('23514');
    expect(await code(insertPack(Array.from({ length: 51 }, () => randomUUID())))).toBe('23514');
    await insertPack([randomUUID()]);
  });
});
