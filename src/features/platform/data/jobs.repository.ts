// JobRun persistence. Claiming uses FOR UPDATE SKIP LOCKED so one run executes on one worker (BR10.2).
import { eq, inArray, sql } from 'drizzle-orm';
import type { Json } from '#src/lib/json.ts';
import type { Executor } from '#src/server/db.ts';
import { jobRun } from '#src/server/schema/index.ts';

export type JobRow = typeof jobRun.$inferSelect;

export function createJobsRepository() {
  return {
    async findByKey(db: Executor, idempotencyKey: string) {
      const [row] = await db
        .select()
        .from(jobRun)
        .where(eq(jobRun.idempotencyKey, idempotencyKey))
        .limit(1);
      return row;
    },

    /** Inserts unless the key exists; returns the row for the key either way. */
    async insertOrGet(db: Executor, row: typeof jobRun.$inferInsert): Promise<JobRow> {
      await db.insert(jobRun).values(row).onConflictDoNothing({ target: jobRun.idempotencyKey });
      const [found] = await db
        .select()
        .from(jobRun)
        .where(eq(jobRun.idempotencyKey, row.idempotencyKey))
        .limit(1);
      return found as JobRow;
    },

    /**
     * Claims due runs: scheduled and due, waiting for a retry and due, or running with an expired
     * lease (a crashed worker; BR10.6). Each claim counts as one attempt.
     */
    async claimDue(
      db: Executor,
      input: { workerId: string; now: Date; leaseUntil: Date; limit: number },
    ): Promise<JobRow[]> {
      const result = await db.execute<{ job_run_id: string }>(sql`
        UPDATE job_run SET status = 'running', lock_owner = ${input.workerId}, lock_expires_at = ${input.leaseUntil.toISOString()}::timestamptz,
          started_at = ${input.now.toISOString()}::timestamptz, attempt = attempt + 1
        WHERE job_run_id IN (
          SELECT job_run_id FROM job_run
          WHERE (status = 'scheduled' AND scheduled_for <= ${input.now.toISOString()}::timestamptz)
             OR (status = 'retry_wait' AND next_attempt_at <= ${input.now.toISOString()}::timestamptz)
             OR (status = 'running' AND lock_expires_at < ${input.now.toISOString()}::timestamptz)
          ORDER BY scheduled_for
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED)
        RETURNING job_run_id`);
      if (result.rows.length === 0) return [];
      const ids = result.rows.map((r) => r.job_run_id);
      return db.select().from(jobRun).where(inArray(jobRun.jobRunId, ids));
    },

    async heartbeat(
      db: Executor,
      jobRunId: string,
      workerId: string,
      leaseUntil: Date,
    ): Promise<void> {
      await db.execute(sql`UPDATE job_run SET lock_expires_at = ${leaseUntil.toISOString()}::timestamptz
        WHERE job_run_id = ${jobRunId}::uuid AND lock_owner = ${workerId} AND status = 'running'`);
    },

    /** Finishes a run only if this worker still owns it (a taken-over run is left to its new owner). */
    async finish(
      db: Executor,
      input: {
        jobRunId: string;
        workerId: string;
        status: 'succeeded' | 'retry_wait' | 'failed';
        at: Date;
        nextAttemptAt?: Date;
        lastErrorCode?: string;
        resultSummary?: Json;
      },
    ): Promise<boolean> {
      const result =
        await db.execute(sql`UPDATE job_run SET status = ${input.status}, lock_owner = NULL, lock_expires_at = NULL,
          finished_at = ${input.status === 'retry_wait' ? null : input.at.toISOString()}::timestamptz,
          next_attempt_at = ${input.nextAttemptAt ? input.nextAttemptAt.toISOString() : null}::timestamptz,
          last_error_code = ${input.lastErrorCode ?? null},
          result_summary = ${input.resultSummary === undefined ? null : JSON.stringify(input.resultSummary)}::jsonb
        WHERE job_run_id = ${input.jobRunId}::uuid AND lock_owner = ${input.workerId} AND status = 'running'`);
      return (result.rowCount ?? 0) === 1;
    },
  };
}
