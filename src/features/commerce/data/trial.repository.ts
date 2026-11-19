// Free-trial reads and writes (FR-DIST-1). Student reads are scoped by the caller's user ID.
import { and, eq } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { courseTrial, trialOffer } from '#src/server/schema/index.ts';

export type TrialRow = typeof courseTrial.$inferSelect;

export function createTrialRepository() {
  return {
    async offers(exec: Executor) {
      return exec.select().from(trialOffer);
    },
    async offerOfSegment(exec: Executor, segmentId: string) {
      const rows = await exec
        .select()
        .from(trialOffer)
        .where(eq(trialOffer.segmentId, segmentId))
        .limit(1);
      return rows[0] ?? null;
    },
    async offerOfCourse(exec: Executor, courseId: string) {
      const rows = await exec
        .select()
        .from(trialOffer)
        .where(eq(trialOffer.courseId, courseId))
        .limit(1);
      return rows[0] ?? null;
    },
    /** Makes the course its segment's trial course, replacing any earlier one. */
    async setOffer(exec: Executor, row: { segmentId: string; courseId: string; setBy: string }) {
      await exec.delete(trialOffer).where(eq(trialOffer.courseId, row.courseId));
      await exec
        .insert(trialOffer)
        .values(row)
        .onConflictDoUpdate({
          target: trialOffer.segmentId,
          set: { courseId: row.courseId, setBy: row.setBy, setAt: new Date() },
        });
    },
    async clearOffer(exec: Executor, segmentId: string) {
      await exec.delete(trialOffer).where(eq(trialOffer.segmentId, segmentId));
    },
    async trialOfSegment(
      exec: Executor,
      userId: string,
      segmentId: string,
    ): Promise<TrialRow | null> {
      const rows = await exec
        .select()
        .from(courseTrial)
        .where(and(eq(courseTrial.userId, userId), eq(courseTrial.segmentId, segmentId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async trialOfCourse(
      exec: Executor,
      userId: string,
      courseId: string,
    ): Promise<TrialRow | null> {
      const rows = await exec
        .select()
        .from(courseTrial)
        .where(and(eq(courseTrial.userId, userId), eq(courseTrial.courseId, courseId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async trialsOf(exec: Executor, userId: string): Promise<TrialRow[]> {
      return exec.select().from(courseTrial).where(eq(courseTrial.userId, userId));
    },
    /** Starts a trial; a second one in the same segment is refused by the primary key. */
    async insertTrial(
      exec: Executor,
      row: {
        userId: string;
        segmentId: string;
        courseId: string;
        startedAt: Date;
        endsAt: Date;
        lessonCap: number;
      },
    ): Promise<boolean> {
      const rows = await exec
        .insert(courseTrial)
        .values(row)
        .onConflictDoNothing()
        .returning({ userId: courseTrial.userId });
      return rows.length > 0;
    },
  };
}
