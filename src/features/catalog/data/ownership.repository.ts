// Ownership periods (entities.md SectionOwnership) and the review history (SectionReview). Both
// are append-only: a period is only ever closed (valid_to set once, version bumped), never edited
// or deleted, and review entries are only inserted (NFR6.206, BR8.7; enforced again by triggers).
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { ownershipPeriod, sectionReview } from '#src/server/schema/index.ts';

export type PeriodRow = typeof ownershipPeriod.$inferSelect;

/** Upper bound for one section's history read (SC-209). */
export const MAX_PERIODS_READ = 1000;

export function createOwnershipRepository() {
  return {
    /** The open period of each listed section (at most one per section, BR6.4). */
    async openForSections(exec: Executor, sectionIds: readonly string[]): Promise<PeriodRow[]> {
      if (sectionIds.length === 0) return [];
      return exec
        .select()
        .from(ownershipPeriod)
        .where(
          and(inArray(ownershipPeriod.sectionId, [...sectionIds]), isNull(ownershipPeriod.validTo)),
        )
        .limit(sectionIds.length);
    },
    async openForUpdate(exec: Executor, sectionId: string): Promise<PeriodRow | undefined> {
      const [row] = await exec
        .select()
        .from(ownershipPeriod)
        .where(and(eq(ownershipPeriod.sectionId, sectionId), isNull(ownershipPeriod.validTo)))
        .limit(1)
        .for('update');
      return row;
    },
    async history(exec: Executor, sectionId: string): Promise<PeriodRow[]> {
      return exec
        .select()
        .from(ownershipPeriod)
        .where(eq(ownershipPeriod.sectionId, sectionId))
        .orderBy(asc(ownershipPeriod.validFrom))
        .limit(MAX_PERIODS_READ);
    },
    /** Closes the open period at `at` if it still has the expected version (BR12.1). */
    async close(
      exec: Executor,
      sectionOwnershipId: string,
      expectedVersion: number,
      at: Date,
    ): Promise<boolean> {
      const rows = await exec
        .update(ownershipPeriod)
        .set({ validTo: at, version: sql`${ownershipPeriod.version} + 1` })
        .where(
          and(
            eq(ownershipPeriod.sectionOwnershipId, sectionOwnershipId),
            eq(ownershipPeriod.version, expectedVersion),
            isNull(ownershipPeriod.validTo),
          ),
        )
        .returning({ id: ownershipPeriod.sectionOwnershipId });
      return rows.length === 1;
    },
    async open(exec: Executor, values: typeof ownershipPeriod.$inferInsert): Promise<PeriodRow> {
      const [row] = await exec.insert(ownershipPeriod).values(values).returning();
      return row as PeriodRow;
    },
    async addReview(exec: Executor, values: typeof sectionReview.$inferInsert): Promise<void> {
      await exec.insert(sectionReview).values(values);
    },
  };
}

export type OwnershipRepository = ReturnType<typeof createOwnershipRepository>;
