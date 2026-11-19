// Goal segments and Goals (entities.md). Writes are version-checked in the UPDATE itself and run
// under a row lock taken by the caller (BR12.1, BR12.2). Every read is bounded (SC-209).
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Executor } from '#src/server/db.ts';
import { goal, goalSegment, studentGoalSelection } from '#src/server/schema/index.ts';

export type SegmentRow = typeof goalSegment.$inferSelect;
export type GoalRow = typeof goal.$inferSelect;

/** Upper bound for the S1 picker and the contract 5 segment read: far above any real catalogue. */
export const MAX_GOALS_READ = 2000;
export const MAX_SEGMENTS_READ = 500;

/** A version-checked write either applies, finds the row gone, or finds a newer version. */
export type VersionedWrite<T> =
  | { kind: 'applied'; row: T }
  | { kind: 'missing' }
  | { kind: 'stale'; currentVersion: number };

/** PostgreSQL unique violation, whether raised directly or wrapped by the query builder. */
export function isUniqueViolation(error: unknown): boolean {
  const codeOf = (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : undefined;
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return codeOf(error) === '23505' || codeOf(cause) === '23505';
}

const lowerTrim = (column: AnyPgColumn) => sql`lower(btrim(${column}))`;

export function createGoalsRepository() {
  async function versioned<T>(
    run: () => Promise<T[]>,
    currentVersion: () => Promise<number | undefined>,
  ): Promise<VersionedWrite<T>> {
    const [row] = await run();
    if (row) return { kind: 'applied', row };
    const version = await currentVersion();
    return version === undefined ? { kind: 'missing' } : { kind: 'stale', currentVersion: version };
  }

  const segments = {
    async list(exec: Executor, page: { limit: number; offset: number }) {
      const rows = await exec
        .select({ segment: goalSegment, goalCount: count(goal.goalId) })
        .from(goalSegment)
        .leftJoin(goal, eq(goal.segmentId, goalSegment.segmentId))
        .groupBy(goalSegment.segmentId)
        .orderBy(asc(goalSegment.sortOrder), asc(goalSegment.nameEn))
        .limit(page.limit)
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(goalSegment);
      return {
        rows: rows.map((r) => ({ ...r.segment, goalCount: r.goalCount })),
        total: total?.n ?? 0,
      };
    },
    async listAll(exec: Executor): Promise<SegmentRow[]> {
      return exec
        .select()
        .from(goalSegment)
        .orderBy(asc(goalSegment.sortOrder), asc(goalSegment.nameEn))
        .limit(MAX_SEGMENTS_READ);
    },
    async get(exec: Executor, segmentId: string): Promise<SegmentRow | undefined> {
      const [row] = await exec
        .select()
        .from(goalSegment)
        .where(eq(goalSegment.segmentId, segmentId))
        .limit(1);
      return row;
    },
    async getForUpdate(exec: Executor, segmentId: string): Promise<SegmentRow | undefined> {
      const [row] = await exec
        .select()
        .from(goalSegment)
        .where(eq(goalSegment.segmentId, segmentId))
        .limit(1)
        .for('update');
      return row;
    },
    /** BR1.2: which names another segment already uses (case-insensitive, trimmed). */
    async nameClashes(
      exec: Executor,
      names: { nameBn: string; nameEn: string },
      excludeSegmentId?: string,
    ): Promise<{ nameBn: boolean; nameEn: boolean }> {
      const others = excludeSegmentId ? ne(goalSegment.segmentId, excludeSegmentId) : undefined;
      const hit = async (column: AnyPgColumn, value: string) => {
        const [row] = await exec
          .select({ id: goalSegment.segmentId })
          .from(goalSegment)
          .where(and(sql`${lowerTrim(column)} = lower(btrim(${value}))`, others))
          .limit(1);
        return Boolean(row);
      };
      return {
        nameBn: await hit(goalSegment.nameBn, names.nameBn),
        nameEn: await hit(goalSegment.nameEn, names.nameEn),
      };
    },
    async insert(exec: Executor, values: typeof goalSegment.$inferInsert): Promise<SegmentRow> {
      const [row] = await exec.insert(goalSegment).values(values).returning();
      return row as SegmentRow;
    },
    async update(
      exec: Executor,
      segmentId: string,
      expectedVersion: number,
      patch: Pick<SegmentRow, 'nameBn' | 'nameEn' | 'segmentType' | 'battleBand' | 'sortOrder'>,
      at: Date,
    ): Promise<VersionedWrite<SegmentRow>> {
      return versioned(
        () =>
          exec
            .update(goalSegment)
            .set({ ...patch, version: sql`${goalSegment.version} + 1`, updatedAt: at })
            .where(
              and(eq(goalSegment.segmentId, segmentId), eq(goalSegment.version, expectedVersion)),
            )
            .returning(),
        async () => (await segments.get(exec, segmentId))?.version,
      );
    },
    async delete(
      exec: Executor,
      segmentId: string,
      expectedVersion: number,
    ): Promise<VersionedWrite<{ segmentId: string }>> {
      return versioned(
        () =>
          exec
            .delete(goalSegment)
            .where(
              and(eq(goalSegment.segmentId, segmentId), eq(goalSegment.version, expectedVersion)),
            )
            .returning({ segmentId: goalSegment.segmentId }),
        async () => (await segments.get(exec, segmentId))?.version,
      );
    },
    async goalCount(exec: Executor, segmentId: string): Promise<number> {
      const [row] = await exec
        .select({ n: count() })
        .from(goal)
        .where(eq(goal.segmentId, segmentId));
      return row?.n ?? 0;
    },
  };

  const goals = {
    async list(exec: Executor, page: { limit: number; offset: number; segmentId?: string }) {
      const where = page.segmentId ? eq(goal.segmentId, page.segmentId) : undefined;
      const rows = await exec
        .select()
        .from(goal)
        .where(where)
        .orderBy(asc(goal.sortOrder), asc(goal.nameEn))
        .limit(page.limit)
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(goal).where(where);
      return { rows, total: total?.n ?? 0 };
    },
    async listActive(exec: Executor): Promise<GoalRow[]> {
      return exec
        .select()
        .from(goal)
        .where(eq(goal.status, 'active'))
        .orderBy(asc(goal.sortOrder), asc(goal.nameEn))
        .limit(MAX_GOALS_READ);
    },
    async get(exec: Executor, goalId: string): Promise<GoalRow | undefined> {
      const [row] = await exec.select().from(goal).where(eq(goal.goalId, goalId)).limit(1);
      return row;
    },
    async getForUpdate(exec: Executor, goalId: string): Promise<GoalRow | undefined> {
      const [row] = await exec
        .select()
        .from(goal)
        .where(eq(goal.goalId, goalId))
        .limit(1)
        .for('update');
      return row;
    },
    /** A shared lock: many students may choose one Goal at once; a retire waits for them (BR12.2). */
    async getForShare(exec: Executor, goalId: string): Promise<GoalRow | undefined> {
      const [row] = await exec
        .select()
        .from(goal)
        .where(eq(goal.goalId, goalId))
        .limit(1)
        .for('share');
      return row;
    },
    /** BR1.3: which names another Goal of the same segment already uses. */
    async nameClashes(
      exec: Executor,
      segmentId: string,
      names: { nameBn: string; nameEn: string },
      excludeGoalId?: string,
    ): Promise<{ nameBn: boolean; nameEn: boolean }> {
      const others = excludeGoalId ? ne(goal.goalId, excludeGoalId) : undefined;
      const hit = async (column: AnyPgColumn, value: string) => {
        const [row] = await exec
          .select({ id: goal.goalId })
          .from(goal)
          .where(
            and(
              eq(goal.segmentId, segmentId),
              sql`${lowerTrim(column)} = lower(btrim(${value}))`,
              others,
            ),
          )
          .limit(1);
        return Boolean(row);
      };
      return {
        nameBn: await hit(goal.nameBn, names.nameBn),
        nameEn: await hit(goal.nameEn, names.nameEn),
      };
    },
    async insert(exec: Executor, values: typeof goal.$inferInsert): Promise<GoalRow> {
      const [row] = await exec.insert(goal).values(values).returning();
      return row as GoalRow;
    },
    async update(
      exec: Executor,
      goalId: string,
      expectedVersion: number,
      patch: Partial<
        Pick<GoalRow, 'segmentId' | 'nameBn' | 'nameEn' | 'status' | 'sortOrder' | 'retiredAt'>
      >,
      at: Date,
    ): Promise<VersionedWrite<GoalRow>> {
      return versioned(
        () =>
          exec
            .update(goal)
            .set({ ...patch, version: sql`${goal.version} + 1`, updatedAt: at })
            .where(and(eq(goal.goalId, goalId), eq(goal.version, expectedVersion)))
            .returning(),
        async () => (await goals.get(exec, goalId))?.version,
      );
    },
    /** BR1.7: selections ever made of the Goal (open or ended). */
    async selectionCount(exec: Executor, goalId: string): Promise<number> {
      const [row] = await exec
        .select({ n: count() })
        .from(studentGoalSelection)
        .where(eq(studentGoalSelection.goalId, goalId));
      return row?.n ?? 0;
    },
    /** BR13.6: IDs of every Goal (any status) in the segments, ascending, no duplicates. */
    async idsInSegments(exec: Executor, segmentIds: readonly string[]): Promise<string[]> {
      if (segmentIds.length === 0) return [];
      const rows = await exec
        .select({ goalId: goal.goalId })
        .from(goal)
        .where(inArray(goal.segmentId, [...new Set(segmentIds)]))
        .orderBy(asc(goal.goalId))
        .limit(MAX_GOALS_READ);
      return rows.map((r) => r.goalId);
    },
  };

  return { segments, goals };
}

export type GoalsRepository = ReturnType<typeof createGoalsRepository>;
