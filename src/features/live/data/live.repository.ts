// Live class reads and writes. A Student's attendance and answers are keyed by their own user ID.
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { liveAttendance, liveClass, liveQuiz, liveQuizAnswer } from '#src/server/schema/index.ts';

export type LiveClassRow = typeof liveClass.$inferSelect;
export type LiveQuizRow = typeof liveQuiz.$inferSelect;

export function createLiveRepository() {
  return {
    async byId(exec: Executor, id: string): Promise<LiveClassRow | null> {
      const rows = await exec
        .select()
        .from(liveClass)
        .where(eq(liveClass.liveClassId, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async insert(exec: Executor, row: Omit<typeof liveClass.$inferInsert, 'liveClassId'>) {
      const [created] = await exec.insert(liveClass).values(row).returning();
      return created as LiveClassRow;
    },
    async update(exec: Executor, id: string, patch: Partial<typeof liveClass.$inferInsert>) {
      const [row] = await exec
        .update(liveClass)
        .set(patch)
        .where(eq(liveClass.liveClassId, id))
        .returning();
      return row as LiveClassRow;
    },
    /** Classes of these courses that end after `since`, soonest first. */
    async forCourses(exec: Executor, courseIds: readonly string[], since: Date, limit: number) {
      if (courseIds.length === 0) return [];
      return exec
        .select()
        .from(liveClass)
        .where(
          and(
            inArray(liveClass.courseId, [...courseIds]),
            gte(
              sql`${liveClass.startsAt} + make_interval(mins => ${liveClass.durationMinutes})`,
              since,
            ),
          ),
        )
        .orderBy(asc(liveClass.startsAt))
        .limit(limit);
    },
    /** Every class that ends after `since` (Admins). */
    async allFrom(exec: Executor, since: Date, limit: number) {
      return exec
        .select()
        .from(liveClass)
        .where(
          gte(
            sql`${liveClass.startsAt} + make_interval(mins => ${liveClass.durationMinutes})`,
            since,
          ),
        )
        .orderBy(asc(liveClass.startsAt))
        .limit(limit);
    },
    /** Past classes of these courses that keep their recording, newest first. */
    async recordings(exec: Executor, courseIds: readonly string[], before: Date, limit: number) {
      if (courseIds.length === 0) return [];
      return exec
        .select()
        .from(liveClass)
        .where(
          and(
            inArray(liveClass.courseId, [...courseIds]),
            eq(liveClass.keepsRecording, true),
            eq(liveClass.isCancelled, false),
            sql`${liveClass.startsAt} + make_interval(mins => ${liveClass.durationMinutes}) < ${before}`,
          ),
        )
        .orderBy(desc(liveClass.startsAt))
        .limit(limit);
    },
    async attendance(exec: Executor, id: string) {
      return exec.select().from(liveAttendance).where(eq(liveAttendance.liveClassId, id));
    },
    async attendanceOf(exec: Executor, id: string, userId: string) {
      const rows = await exec
        .select()
        .from(liveAttendance)
        .where(and(eq(liveAttendance.liveClassId, id), eq(liveAttendance.userId, userId)))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async insertAttendance(exec: Executor, row: typeof liveAttendance.$inferInsert) {
      await exec.insert(liveAttendance).values(row).onConflictDoNothing();
    },
    async updateAttendance(
      exec: Executor,
      id: string,
      userId: string,
      lastSeenAt: Date,
      addSeconds: number,
    ) {
      await exec
        .update(liveAttendance)
        .set({ lastSeenAt, activeSeconds: sql`${liveAttendance.activeSeconds} + ${addSeconds}` })
        .where(and(eq(liveAttendance.liveClassId, id), eq(liveAttendance.userId, userId)));
    },
    async quizzes(exec: Executor, id: string): Promise<LiveQuizRow[]> {
      return exec
        .select()
        .from(liveQuiz)
        .where(eq(liveQuiz.liveClassId, id))
        .orderBy(asc(liveQuiz.startedAt));
    },
    async quizById(exec: Executor, quizId: string): Promise<LiveQuizRow | null> {
      const rows = await exec.select().from(liveQuiz).where(eq(liveQuiz.quizId, quizId)).limit(1);
      return rows[0] ?? null;
    },
    async insertQuiz(exec: Executor, row: Omit<typeof liveQuiz.$inferInsert, 'quizId'>) {
      const [created] = await exec.insert(liveQuiz).values(row).returning();
      return created as LiveQuizRow;
    },
    /** Marks a finished quiz's shields as handed out; true only for the one caller that did it. */
    async claimShieldAward(exec: Executor, quizId: string, at: Date): Promise<boolean> {
      const rows = await exec
        .update(liveQuiz)
        .set({ shieldsAwardedAt: at })
        .where(and(eq(liveQuiz.quizId, quizId), isNull(liveQuiz.shieldsAwardedAt)))
        .returning({ id: liveQuiz.quizId });
      return rows.length > 0;
    },
    async answers(exec: Executor, quizIds: readonly string[]) {
      if (quizIds.length === 0) return [];
      return exec
        .select()
        .from(liveQuizAnswer)
        .where(inArray(liveQuizAnswer.quizId, [...quizIds]));
    },
    /** One answer per question per Student; a second one is ignored. */
    async insertAnswer(exec: Executor, row: typeof liveQuizAnswer.$inferInsert): Promise<boolean> {
      const inserted = await exec
        .insert(liveQuizAnswer)
        .values(row)
        .onConflictDoNothing()
        .returning();
      return inserted.length > 0;
    },
  };
}
