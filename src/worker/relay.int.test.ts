// [LT] Relay integration: crash replay, a throwing consumer, schema failures, alerts, NOTIFY wake-up,
// dead-letter review and the AccountCreated trigger event.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { createDeadLetters } from '#src/features/platform/server/dead-letters.server.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { fixedClock, systemClock } from '#src/lib/time.ts';
import { unwrapTx, withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createRelay } from './relay.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await t.pool.query('CREATE TABLE test_effect (consumer text NOT NULL, n int NOT NULL)');
});
afterAll(async () => {
  await t.drop();
});
// Each case starts with free partitions; lease exclusivity itself is tested below.
afterEach(async () => {
  await t.pool.query('UPDATE partition_lease SET worker_id = NULL, lease_expires_at = NULL');
});

const Payload = z.object({ n: z.number().int() });
const count = async (consumer: string) =>
  (
    await t.pool.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM test_effect WHERE consumer = $1',
      [consumer],
    )
  ).rows[0]?.c ?? 0;

function setup(consumerName: string, type: string, handle?: (n: number) => void) {
  const clock = fixedClock('2026-11-13T07:00:00.000Z');
  const outbox = createOutbox({ clock });
  const calls = vi.fn();
  outbox.registerConsumer({
    consumerName,
    type,
    version: 1,
    schema: Payload,
    handle: async (tx, event) => {
      calls(event.payload.n);
      handle?.(event.payload.n);
      await unwrapTx(tx).execute(
        sql`INSERT INTO test_effect (consumer, n) VALUES (${consumerName}, ${event.payload.n})`,
      );
      return ok(undefined);
    },
  });
  const onAlert = vi.fn();
  const metrics = createMetrics();
  const relay = createRelay({
    db: t.db,
    outbox,
    clock,
    workerId: `w-${consumerName}`,
    metrics,
    onAlert,
    random: () => 0.5,
  });
  const publish = (n: number, key = 'k', payload: unknown = { n }) =>
    withTransaction(t.db, (tx) =>
      outbox.publish(tx, {
        type,
        version: 1,
        aggregateKey: key,
        occurredAt: clock.now(),
        payload,
        correlationId: 'c',
      }),
    );
  return { clock, outbox, relay, publish, calls, onAlert, metrics };
}

describe('relay', () => {
  it('replays a delivery left in flight by a crash without repeating committed side effects', async () => {
    const s = setup('lt.crash', 'lt.Crashed');
    await s.publish(1);
    await s.relay.runOnce();
    expect(await count('lt.crash')).toBe(1);
    // Simulate a crash after commit but before the worker noticed: the row is back in flight.
    await t.pool.query(
      "UPDATE outbox_delivery SET status = 'in_flight' WHERE consumer_name = 'lt.crash'",
    );
    await s.relay.runOnce();
    expect(s.calls).toHaveBeenCalledOnce();
    expect(await count('lt.crash')).toBe(1);
  });

  it('rolls back a consumer that throws and keeps other keys flowing', async () => {
    const s = setup('lt.throws', 'lt.Throws', (n) => {
      if (n === 13) throw new Error('boom');
    });
    await s.publish(13, 'bad-key');
    await s.publish(1, 'good-key');
    await s.relay.runOnce();
    expect(await count('lt.throws')).toBe(1);
    const { rows } = await t.pool.query(
      "SELECT status, last_error_code FROM outbox_delivery WHERE consumer_name = 'lt.throws' AND aggregate_key = 'bad-key'",
    );
    expect(rows[0]).toEqual({ status: 'retry_wait', last_error_code: 'HANDLER_THREW' });
  });

  it('treats a payload that fails the consumer schema as a failed attempt', async () => {
    const s = setup('lt.schema', 'lt.Schema');
    await s.publish(0, 'k', { n: 'not a number' });
    await s.relay.runOnce();
    const { rows } = await t.pool.query(
      "SELECT status, last_error_code FROM outbox_delivery WHERE consumer_name = 'lt.schema'",
    );
    expect(rows[0]).toEqual({ status: 'retry_wait', last_error_code: 'SCHEMA_INVALID' });
    expect(s.calls).not.toHaveBeenCalled();
  });

  it('records delivery latency and alerts when the backlog is older than 30 s (BR11.9)', async () => {
    const s = setup('lt.backlog', 'lt.Backlog');
    await s.publish(1);
    await s.relay.runOnce();
    expect(
      s.metrics.observations('outbox_delivery_latency_ms', { consumer: 'lt.backlog' }),
    ).toHaveLength(1);
    await t.pool.query(
      "INSERT INTO outbox_event (outbox_event_id, event_type, version, aggregate_key, partition, producer, payload, correlation_id, occurred_at, recorded_at) VALUES (gen_random_uuid(), 'lt.Orphan', 1, 'o', 0, 'lt', '{}', 'c', now(), $1)",
      ['2026-11-13T06:59:00.000Z'],
    );
    await t.pool.query('UPDATE outbox_event SET fanned_out_at = NULL WHERE event_type = $1', [
      'lt.Orphan',
    ]);
    const age = await createRelay({
      db: t.db,
      outbox: s.outbox,
      clock: s.clock,
      workerId: 'w-age',
      metrics: s.metrics,
      onAlert: s.onAlert,
      maxPartitions: 0,
    }).reportBacklog();
    expect(age).toBeGreaterThan(30);
    expect(s.onAlert).toHaveBeenCalledWith(expect.objectContaining({ code: 'OUTBOX_BACKLOG_OLD' }));
  });

  it('alerts when it takes over a partition whose lease expired without a heartbeat', async () => {
    const s = setup('lt.lease', 'lt.Lease');
    await t.pool.query(
      "UPDATE partition_lease SET worker_id = 'dead-worker', lease_expires_at = '2026-11-13T06:00:00Z' WHERE partition = 31",
    );
    await s.relay.runOnce();
    expect(s.onAlert).toHaveBeenCalledWith({
      code: 'OUTBOX_LEASE_STALE',
      partition: 31,
      previousWorker: 'dead-worker',
    });
  });

  it('wakes on NOTIFY and delivers within the 10 s target (BR11.4)', async () => {
    const outbox = createOutbox({ clock: systemClock });
    const handled = vi.fn();
    outbox.registerConsumer({
      consumerName: 'lt.notify',
      type: 'lt.Notified',
      version: 1,
      schema: Payload,
      handle: async () => {
        handled();
        return ok(undefined);
      },
    });
    const relay = createRelay({
      db: t.db,
      outbox,
      clock: systemClock,
      workerId: 'w-notify',
      metrics: createMetrics(),
      onAlert: vi.fn(),
    });
    const listen = new pg.Client({
      connectionString: t.connectionString,
      options: `-c search_path=${t.schemaName}`,
    });
    await listen.connect();
    const stop = await relay.start(listen, { pollMs: 60_000 });
    try {
      await withTransaction(t.db, (tx) =>
        outbox.publish(tx, {
          type: 'lt.Notified',
          version: 1,
          aggregateKey: 'n',
          occurredAt: systemClock.now(),
          payload: { n: 1 },
          correlationId: 'c',
        }),
      );
      const started = Date.now();
      while (!handled.mock.calls.length && Date.now() - started < 10_000)
        await new Promise((r) => setTimeout(r, 25));
      expect(handled).toHaveBeenCalledOnce();
    } finally {
      await stop();
      await listen.end();
    }
  });

  it('lets an Admin replay a dead letter (attempts reset) or discard it with a justification, audit-logged', async () => {
    const s = setup('lt.review', 'lt.Review');
    await s.publish(1, 'a');
    await s.publish(2, 'b');
    await t.pool.query(
      "UPDATE outbox_event SET fanned_out_at = NULL WHERE event_type = 'lt.Review'",
    );
    await s.relay.runOnce();
    await t.pool.query(
      "UPDATE outbox_delivery SET status = 'dead_lettered', attempts = 5 WHERE consumer_name = 'lt.review'",
    );
    await t.pool.query("DELETE FROM processed_event WHERE consumer_name = 'lt.review'");
    const { rows: users } = await t.pool.query<{ user_id: string }>(
      "INSERT INTO user_account (email_normalised) VALUES ('dl@example.test') RETURNING user_id",
    );
    const admin: Actor = {
      userId: (users[0] as { user_id: string }).user_id,
      roles: ['student', 'admin'],
      locale: 'en',
      hasStepUp: true,
    };
    const review = createDeadLetters({ db: t.db, clock: s.clock });
    const listed = await review.list(admin, {});
    const [first, second] = listed.ok
      ? listed.value.rows.filter((r) => r.consumerName === 'lt.review')
      : [];
    if (!first || !second) throw new Error('expected two dead letters');
    expect(
      await review.resolve(
        { ...admin, roles: ['student'] },
        { outboxDeliveryId: first.outboxDeliveryId, action: 'replay' },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await review.resolve(
        admin,
        { outboxDeliveryId: second.outboxDeliveryId, action: 'discard' },
        'c',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      (
        await review.resolve(
          admin,
          { outboxDeliveryId: first.outboxDeliveryId, action: 'replay' },
          'c-replay',
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await review.resolve(
          admin,
          {
            outboxDeliveryId: second.outboxDeliveryId,
            action: 'discard',
            justification: 'Duplicate of a manual fix',
          },
          'c-discard',
        )
      ).ok,
    ).toBe(true);
    await s.relay.runOnce();
    const { rows } = await t.pool.query(
      "SELECT status, attempts FROM outbox_delivery WHERE consumer_name = 'lt.review' ORDER BY event_seq",
    );
    expect(rows.map((r) => r.status).sort()).toEqual(['discarded', 'handled']);
    const audits = await t.pool.query(
      "SELECT action FROM audit_log_entry WHERE correlation_id IN ('c-replay', 'c-discard') ORDER BY action",
    );
    expect(audits.rows.map((r) => r.action)).toEqual([
      'platform.dead_letter.discarded',
      'platform.dead_letter.replayed',
    ]);
  });

  it('delivers the identity.AccountCreated event written by the database trigger', async () => {
    const clock = fixedClock('2026-11-13T08:00:00.000Z');
    const outbox = createOutbox({ clock });
    const seen = vi.fn();
    outbox.registerConsumer({
      consumerName: 'lt.referrals',
      type: 'identity.AccountCreated',
      version: 1,
      schema: z.object({
        userId: z.uuid(),
        createdAt: z.string(),
        referralCode: z.string().nullable(),
        deviceFingerprintHash: z.string().nullable(),
      }),
      handle: async (_tx, event) => {
        seen(event.payload.userId);
        return ok(undefined);
      },
    });
    const { rows } = await t.pool.query<{ user_id: string }>(
      "INSERT INTO user_account (email_normalised) VALUES ('ac@example.test') RETURNING user_id",
    );
    await createRelay({
      db: t.db,
      outbox,
      clock,
      workerId: 'w-ac',
      metrics: createMetrics(),
      onAlert: vi.fn(),
    }).runOnce();
    expect(seen).toHaveBeenCalledWith(rows[0]?.user_id);
  });
});
