// [LT] jobs: idempotency (BR10.1, BR10.5), lease takeover (BR10.6), recurring slots, missing handler.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createJobs, type JobHandler, payloadDigest } from './jobs.server.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

const make = (
  workerId: string,
  clock: ReturnType<typeof fixedClock>,
  handlers: Record<string, JobHandler>,
  leaseMs = 60_000,
) =>
  createJobs({
    db: t.db,
    clock,
    workerId,
    handlers,
    metrics: createMetrics(),
    onAlert: vi.fn(),
    random: () => 0.5,
    leaseMs,
  });

describe('jobs.schedule (contract 3)', () => {
  it('returns the first run for a repeated key with the same payload, and refuses a different payload', async () => {
    const jobs = make('w', fixedClock('2026-11-13T00:00:00.000Z'), {});
    const job = {
      name: 'test.idem',
      runAt: '2026-11-13T01:00:00.000Z',
      payload: { a: 1, b: 2 },
      idempotencyKey: 'test.idem:0100',
    };
    const first = await jobs.schedule(job);
    const again = await jobs.schedule({ ...job, payload: { b: 2, a: 1 } });
    expect(again).toEqual(first);
    expect(await jobs.schedule({ ...job, payload: { a: 9 } })).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });
  it('validates the key and run time', async () => {
    const jobs = make('w', fixedClock('2026-11-13T00:00:00.000Z'), {});
    expect(
      await jobs.schedule({
        name: 'x',
        runAt: 'tomorrow',
        payload: {},
        idempotencyKey: 'test.bad:1',
      }),
    ).toMatchObject({ ok: false });
    expect(
      await jobs.schedule({
        name: 'x',
        runAt: '2026-11-13T00:00:00.000Z',
        payload: {},
        idempotencyKey: 'short',
      }),
    ).toMatchObject({ ok: false });
  });
  it('digests payloads independently of key order', () => {
    expect(payloadDigest({ a: 1, b: 2 })).toBe(payloadDigest({ b: 2, a: 1 }));
  });
});

describe('scheduler', () => {
  it('lets another worker take over a running job whose lease expired without a heartbeat (BR10.6)', async () => {
    const clock = fixedClock('2026-11-13T02:00:00.000Z');
    const jobs = make('crashed', clock, {});
    await jobs.schedule({
      name: 'test.takeover',
      runAt: '2026-11-13T02:00:00.000Z',
      payload: {},
      idempotencyKey: 'test.takeover:1',
    });
    // Simulate a worker that claimed the run and died.
    await t.pool.query(
      "UPDATE job_run SET status = 'running', lock_owner = 'crashed', lock_expires_at = '2026-11-13T02:01:00Z', attempt = 1 WHERE idempotency_key = 'test.takeover:1'",
    );
    const handler = vi.fn(async () => ok({ ok: true }));
    const rescuer = make('rescuer', clock, { 'test.takeover': handler });
    await rescuer.tick();
    expect(handler).not.toHaveBeenCalled();
    clock.set('2026-11-13T02:02:00.000Z');
    await rescuer.tick();
    expect(handler).toHaveBeenCalledOnce();
    const { rows } = await t.pool.query(
      "SELECT status, attempt FROM job_run WHERE idempotency_key = 'test.takeover:1'",
    );
    expect(rows[0]).toEqual({ status: 'succeeded', attempt: 2 });
  });

  it('retries a run with no registered handler and records the error code', async () => {
    const clock = fixedClock('2026-11-13T03:00:00.000Z');
    const jobs = make('w', clock, {});
    await jobs.schedule({
      name: 'test.unknown',
      runAt: '2026-11-13T03:00:00.000Z',
      payload: {},
      idempotencyKey: 'test.unknown:1',
    });
    await jobs.tick();
    const { rows } = await t.pool.query(
      "SELECT status, last_error_code, next_attempt_at FROM job_run WHERE idempotency_key = 'test.unknown:1'",
    );
    expect(rows[0]).toMatchObject({ status: 'retry_wait', last_error_code: 'NO_HANDLER' });
    expect((rows[0] as { next_attempt_at: Date }).next_attempt_at.toISOString()).toBe(
      '2026-11-13T03:00:01.000Z',
    );
  });

  it('schedules each recurring slot once (jobName:slot key)', async () => {
    const clock = fixedClock('2026-11-13T04:07:00.000Z');
    const jobs = make('w', clock, {});
    await jobs.ensureRecurring([{ name: 'test.recurring', everyMinutes: 15 }]);
    await jobs.ensureRecurring([{ name: 'test.recurring', everyMinutes: 15 }]);
    const { rows } = await t.pool.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM job_run WHERE job_name = 'test.recurring'",
    );
    expect(rows.map((r) => r.idempotency_key)).toEqual(['test.recurring:2026-11-13T04:15:00.000Z']);
  });
});
