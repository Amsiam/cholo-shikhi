// One-time notices a Student has dismissed, scoped by the Student's own user ID.
import { and, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { learnerNotice } from '#src/server/schema/index.ts';

export type NoticeKey = 'video_badge';

export function createNoticeRepository() {
  return {
    async hasSeen(exec: Executor, userId: string, notice: NoticeKey): Promise<boolean> {
      const rows = await exec
        .select({ seenAt: learnerNotice.seenAt })
        .from(learnerNotice)
        .where(and(eq(learnerNotice.userId, userId), eq(learnerNotice.notice, notice)))
        .limit(1);
      return rows.length > 0;
    },
    async markSeen(exec: Executor, userId: string, notice: NoticeKey, at: Date): Promise<void> {
      await exec.insert(learnerNotice).values({ userId, notice, seenAt: at }).onConflictDoNothing();
    },
  };
}
