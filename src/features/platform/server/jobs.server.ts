// Background jobs (US11.5, contract 3 jobs.schedule): JobRun rows, due-time claiming with a heartbeat
// lease so one worker runs a run at a time (BR10.2), exponential retry (BR10.3) and an alert when
// the last attempt fails (BR10.4). Handlers must be idempotent (BR10.6).
import { createHash } from 'node:crypto';
import { correlationIdFrom } from '#src/lib/correlation.ts';
import { type AppError, appError, isAppError } from '#src/lib/errors.ts';
import { IdempotencyKey, UtcInstant } from '#src/lib/ids.ts';
import { type Json, stableStringify } from '#src/lib/json.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';
import { createJobsRepository, type JobRow } from '../data/jobs.repository.ts';
import { decideAfterFailure, nextSlot } from '../domain/retry.ts';

export type JobContext = {
  jobRunId: string;
  jobName: string;
  payload: unknown;
  attempt: number;
  correlationId: string;
};
export type JobHandler = (ctx: JobContext) => Promise<Result<Json, AppError>>;
export type JobAlert = {
  code: 'JOB_FAILED';
  jobName: string;
  jobRunId: string;
  attempt: number;
  lastErrorCode: string;
};
export type RecurringJob = { name: string; everyMinutes: number; payload?: Json };

export type JobsDeps = {
  db: Database;
  clock: Clock;
  workerId: string;
  handlers: Readonly<Record<string, JobHandler>>;
  metrics: Metrics;
  onAlert: (alert: JobAlert) => void;
  random?: () => number;
  leaseMs?: number;
  batchSize?: number;
  defaultMaxAttempts?: number;
};

export function payloadDigest(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function createJobs(deps: JobsDeps) {
  const repo = createJobsRepository();
  const log = getLogger().child({ component: 'jobs', workerId: deps.workerId });
  const leaseMs = deps.leaseMs ?? 5 * 60 * 1000;
  const random = deps.random ?? Math.random;

  /** Contract 3. The same key with the same payload returns the first run; a different payload is refused (BR10.5). */
  async function schedule(job: {
    name: string;
    runAt: string;
    payload: Json;
    idempotencyKey: string;
    maxAttempts?: number;
  }): Promise<
    Result<{ jobRunId: string }, AppError<'IDEMPOTENCY_CONFLICT' | 'VALIDATION_FAILED'>>
  > {
    if (
      !IdempotencyKey.safeParse(job.idempotencyKey).success ||
      !UtcInstant.safeParse(job.runAt).success ||
      !job.name
    ) {
      return err(appError('VALIDATION_FAILED'));
    }
    const digest = payloadDigest(job.payload);
    const row = await repo.insertOrGet(deps.db, {
      jobName: job.name,
      idempotencyKey: job.idempotencyKey,
      payloadDigest: digest,
      payload: job.payload,
      scheduledFor: new Date(job.runAt),
      maxAttempts: job.maxAttempts ?? deps.defaultMaxAttempts ?? 5,
    });
    if (row.payloadDigest !== digest || row.jobName !== job.name)
      return err(appError('IDEMPOTENCY_CONFLICT'));
    return ok({ jobRunId: row.jobRunId });
  }

  /** Schedules the next slot of each recurring job; the slot time is part of the key (BR10.1). */
  async function ensureRecurring(jobs: readonly RecurringJob[]): Promise<void> {
    for (const job of jobs) {
      const slot = nextSlot(deps.clock.now(), job.everyMinutes);
      await schedule({
        name: job.name,
        runAt: slot,
        payload: job.payload ?? {},
        idempotencyKey: `${job.name}:${slot}`,
      });
    }
  }

  async function runOne(row: JobRow): Promise<void> {
    const handler = deps.handlers[row.jobName];
    const correlationId = correlationIdFrom(null);
    const heartbeat = setInterval(
      () => {
        void repo
          .heartbeat(deps.db, row.jobRunId, deps.workerId, new Date(Date.now() + leaseMs))
          .catch((error: unknown) => {
            log.warn({ err: error, code: 'JOB_HEARTBEAT_FAILED' }, 'heartbeat failed');
          });
      },
      Math.max(1000, Math.floor(leaseMs / 3)),
    );
    let outcome: Result<Json, AppError>;
    try {
      outcome = handler
        ? await handler({
            jobRunId: row.jobRunId,
            jobName: row.jobName,
            payload: row.payload,
            attempt: row.attempt,
            correlationId,
          })
        : err(appError('NO_HANDLER', { namespace: 'platform' }));
    } catch (error) {
      log.error(
        { err: error, jobName: row.jobName, correlationId, code: 'JOB_THREW' },
        'job handler threw',
      );
      outcome = err(isAppError(error) ? error : appError('UNEXPECTED', { namespace: 'platform' }));
    } finally {
      clearInterval(heartbeat);
    }
    const at = new Date(deps.clock.now());
    if (outcome.ok) {
      await repo.finish(deps.db, {
        jobRunId: row.jobRunId,
        workerId: deps.workerId,
        status: 'succeeded',
        at,
        resultSummary: outcome.value,
      });
      deps.metrics.increment('jobs_total', { job: row.jobName, outcome: 'succeeded' });
      return;
    }
    const decision = decideAfterFailure(row.attempt, row.maxAttempts, deps.clock.now(), random);
    const isMine = await repo.finish(deps.db, {
      jobRunId: row.jobRunId,
      workerId: deps.workerId,
      status: decision.status,
      at,
      lastErrorCode: outcome.error.code,
      ...(decision.status === 'retry_wait'
        ? { nextAttemptAt: new Date(decision.nextAttemptAt) }
        : {}),
    });
    deps.metrics.increment('jobs_total', { job: row.jobName, outcome: decision.status });
    if (decision.status === 'failed' && isMine) {
      // BR10.4: an operational alert. Paging is deferred (human decision 2026-11-13); this is a logged event.
      const alert: JobAlert = {
        code: 'JOB_FAILED',
        jobName: row.jobName,
        jobRunId: row.jobRunId,
        attempt: row.attempt,
        lastErrorCode: outcome.error.code,
      };
      log.error(alert, 'job failed after its last attempt');
      deps.onAlert(alert);
    }
  }

  /** One scheduler pass: claim due runs and execute them. */
  async function tick(): Promise<number> {
    const now = new Date(deps.clock.now());
    const claimed = await repo.claimDue(deps.db, {
      workerId: deps.workerId,
      now,
      leaseUntil: new Date(now.getTime() + leaseMs),
      limit: deps.batchSize ?? 10,
    });
    for (const row of claimed) await runOne(row);
    return claimed.length;
  }

  return { schedule, ensureRecurring, tick };
}

export type Jobs = ReturnType<typeof createJobs>;
