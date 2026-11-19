// [AT] US11.5 Run background jobs reliably (written before the scheduler exists).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createJobs, type JobHandler } from './jobs.server.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

function scheduler(
  workerId: string,
  clock: ReturnType<typeof fixedClock>,
  handlers: Record<string, JobHandler>,
  onAlert = vi.fn(),
) {
  return createJobs({
    db: t.db,
    clock,
    workerId,
    handlers,
    metrics: createMetrics(),
    onAlert,
    random: () => 0.5,
  });
}

describe('US11.5 Run background jobs reliably', () => {
  it('AC11.5.1 Given a job scheduled for 10:00, When the scheduler ticks (fake clock), Then it runs once and its result is recorded', async () => {
    const clock = fixedClock('2026-11-13T09:59:00.000Z');
    const handler = vi.fn(async () => ok({ processed: 3 }));
    const jobs = scheduler('w1', clock, { 'test.report': handler });
    const scheduled = await jobs.schedule({
      name: 'test.report',
      runAt: '2026-11-13T10:00:00.000Z',
      payload: { reportId: 'r1' },
      idempotencyKey: 'test.report:2026-11-13T10:00',
    });
    expect(scheduled.ok).toBe(true);
    await jobs.tick();
    expect(handler).not.toHaveBeenCalled();
    clock.set('2026-11-13T10:00:00.000Z');
    await jobs.tick();
    await jobs.tick();
    expect(handler).toHaveBeenCalledOnce();
    const { rows } = await t.pool.query(
      "SELECT status, result_summary FROM job_run WHERE idempotency_key = 'test.report:2026-11-13T10:00'",
    );
    expect(rows[0]).toEqual({ status: 'succeeded', result_summary: { processed: 3 } });
  });

  it('AC11.5.2 Given two scheduler instances, When both try to run the same job, Then only one does', async () => {
    const clock = fixedClock('2026-11-13T11:00:00.000Z');
    let runs = 0;
    const slow: JobHandler = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 50));
      return ok({});
    };
    const a = scheduler('worker-a', clock, { 'test.lock': slow });
    const b = scheduler('worker-b', clock, { 'test.lock': slow });
    await a.schedule({
      name: 'test.lock',
      runAt: '2026-11-13T11:00:00.000Z',
      payload: {},
      idempotencyKey: 'test.lock:1100',
    });
    await Promise.all([a.tick(), b.tick(), a.tick(), b.tick()]);
    expect(runs).toBe(1);
  });

  it('AC11.5.3 Given a job that fails R=5 times, When the last retry fails, Then an operational alert is raised', async () => {
    const clock = fixedClock('2026-11-13T12:00:00.000Z');
    const onAlert = vi.fn();
    const failing: JobHandler = async () => {
      throw new Error('downstream unavailable');
    };
    const jobs = scheduler('w3', clock, { 'test.fails': failing }, onAlert);
    await jobs.schedule({
      name: 'test.fails',
      runAt: '2026-11-13T12:00:00.000Z',
      payload: {},
      idempotencyKey: 'test.fails:1200',
    });
    for (let i = 0; i < 5; i++) {
      await jobs.tick();
      clock.advanceMs(60 * 60 * 1000);
    }
    const { rows } = await t.pool.query(
      "SELECT status, attempt FROM job_run WHERE idempotency_key = 'test.fails:1200'",
    );
    expect(rows[0]).toEqual({ status: 'failed', attempt: 5 });
    expect(onAlert).toHaveBeenCalledOnce();
    expect(onAlert.mock.calls[0]?.[0]).toMatchObject({ code: 'JOB_FAILED', jobName: 'test.fails' });
  });
});
