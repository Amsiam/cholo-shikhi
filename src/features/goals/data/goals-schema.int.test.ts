// [LT] Step 5: migration 0004_u2_goals (forward-only, expand-only) and the Goals table constraints
// on real PostgreSQL (BR1.2, BR1.3, BR1.4, BR2.4, NFR5.201, ADR-020).
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '#src/server/db.ts';
import { loadMigrations, migrate } from '#src/server/migrations.ts';
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from '#src/test/db.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

async function insertSegment(
  client: pg.Pool,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const n = randomBytes(4).toString('hex');
  const row = {
    name_bn: `সেগমেন্ট ${n}`,
    name_en: `Segment ${n}`,
    segment_type: 'academic',
    battle_band: `band_${n}`,
    ...overrides,
  };
  const { rows } = await client.query<{ segment_id: string }>(
    `INSERT INTO goal_segment (name_bn, name_en, segment_type, battle_band)
     VALUES ($1, $2, $3, $4) RETURNING segment_id`,
    [row.name_bn, row.name_en, row.segment_type, row.battle_band],
  );
  return rows[0]?.segment_id as string;
}

async function insertGoal(client: pg.Pool, segmentId: string, nameEn = `Goal ${randomUUID()}`) {
  const { rows } = await client.query<{ goal_id: string }>(
    `INSERT INTO goal (segment_id, name_bn, name_en, status) VALUES ($1, $2, $3, 'active')
     RETURNING goal_id`,
    [segmentId, `লক্ষ্য ${nameEn}`, nameEn],
  );
  return rows[0]?.goal_id as string;
}

async function rejects(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
  throw new Error('expected the statement to be refused');
}

describe('migration 0004_u2_goals', () => {
  it('is the fifth migration and applies cleanly to an empty schema', async () => {
    expect(loadMigrations().map((m) => m.tag)).toContain('0004_u2_goals');
    const { rows } = await t.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1
       AND table_name IN ('goal_segment', 'goal', 'student_goal_selection') ORDER BY table_name`,
      [t.schemaName],
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'goal',
      'goal_segment',
      'student_goal_selection',
    ]);
  });

  it('applies on top of a database already at 0003 (forward-only upgrade)', async () => {
    const schema = `t_${randomBytes(6).toString('hex')}`;
    const admin = createPool(testDatabaseUrl(), { max: 1 });
    try {
      const all = loadMigrations();
      const upTo0003 = all.slice(
        0,
        all.findIndex((m) => m.tag === '0004_u2_goals'),
      );
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(
        `CREATE TABLE "${schema}"."__app_migrations" (tag text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      for (const migration of upTo0003) {
        await admin.query('BEGIN');
        await admin.query(`SET LOCAL search_path TO "${schema}"`);
        for (const statement of migration.statements) {
          await admin.query(statement.replaceAll('"public".', `"${schema}".`));
        }
        await admin.query(
          `INSERT INTO "${schema}"."__app_migrations" (tag, hash) VALUES ($1, $2)`,
          [migration.tag, migration.hash],
        );
        await admin.query('COMMIT');
      }
      const ran = await migrate(admin, schema);
      expect(ran[0]).toBe('0004_u2_goals');
      // Running again is a no-op.
      expect(await migrate(admin, schema)).toEqual([]);
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('tags every Goals column with a data class (NFR5.201)', async () => {
    const { rows } = await t.pool.query<{ table: string; column: string; comment: string | null }>(
      `SELECT c.table_name AS table, c.column_name AS column,
              col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position) AS comment
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name IN ('goal_segment', 'goal', 'student_goal_selection')`,
      [t.schemaName],
    );
    expect(rows.length).toBe(26);
    for (const row of rows)
      expect(row.comment, `${row.table}.${row.column}`).toMatch(/^data-class C[123] /);
    expect(
      rows
        .filter((r) => r.table === 'student_goal_selection')
        .every((r) => r.comment?.includes('C3')),
    ).toBe(true);
  });
});

describe('Goals constraints', () => {
  it('refuses a segment name that differs only in case or spacing (BR1.2)', async () => {
    await insertSegment(t.pool, { name_en: 'Bank Jobs' });
    expect(await rejects(insertSegment(t.pool, { name_en: '  bank jobs ' }))).toBe('23505');
  });

  it('refuses an unknown segment type and a non-key battle band', async () => {
    expect(await rejects(insertSegment(t.pool, { segment_type: 'other' }))).toBe('23514');
    expect(await rejects(insertSegment(t.pool, { battle_band: 'Class 6-8' }))).toBe('23514');
  });

  it('refuses a duplicate Goal name within one segment but allows it in another (BR1.3)', async () => {
    const a = await insertSegment(t.pool);
    const b = await insertSegment(t.pool);
    await insertGoal(t.pool, a, 'BCS Preliminary');
    expect(await rejects(insertGoal(t.pool, a, 'bcs preliminary'))).toBe('23505');
    await expect(insertGoal(t.pool, b, 'BCS Preliminary')).resolves.toBeTruthy();
  });

  it('keeps retiredAt set exactly when a Goal is retired (BR1.4)', async () => {
    const segment = await insertSegment(t.pool);
    const goal = await insertGoal(t.pool, segment);
    expect(
      await rejects(t.pool.query(`UPDATE goal SET status = 'retired' WHERE goal_id = $1`, [goal])),
    ).toBe('23514');
    await t.pool.query(
      `UPDATE goal SET status = 'retired', retired_at = now() WHERE goal_id = $1`,
      [goal],
    );
  });

  it('refuses deleting a segment that still has a Goal (restrict, BR1.5)', async () => {
    const segment = await insertSegment(t.pool);
    await insertGoal(t.pool, segment);
    expect(
      await rejects(t.pool.query('DELETE FROM goal_segment WHERE segment_id = $1', [segment])),
    ).toBe('23503');
  });

  it('allows one open selection per student and refuses a second (BR2.4)', async () => {
    const segment = await insertSegment(t.pool);
    const g1 = await insertGoal(t.pool, segment);
    const g2 = await insertGoal(t.pool, segment);
    const userId = randomUUID();
    const open = (goalId: string) =>
      t.pool.query(
        `INSERT INTO student_goal_selection (user_id, goal_id, segment_id, selected_at)
         VALUES ($1, $2, $3, now())`,
        [userId, goalId, segment],
      );
    await open(g1);
    expect(await rejects(open(g2))).toBe('23505');
    // Closing the open one makes room for the next (history is kept).
    await t.pool.query(
      `UPDATE student_goal_selection SET ended_at = now(), end_reason = 'changed'
       WHERE user_id = $1 AND ended_at IS NULL`,
      [userId],
    );
    await open(g2);
    const { rows } = await t.pool.query(
      'SELECT count(*)::int AS n FROM student_goal_selection WHERE user_id = $1',
      [userId],
    );
    expect(rows[0].n).toBe(2);
  });

  it('requires endReason exactly when endedAt is set', async () => {
    const segment = await insertSegment(t.pool);
    const goal = await insertGoal(t.pool, segment);
    expect(
      await rejects(
        t.pool.query(
          `INSERT INTO student_goal_selection (user_id, goal_id, segment_id, selected_at, ended_at)
           VALUES ($1, $2, $3, now(), now())`,
          [randomUUID(), goal, segment],
        ),
      ),
    ).toBe('23514');
  });

  it('does not make the cross-unit user_id a foreign key (ADR-020)', async () => {
    const { rows } = await t.pool.query<{ column_name: string; foreign_table: string }>(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name IN ('goal_segment', 'goal', 'student_goal_selection')`,
      [t.schemaName],
    );
    expect(rows.map((r) => r.column_name)).not.toContain('user_id');
    expect(new Set(rows.map((r) => r.foreign_table))).toEqual(new Set(['goal', 'goal_segment']));
  });
});
