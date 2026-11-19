// Stored monthly earnings statements. Always read by the instructor's own user ID.
import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { earningsStatement } from '#src/server/schema/index.ts';

export type EarningsStatementRow = typeof earningsStatement.$inferSelect;

export function createStatementsRepository() {
  return {
    /** The newest stored version's rows (one per language) for a month, or [] if none. */
    async latest(
      exec: Executor,
      instructorId: string,
      month: string,
    ): Promise<EarningsStatementRow[]> {
      const rows = await exec
        .select()
        .from(earningsStatement)
        .where(
          and(eq(earningsStatement.instructorId, instructorId), eq(earningsStatement.month, month)),
        )
        .orderBy(desc(earningsStatement.version));
      const top = rows[0]?.version;
      return top === undefined ? [] : rows.filter((r) => r.version === top);
    },
    /** Stores one language of a version; a repeat (same version and language) does nothing. */
    async insert(exec: Executor, row: typeof earningsStatement.$inferInsert): Promise<boolean> {
      const rows = await exec
        .insert(earningsStatement)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: earningsStatement.statementId });
      return rows.length > 0;
    },
  };
}
