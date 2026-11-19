// Contract 2: outbox.publish (in the producer's own transaction, ADR-006) and
// outbox.registerConsumer (once at start-up, exactly one version per event type, BR11.10).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppError } from '#src/lib/errors.ts';
import type { Envelope } from '#src/lib/events/envelope.ts';
import { stableStringify } from '#src/lib/json.ts';
import type { Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { unwrapTx } from '#src/server/db.ts';

export const OUTBOX_PARTITIONS = 32;

export type PublishInput<P> = {
  id?: string;
  type: string;
  version: number;
  aggregateKey: string;
  occurredAt: string;
  payload: P;
  correlationId: string;
};

export type Consumer<P> = {
  consumerName: string;
  type: string;
  version: number;
  schema: z.ZodType<P>;
  handle: (tx: TxHandle, event: Envelope<P>) => Promise<Result<void, AppError>>;
};

const TYPE = /^[a-z][a-z0-9-]*\.[A-Z][A-Za-z0-9]*$/;

export function createOutbox(deps: { clock: Clock }) {
  // biome-ignore lint/suspicious/noExplicitAny: consumers of different payload types share one registry.
  const consumers = new Map<string, Consumer<any>>();

  async function publish<P>(tx: TxHandle, event: PublishInput<P>): Promise<void> {
    if (!TYPE.test(event.type)) throw new Error(`invalid event type ${event.type}`);
    if (!event.aggregateKey || event.aggregateKey.length > 200)
      throw new Error('aggregateKey must be 1..200 characters');
    const producer = event.type.split('.')[0] as string;
    // Throws only on infrastructure failure, which rolls the producer's transaction back.
    await unwrapTx(tx).execute(sql`
      INSERT INTO outbox_event (outbox_event_id, event_type, version, aggregate_key, partition, producer, payload, correlation_id, occurred_at, recorded_at)
      VALUES (${event.id ?? randomUUID()}::uuid, ${event.type}, ${event.version}, ${event.aggregateKey},
        outbox_partition_of(${event.aggregateKey}, ${OUTBOX_PARTITIONS}), ${producer}, ${stableStringify(event.payload)}::jsonb,
        ${event.correlationId}, ${event.occurredAt}::timestamptz, ${deps.clock.now()}::timestamptz)`);
  }

  function registerConsumer<P>(consumer: Consumer<P>): void {
    for (const existing of consumers.values()) {
      if (existing.consumerName === consumer.consumerName && existing.type === consumer.type) {
        throw new Error(
          `${consumer.consumerName} already subscribes to ${consumer.type}; a consumer takes exactly one version per type`,
        );
      }
    }
    if (consumers.has(consumer.consumerName)) {
      throw new Error(`consumer name ${consumer.consumerName} is already registered`);
    }
    consumers.set(consumer.consumerName, consumer);
  }

  // biome-ignore lint/suspicious/noExplicitAny: see registry above.
  function consumersFor(type: string, version: number): Consumer<any>[] {
    return [...consumers.values()].filter((c) => c.type === type && c.version === version);
  }

  // biome-ignore lint/suspicious/noExplicitAny: see registry above.
  function consumer(name: string): Consumer<any> | undefined {
    return consumers.get(name);
  }

  return { publish, registerConsumer, consumersFor, consumer };
}

export type Outbox = ReturnType<typeof createOutbox>;
