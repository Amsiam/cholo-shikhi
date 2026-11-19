// Course NPS answers. A Student's own answer is read by their user ID; the instructor dashboard
// reads only scores per course (no user IDs leave this file).
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { courseNps } from '#src/server/schema/index.ts';

export function createNpsRepository() {
  return {
    async hasAnswered(exec: Executor, userId: string, courseId: string): Promise<boolean> {
      const rows = await exec
        .select({ score: courseNps.score })
        .from(courseNps)
        .where(and(eq(courseNps.userId, userId), eq(courseNps.courseId, courseId)))
        .limit(1);
      return rows.length > 0;
    },
    /** The first answer (or skip) is kept; asking again changes nothing (AC7.18.2). */
    async answer(
      exec: Executor,
      row: { userId: string; courseId: string; score: number | null; answeredAt: Date },
    ): Promise<boolean> {
      const rows = await exec
        .insert(courseNps)
        .values(row)
        .onConflictDoNothing()
        .returning({ courseId: courseNps.courseId });
      return rows.length > 0;
    },
    async scoresOf(exec: Executor, courseIds: readonly string[]): Promise<Map<string, number[]>> {
      const out = new Map<string, number[]>();
      if (courseIds.length === 0) return out;
      const rows = await exec
        .select({ courseId: courseNps.courseId, score: courseNps.score })
        .from(courseNps)
        .where(and(inArray(courseNps.courseId, [...courseIds]), isNotNull(courseNps.score)));
      for (const r of rows)
        out.set(r.courseId, [...(out.get(r.courseId) ?? []), r.score as number]);
      return out;
    },
  };
}
