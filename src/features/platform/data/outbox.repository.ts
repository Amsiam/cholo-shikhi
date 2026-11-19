// Relay-side outbox persistence (contract 2). Every statement is scoped to one leased partition.
import { sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';

export type DueDelivery = {
  outbox_delivery_id: string;
  outbox_event_id: string;
  consumer_name: string;
  aggregate_key: string;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  event_type: string;
  version: number;
  producer: string;
  payload: unknown;
  correlation_id: string;
  occurred_at: Date;
  recorded_at: Date;
};

export function createOutboxRepository() {
  return {
    /** Takes free, own or expired partition leases (one worker per partition). Returns stale takeovers too. */
    async acquireLeases(
      db: Executor,
      input: { workerId: string; now: string; leaseUntil: string; max: number },
    ) {
      const result = await db.execute<{
        partition: number;
        previous_worker: string | null;
        was_stale: boolean;
      }>(sql`
        WITH candidates AS (
          SELECT partition, worker_id AS previous_worker,
            (worker_id IS NOT NULL AND worker_id <> ${input.workerId} AND lease_expires_at < ${input.now}::timestamptz) AS was_stale
          FROM partition_lease
          WHERE worker_id IS NULL OR worker_id = ${input.workerId} OR lease_expires_at < ${input.now}::timestamptz
          ORDER BY partition LIMIT ${input.max} FOR UPDATE SKIP LOCKED)
        UPDATE partition_lease l SET worker_id = ${input.workerId}, heartbeat_at = ${input.now}::timestamptz,
          lease_expires_at = ${input.leaseUntil}::timestamptz
        FROM candidates c WHERE l.partition = c.partition
        RETURNING l.partition, c.previous_worker, c.was_stale`);
      return result.rows;
    },

    async releaseLeases(db: Executor, workerId: string) {
      await db.execute(
        sql`UPDATE partition_lease SET worker_id = NULL, lease_expires_at = NULL WHERE worker_id = ${workerId}`,
      );
    },

    async unfannedEvents(db: Executor, partition: number, limit: number) {
      const result = await db.execute<{
        outbox_event_id: string;
        seq: number;
        event_type: string;
        version: number;
        aggregate_key: string;
      }>(sql`
        SELECT outbox_event_id, seq, event_type, version, aggregate_key FROM outbox_event
        WHERE partition = ${partition} AND fanned_out_at IS NULL ORDER BY seq LIMIT ${limit}`);
      return result.rows;
    },

    async fanOut(
      db: Executor,
      input: {
        eventId: string;
        seq: number;
        aggregateKey: string;
        partition: number;
        consumers: string[];
        now: string;
      },
    ) {
      for (const consumerName of input.consumers) {
        await db.execute(sql`
          INSERT INTO outbox_delivery (outbox_event_id, event_seq, consumer_name, aggregate_key, partition)
          VALUES (${input.eventId}::uuid, ${input.seq}, ${consumerName}, ${input.aggregateKey}, ${input.partition})
          ON CONFLICT (outbox_event_id, consumer_name) DO NOTHING`);
      }
      await db.execute(
        sql`UPDATE outbox_event SET fanned_out_at = ${input.now}::timestamptz WHERE outbox_event_id = ${input.eventId}::uuid`,
      );
    },

    /** The head (lowest sequence) unfinished delivery per (consumer, key): later ones wait (BR11.3). */
    async heads(db: Executor, partition: number): Promise<DueDelivery[]> {
      const result = await db.execute<DueDelivery>(sql`
        SELECT DISTINCT ON (d.consumer_name, d.aggregate_key)
          d.outbox_delivery_id, d.outbox_event_id, d.consumer_name, d.aggregate_key, d.status, d.attempts, d.next_attempt_at,
          e.event_type, e.version, e.producer, e.payload, e.correlation_id, e.occurred_at, e.recorded_at
        FROM outbox_delivery d JOIN outbox_event e ON e.outbox_event_id = d.outbox_event_id
        WHERE d.partition = ${partition} AND d.status IN ('pending', 'retry_wait', 'in_flight')
        ORDER BY d.consumer_name, d.aggregate_key, d.event_seq`);
      return result.rows;
    },

    async startAttempt(db: Executor, deliveryId: string, now: string): Promise<number> {
      const result = await db.execute<{ attempts: number }>(sql`
        UPDATE outbox_delivery SET status = 'in_flight', attempts = attempts + 1,
          attempt_times = attempt_times || to_jsonb(${now}::text)
        WHERE outbox_delivery_id = ${deliveryId}::uuid RETURNING attempts`);
      return result.rows[0]?.attempts ?? 0;
    },

    /** The processed-event rule: returns false when (consumer, event) was already handled. */
    async markProcessed(
      db: Executor,
      consumerName: string,
      eventId: string,
      now: string,
    ): Promise<boolean> {
      const result = await db.execute(sql`
        INSERT INTO processed_event (consumer_name, outbox_event_id, processed_at)
        VALUES (${consumerName}, ${eventId}::uuid, ${now}::timestamptz) ON CONFLICT DO NOTHING RETURNING 1`);
      return result.rows.length === 1;
    },

    async markHandled(db: Executor, deliveryId: string, now: string) {
      await db.execute(sql`UPDATE outbox_delivery SET status = 'handled', handled_at = ${now}::timestamptz, last_error_code = NULL
        WHERE outbox_delivery_id = ${deliveryId}::uuid`);
    },

    async markRetry(db: Executor, deliveryId: string, code: string, nextAttemptAt: string) {
      await db.execute(sql`UPDATE outbox_delivery SET status = 'retry_wait', last_error_code = ${code}, next_attempt_at = ${nextAttemptAt}::timestamptz
        WHERE outbox_delivery_id = ${deliveryId}::uuid`);
    },

    async markDeadLettered(db: Executor, deliveryId: string, code: string, now: string) {
      await db.execute(sql`UPDATE outbox_delivery SET status = 'dead_lettered', last_error_code = ${code}, dead_lettered_at = ${now}::timestamptz,
        next_attempt_at = NULL WHERE outbox_delivery_id = ${deliveryId}::uuid`);
    },

    /** Oldest instant still waiting: unfanned events and unfinished deliveries (dead letters excluded). */
    async oldestWaiting(db: Executor): Promise<Date | null> {
      const result = await db.execute<{ oldest: Date | null }>(sql`
        SELECT min(t.recorded_at) AS oldest FROM (
          SELECT recorded_at FROM outbox_event WHERE fanned_out_at IS NULL
          UNION ALL
          SELECT e.recorded_at FROM outbox_delivery d JOIN outbox_event e ON e.outbox_event_id = d.outbox_event_id
          WHERE d.status IN ('pending', 'retry_wait', 'in_flight')) t`);
      const value = result.rows[0]?.oldest;
      return value ? new Date(value) : null;
    },
  };
}
