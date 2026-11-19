// [LT] Step 7: Goals repositories on real PostgreSQL: version-checked writes (BR12.1), row locks and
// the one-open-selection race (BR2.4, BR12.2, functional-spec §7), bounded reads (SC-209).
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkVersion } from '#src/features/goals/domain/goals.ts';
import { createDb } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createGoalsRepository, isUniqueViolation } from './goals.repository.ts';
import { createSelectionRepository } from './selection.repository.ts';

let t: TestDatabase;
const repo = createGoalsRepository();
const selections = createSelectionRepository();
const at = new Date('2026-11-16T06:00:00.000Z');

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

async function seedSegment() {
  return repo.segments.insert(t.db, buildSegmentInput());
}
async function seedGoal(segmentId: string, status: 'active' | 'inactive' = 'active') {
  return repo.goals.insert(t.db, { ...buildGoalInput(segmentId), status });
}

describe('segments', () => {
  it('updates with the expected version and bumps it', async () => {
    const segment = await seedSegment();
    const result = await repo.segments.update(
      t.db,
      segment.segmentId,
      1,
      { ...buildSegmentInput(), segmentType: 'job_aspirant' },
      at,
    );
    expect(result).toMatchObject({
      kind: 'applied',
      row: { version: 2, segmentType: 'job_aspirant' },
    });
  });

  it('reports a stale version and changes nothing; the domain maps it to staleVersion', async () => {
    const segment = await seedSegment();
    const result = await repo.segments.update(t.db, segment.segmentId, 7, buildSegmentInput(), at);
    expect(result).toEqual({ kind: 'stale', currentVersion: 1 });
    expect((await repo.segments.get(t.db, segment.segmentId))?.nameEn).toBe(segment.nameEn);
    expect(checkVersion(1, 7)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
  });

  it('reports a missing row', async () => {
    expect(await repo.segments.update(t.db, randomUUID(), 1, buildSegmentInput(), at)).toEqual({
      kind: 'missing',
    });
    expect(await repo.segments.delete(t.db, randomUUID(), 1)).toEqual({ kind: 'missing' });
  });

  it('lists a bounded page with each segment goal count and the total', async () => {
    const segment = await seedSegment();
    await seedGoal(segment.segmentId);
    await seedGoal(segment.segmentId, 'inactive');
    // Regression: the count is per segment, not the total of all Goals.
    const other = await seedSegment();
    await seedGoal(other.segmentId);
    const empty = await seedSegment();
    const page = await repo.segments.list(t.db, { limit: 500, offset: 0 });
    expect(page.rows.find((r) => r.segmentId === segment.segmentId)?.goalCount).toBe(2);
    expect(page.rows.find((r) => r.segmentId === other.segmentId)?.goalCount).toBe(1);
    expect(page.rows.find((r) => r.segmentId === empty.segmentId)?.goalCount).toBe(0);
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
    expect((await repo.segments.list(t.db, { limit: 1, offset: 0 })).rows).toHaveLength(1);
  });

  it('finds name clashes case-insensitively, excluding the edited segment', async () => {
    const segment = await seedSegment();
    expect(
      await repo.segments.nameClashes(t.db, {
        nameBn: segment.nameBn,
        nameEn: ` ${segment.nameEn.toUpperCase()} `,
      }),
    ).toEqual({ nameBn: true, nameEn: true });
    expect(
      await repo.segments.nameClashes(
        t.db,
        { nameBn: segment.nameBn, nameEn: segment.nameEn },
        segment.segmentId,
      ),
    ).toEqual({ nameBn: false, nameEn: false });
  });

  it('deletes only at the expected version', async () => {
    const segment = await seedSegment();
    expect(await repo.segments.delete(t.db, segment.segmentId, 2)).toEqual({
      kind: 'stale',
      currentVersion: 1,
    });
    expect(await repo.segments.delete(t.db, segment.segmentId, 1)).toMatchObject({
      kind: 'applied',
    });
    expect(await repo.segments.get(t.db, segment.segmentId)).toBeUndefined();
  });
});

describe('goals', () => {
  it('updates status and retiredAt together at the expected version', async () => {
    const segment = await seedSegment();
    const goal = await seedGoal(segment.segmentId);
    const result = await repo.goals.update(
      t.db,
      goal.goalId,
      1,
      { status: 'retired', retiredAt: at },
      at,
    );
    expect(result).toMatchObject({ kind: 'applied', row: { status: 'retired', version: 2 } });
    expect(await repo.goals.update(t.db, goal.goalId, 1, { sortOrder: 3 }, at)).toEqual({
      kind: 'stale',
      currentVersion: 2,
    });
  });

  it('lists only active Goals for the picker and filters the Admin list by segment', async () => {
    const segment = await seedSegment();
    const active = await seedGoal(segment.segmentId, 'active');
    const inactive = await seedGoal(segment.segmentId, 'inactive');
    const ids = (await repo.goals.listActive(t.db)).map((g) => g.goalId);
    expect(ids).toContain(active.goalId);
    expect(ids).not.toContain(inactive.goalId);
    const page = await repo.goals.list(t.db, {
      limit: 10,
      offset: 0,
      segmentId: segment.segmentId,
    });
    expect(page.total).toBe(2);
  });

  it('returns Goal IDs of every status in the given segments, ascending and de-duplicated', async () => {
    const segment = await seedSegment();
    const a = await seedGoal(segment.segmentId, 'active');
    const b = await seedGoal(segment.segmentId, 'inactive');
    const ids = await repo.goals.idsInSegments(t.db, [
      segment.segmentId,
      segment.segmentId,
      randomUUID(),
    ]);
    expect(ids).toEqual([a.goalId, b.goalId].sort());
    expect(await repo.goals.idsInSegments(t.db, [])).toEqual([]);
  });

  it('counts selections and name clashes within the segment only', async () => {
    const segment = await seedSegment();
    const goal = await seedGoal(segment.segmentId);
    expect(await repo.goals.selectionCount(t.db, goal.goalId)).toBe(0);
    await selections.open(t.db, {
      userId: randomUUID(),
      goalId: goal.goalId,
      segmentId: segment.segmentId,
      selectedAt: at,
    });
    expect(await repo.goals.selectionCount(t.db, goal.goalId)).toBe(1);
    expect(await repo.goals.nameClashes(t.db, segment.segmentId, goal)).toEqual({
      nameBn: true,
      nameEn: true,
    });
    const other = await seedSegment();
    expect(await repo.goals.nameClashes(t.db, other.segmentId, goal)).toEqual({
      nameBn: false,
      nameEn: false,
    });
  });
});

describe('selections', () => {
  it('opens, closes once and keeps history', async () => {
    const segment = await seedSegment();
    const goal = await seedGoal(segment.segmentId);
    const userId = randomUUID();
    const opened = await selections.open(t.db, {
      userId,
      goalId: goal.goalId,
      segmentId: segment.segmentId,
      selectedAt: at,
    });
    expect((await selections.current(t.db, userId))?.goalSelectionId).toBe(opened.goalSelectionId);
    expect(await selections.close(t.db, opened.goalSelectionId, at)).toBe(true);
    expect(await selections.close(t.db, opened.goalSelectionId, at)).toBe(false);
    expect(await selections.current(t.db, userId)).toBeUndefined();
  });

  it('refuses the second of two concurrent Goal changes (functional-spec §7)', async () => {
    const segment = await seedSegment();
    const [g1, g2, g3] = [
      await seedGoal(segment.segmentId),
      await seedGoal(segment.segmentId),
      await seedGoal(segment.segmentId),
    ];
    const userId = randomUUID();
    await selections.open(t.db, {
      userId,
      goalId: g1.goalId,
      segmentId: segment.segmentId,
      selectedAt: at,
    });
    // Two devices: two separate connections, each in its own transaction.
    const a = await t.pool.connect();
    const b = await t.pool.connect();
    const dbA = createDb(a as unknown as pg.Pool);
    const dbB = createDb(b as unknown as pg.Pool);
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const changeOn = async (db: typeof dbA, goalId: string) => {
        const open = await selections.currentForUpdate(db, userId);
        if (open) await selections.close(db, open.goalSelectionId, at);
        await selections.open(db, { userId, goalId, segmentId: segment.segmentId, selectedAt: at });
      };
      await changeOn(dbA, g2.goalId);
      const second = changeOn(dbB, g3.goalId).then(
        () => 'committed',
        (error: unknown) => (isUniqueViolation(error) ? 'refused' : `error ${String(error)}`),
      );
      // B blocks on A's row lock until A commits.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await a.query('COMMIT');
      expect(await second).toBe('refused');
      await b.query('ROLLBACK');
    } finally {
      a.release();
      b.release();
    }
    expect((await selections.current(t.db, userId))?.goalId).toBe(g2.goalId);
  });
});
