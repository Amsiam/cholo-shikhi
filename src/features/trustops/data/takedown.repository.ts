// Takedown notices (Admin only; the server functions check the role).
import { desc, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { takedownNotice } from '#src/server/schema/index.ts';

export type NoticeRow = typeof takedownNotice.$inferSelect;

export function createTakedownRepository() {
  return {
    async list(exec: Executor, limit: number): Promise<NoticeRow[]> {
      return exec.select().from(takedownNotice).orderBy(desc(takedownNotice.loggedAt)).limit(limit);
    },
    async forUpdate(exec: Executor, noticeId: string): Promise<NoticeRow | null> {
      const rows = await exec
        .select()
        .from(takedownNotice)
        .where(eq(takedownNotice.noticeId, noticeId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(exec: Executor, row: typeof takedownNotice.$inferInsert): Promise<NoticeRow> {
      const [created] = await exec.insert(takedownNotice).values(row).returning();
      return created as NoticeRow;
    },
    async update(
      exec: Executor,
      noticeId: string,
      patch: Partial<typeof takedownNotice.$inferInsert>,
    ): Promise<void> {
      await exec.update(takedownNotice).set(patch).where(eq(takedownNotice.noticeId, noticeId));
    },
  };
}
