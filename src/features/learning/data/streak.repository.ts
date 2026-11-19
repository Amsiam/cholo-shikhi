// Goal-streak reads: the distinct Asia/Dhaka days on which the Student did a qualifying activity
// (lesson finished, quiz attempted, Vault practised, live class attended).
// Scoped by the caller's user ID; course IDs and the Goal come from the service.
import { sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';

/** Distinct Asia/Dhaka days with a qualifying activity, since `since`. */
export async function activityDays(
  exec: Executor,
  userId: string,
  courseIds: readonly string[],
  goalId: string,
  since: Date,
): Promise<string[]> {
  const day = (col: string) => sql.raw(`to_char(${col} at time zone 'Asia/Dhaka', 'YYYY-MM-DD')`);
  const courses = courseIds.length > 0 ? courseIds : ['00000000-0000-0000-0000-000000000000'];
  const courseList = sql.join(
    courses.map((c) => sql`${c}::uuid`),
    sql`, `,
  );
  const result = await exec.execute<{ day: string }>(sql`
    SELECT ${day('completed_at')} AS day FROM lesson_progress
     WHERE user_id = ${userId} AND course_id IN (${courseList}) AND completed_at >= ${since}
    UNION
    SELECT ${day('submitted_at')} FROM quiz_attempt
     WHERE user_id = ${userId} AND course_id IN (${courseList}) AND submitted_at >= ${since}
    UNION
    SELECT ${day('a.answered_at')} FROM vault_answer a
      JOIN vault_item i ON i.user_id = a.user_id AND i.question_id = a.question_id
     WHERE a.user_id = ${userId} AND i.goal_id = ${goalId} AND a.answered_at >= ${since}
    UNION
    SELECT day FROM streak_activity
     WHERE user_id = ${userId} AND course_id IN (${courseList}) AND at >= ${since}
  `);
  return result.rows.map((r) => r.day);
}
