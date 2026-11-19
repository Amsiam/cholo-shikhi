// [AT] Contract 2 (outbox and relay) behaviours, written before the outbox and relay exist.
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createOutbox, type Outbox } from '#src/features/platform/server/outbox.server.ts';
import { appError } from '#src/lib/errors.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { err, ok } from '#src/lib/result.ts';
import { fixedClock } from '#src/lib/time.ts';
import { unwrapTx, withTransaction } from '#src/server/db.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { createRelay } from './relay.ts';

let t: TestDatabase;
let outbox: Outbox;
const clock = fixedClock('2026-11-13T06:00:00.000Z');
const Payload = z.object({ n: z.number().int() });

beforeAll(async () => {
  t = await createTestDatabase();
  await t.pool.query(
    'CREATE TABLE test_effect (consumer text NOT NULL, aggregate_key text NOT NULL, n int NOT NULL, at serial)',
  );
});
afterAll(async () => {
  await t.drop();
});
beforeEach(() => {
  outbox = createOutbox({ clock });
});
afterEach(async () => {
  await t.pool.query('UPDATE partition_lease SET worker_id = NULL, lease_expires_at = NULL');
});

function relay(onAlert = vi.fn()) {
  return createRelay({
    db: t.db,
    outbox,
    clock,
    workerId: 'relay-test',
    metrics: createMetrics(),
    onAlert,
    random: () => 0.5,
  });
}

async function publish(type: string, aggregateKey: string, n: number, id?: string) {
  await withTransaction(t.db, (tx) =>
    outbox.publish(tx, {
      ...(id ? { id } : {}),
      type,
      version: 1,
      aggregateKey,
      occurredAt: clock.now(),
      payload: { n },
      correlationId: 'corr-relay',
    }),
  );
}

async function effects(consumer: string) {
  const { rows } = await t.pool.query<{ aggregate_key: string; n: number }>(
    'SELECT aggregate_key, n FROM test_effect WHERE consumer = $1 ORDER BY at',
    [consumer],
  );
  return rows;
}

function recordingConsumer(consumerName: string, type: string) {
  outbox.registerConsumer({
    consumerName,
    type,
    version: 1,
    schema: Payload,
    handle: async (tx, event) => {
      await unwrapTx(tx).execute(
        sql`INSERT INTO test_effect (consumer, aggregate_key, n) VALUES (${consumerName}, ${event.aggregateKey}, ${event.payload.n})`,
      );
      return ok(undefined);
    },
  });
}

describe('contract 2: outbox and relay', () => {
  it('BR11.1 an event written in a transaction that rolls back never exists', async () => {
    await expect(
      withTransaction(t.db, async (tx) => {
        await outbox.publish(tx, {
          type: 'test.RolledBack',
          version: 1,
          aggregateKey: 'k',
          occurredAt: clock.now(),
          payload: { n: 1 },
          correlationId: 'c',
        });
        throw new Error('business step failed');
      }),
    ).rejects.toThrow();
    const { rows } = await t.pool.query(
      "SELECT 1 FROM outbox_event WHERE event_type = 'test.RolledBack'",
    );
    expect(rows).toHaveLength(0);
  });

  it('BR11.3 deliveries for one key are handled in recording order', async () => {
    recordingConsumer('test.ordering', 'test.Ordered');
    for (const n of [1, 2, 3]) await publish('test.Ordered', 'student-a', n);
    await publish('test.Ordered', 'student-b', 10);
    await relay().runOnce();
    const seen = await effects('test.ordering');
    expect(seen.filter((e) => e.aggregate_key === 'student-a').map((e) => e.n)).toEqual([1, 2, 3]);
    expect(seen.map((e) => e.n)).toContain(10);
  });

  it('BR11.5 a duplicate delivery of the same envelope is handled once', async () => {
    recordingConsumer('test.dedupe', 'test.Duped');
    const id = '0c0c0c0c-0000-4000-8000-000000000001';
    await publish('test.Duped', 'k-dup', 7, id);
    const r = relay();
    await r.runOnce();
    // At-least-once delivery: the relay re-queues the same delivery (e.g. after a crash).
    await t.pool.query(
      "UPDATE outbox_delivery SET status = 'pending' WHERE consumer_name = 'test.dedupe'",
    );
    await r.runOnce();
    expect(await effects('test.dedupe')).toEqual([{ aggregate_key: 'k-dup', n: 7 }]);
  });

  it('BR11.6/BR11.7 a failing delivery is retried 5 times then dead-lettered; later deliveries for the key continue', async () => {
    const onAlert = vi.fn();
    outbox.registerConsumer({
      consumerName: 'test.poison',
      type: 'test.Poison',
      version: 1,
      schema: Payload,
      handle: async (tx, event) => {
        if (event.payload.n === 1)
          return err(appError('DOWNSTREAM_REFUSED', { namespace: 'test' }));
        await unwrapTx(tx).execute(
          sql`INSERT INTO test_effect (consumer, aggregate_key, n) VALUES ('test.poison', ${event.aggregateKey}, ${event.payload.n})`,
        );
        return ok(undefined);
      },
    });
    await publish('test.Poison', 'k-poison', 1);
    await publish('test.Poison', 'k-poison', 2);
    const r = relay(onAlert);
    for (let i = 0; i < 5; i++) {
      await r.runOnce();
      // Head of line: the second event waits while the first one is retried.
      if (i < 4) expect(await effects('test.poison')).toEqual([]);
      clock.advanceMs(60_000);
    }
    const { rows } = await t.pool.query(
      "SELECT status, attempts, last_error_code FROM outbox_delivery WHERE consumer_name = 'test.poison' ORDER BY event_seq",
    );
    expect(rows[0]).toEqual({
      status: 'dead_lettered',
      attempts: 5,
      last_error_code: 'DOWNSTREAM_REFUSED',
    });
    await r.runOnce();
    expect(await effects('test.poison')).toEqual([{ aggregate_key: 'k-poison', n: 2 }]);
    expect(onAlert).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'OUTBOX_DEAD_LETTER', consumerName: 'test.poison' }),
    );
  });

  it('BR11.10 a consumer registers exactly one version per event type', () => {
    recordingConsumer('test.versions', 'test.Versioned');
    expect(() =>
      outbox.registerConsumer({
        consumerName: 'test.versions',
        type: 'test.Versioned',
        version: 2,
        schema: Payload,
        handle: async () => ok(undefined),
      }),
    ).toThrow(/one version/);
  });
});
