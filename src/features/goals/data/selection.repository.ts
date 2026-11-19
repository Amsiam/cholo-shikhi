// Student Goal selections (entities.md StudentGoalSelection). The open selection is the student's
// current Goal; it is read under a row lock before a change (BR12.2), and the partial unique index
// refuses a second open selection from a concurrent change (BR2.4).
import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { studentGoalSelection } from '#src/server/schema/index.ts';

export type SelectionRow = typeof studentGoalSelection.$inferSelect;

export function createSelectionRepository() {
  const open = isNull(studentGoalSelection.endedAt);
  return {
    async current(exec: Executor, userId: string): Promise<SelectionRow | undefined> {
      const [row] = await exec
        .select()
        .from(studentGoalSelection)
        .where(and(eq(studentGoalSelection.userId, userId), open))
        .limit(1);
      return row;
    },
    async currentForUpdate(exec: Executor, userId: string): Promise<SelectionRow | undefined> {
      const [row] = await exec
        .select()
        .from(studentGoalSelection)
        .where(and(eq(studentGoalSelection.userId, userId), open))
        .limit(1)
        .for('update');
      return row;
    },
    /** Sets endedAt and endReason once; an already ended row is left untouched. */
    async close(exec: Executor, goalSelectionId: string, at: Date): Promise<boolean> {
      const rows = await exec
        .update(studentGoalSelection)
        .set({ endedAt: at, endReason: 'changed' })
        .where(and(eq(studentGoalSelection.goalSelectionId, goalSelectionId), open))
        .returning({ id: studentGoalSelection.goalSelectionId });
      return rows.length === 1;
    },
    /** Throws a unique violation when another open selection exists (see isUniqueViolation). */
    async open(
      exec: Executor,
      values: { userId: string; goalId: string; segmentId: string; selectedAt: Date },
    ): Promise<SelectionRow> {
      const [row] = await exec.insert(studentGoalSelection).values(values).returning();
      return row as SelectionRow;
    },
  };
}

export type SelectionRepository = ReturnType<typeof createSelectionRepository>;
