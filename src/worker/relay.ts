// The outbox relay (contract 2, ADR-006): leases partitions, fans events out to registered consumers,
// delivers per (consumer, key) in recording order at least once, applies the processed-event rule,
// retries with backoff, dead-letters after 5 attempts and reports backlog age. Locally one worker
// leases all 32 partitions; production runs several (infra Q4).
import type pg from 'pg';
import {
  createOutboxRepository,
  type DueDelivery,
} from '#src/features/platform/data/outbox.repository.ts';
import type { Instrument } from '#src/features/platform/domain/instrumentation.ts';
import { decideAfterFailure } from '#src/features/platform/domain/retry.ts';
import type { Outbox } from '#src/features/platform/server/outbox.server.ts';
import { type AppError, isAppError } from '#src/lib/errors.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';

export const MAX_DELIVERY_ATTEMPTS = 5;
export const BACKLOG_ALERT_SECONDS = 30;

export type RelayAlert =
  | {
      code: 'OUTBOX_DEAD_LETTER';
      consumerName: string;
      outboxEventId: string;
      lastErrorCode: string;
    }
  | { code: 'OUTBOX_BACKLOG_OLD'; ageSeconds: number }
  | { code: 'OUTBOX_LEASE_STALE'; partition: number; previousWorker: string };

class HandlerRefused extends Error {
  readonly error: AppError;
  constructor(error: AppError) {
    super(error.code);
    this.error = error;
  }
}

export type RelayDeps = {
  db: Database;
  outbox: Outbox;
  clock: Clock;
  workerId: string;
  metrics: Metrics;
  onAlert: (alert: RelayAlert) => void;
  instrument?: Instrument;
  random?: () => number;
  leaseMs?: number;
  maxPartitions?: number;
  fanOutBatch?: number;
};

export function createRelay(deps: RelayDeps) {
  const repo = createOutboxRepository();
  const log = getLogger().child({ component: 'relay', workerId: deps.workerId });
  const random = deps.random ?? Math.random;
  const leaseMs = deps.leaseMs ?? 15_000;
  const now = () => deps.clock.now();

  async function acquire(): Promise<number[]> {
    const rows = await repo.acquireLeases(deps.db, {
      workerId: deps.workerId,
      now: now(),
      leaseUntil: new Date(new Date(now()).getTime() + leaseMs).toISOString(),
      max: deps.maxPartitions ?? 32,
    });
    for (const row of rows) {
      if (row.was_stale && row.previous_worker) {
        deps.onAlert({
          code: 'OUTBOX_LEASE_STALE',
          partition: row.partition,
          previousWorker: row.previous_worker,
        });
      }
    }
    return rows.map((r) => r.partition).sort((a, b) => a - b);
  }

  async function fanOut(partition: number): Promise<void> {
    for (const event of await repo.unfannedEvents(deps.db, partition, deps.fanOutBatch ?? 200)) {
      const consumers = deps.outbox
        .consumersFor(event.event_type, event.version)
        .map((c) => c.consumerName);
      await repo.fanOut(deps.db, {
        eventId: event.outbox_event_id,
        seq: Number(event.seq),
        aggregateKey: event.aggregate_key,
        partition,
        consumers,
        now: now(),
      });
    }
  }

  function isDue(delivery: DueDelivery): boolean {
    if (delivery.status === 'pending' || delivery.status === 'in_flight') return true;
    return (
      delivery.next_attempt_at !== null &&
      new Date(delivery.next_attempt_at).getTime() <= new Date(now()).getTime()
    );
  }

  async function fail(delivery: DueDelivery, attempts: number, code: string): Promise<void> {
    const decision = decideAfterFailure(attempts, MAX_DELIVERY_ATTEMPTS, now(), random);
    deps.metrics.increment('outbox_delivery_failures_total', { consumer: delivery.consumer_name });
    if (decision.status === 'retry_wait') {
      await repo.markRetry(deps.db, delivery.outbox_delivery_id, code, decision.nextAttemptAt);
      return;
    }
    await repo.markDeadLettered(deps.db, delivery.outbox_delivery_id, code, now());
    deps.metrics.increment('outbox_dead_letters_total', { consumer: delivery.consumer_name });
    log.error(
      {
        code: 'OUTBOX_DEAD_LETTER',
        consumerName: delivery.consumer_name,
        outboxEventId: delivery.outbox_event_id,
        lastErrorCode: code,
      },
      'delivery dead-lettered',
    );
    deps.instrument?.emit({
      eventName: 'outbox_dead_lettered',
      featureArea: 'platform',
      correlationId: delivery.correlation_id,
      properties: { consumer: delivery.consumer_name },
    });
    deps.onAlert({
      code: 'OUTBOX_DEAD_LETTER',
      consumerName: delivery.consumer_name,
      outboxEventId: delivery.outbox_event_id,
      lastErrorCode: code,
    });
  }

  /** Delivers one head delivery. Returns true when it reached a final or waiting state. */
  async function deliver(delivery: DueDelivery): Promise<void> {
    const consumer = deps.outbox.consumer(delivery.consumer_name);
    if (!consumer) return; // Not registered in this process (e.g. during a rolling deploy): leave it pending.
    const attempts = await repo.startAttempt(deps.db, delivery.outbox_delivery_id, now());
    const parsed = consumer.schema.safeParse(delivery.payload);
    if (!parsed.success) {
      await fail(delivery, attempts, 'SCHEMA_INVALID');
      return;
    }
    const envelope = {
      id: delivery.outbox_event_id,
      type: delivery.event_type,
      version: delivery.version,
      aggregateKey: delivery.aggregate_key,
      occurredAt: new Date(delivery.occurred_at).toISOString(),
      recordedAt: new Date(delivery.recorded_at).toISOString(),
      producer: delivery.producer,
      correlationId: delivery.correlation_id,
      payload: parsed.data,
    };
    try {
      await withTransaction(deps.db, async (tx) => {
        const exec = unwrapTx(tx);
        // BR11.5: the processed-event record and the side effects commit together, or not at all.
        if (
          await repo.markProcessed(exec, delivery.consumer_name, delivery.outbox_event_id, now())
        ) {
          const result = await consumer.handle(tx, envelope);
          if (!result.ok) throw new HandlerRefused(result.error);
        }
        await repo.markHandled(exec, delivery.outbox_delivery_id, now());
      });
      deps.metrics.observe(
        'outbox_delivery_latency_ms',
        new Date(now()).getTime() - new Date(delivery.recorded_at).getTime(),
        { consumer: delivery.consumer_name },
      );
      deps.metrics.increment('outbox_deliveries_total', { consumer: delivery.consumer_name });
    } catch (error) {
      const code =
        error instanceof HandlerRefused
          ? error.error.code
          : isAppError(error)
            ? error.code
            : 'HANDLER_THREW';
      if (!(error instanceof HandlerRefused)) {
        log.warn(
          {
            err: error,
            consumerName: delivery.consumer_name,
            correlationId: delivery.correlation_id,
            code,
          },
          'consumer threw',
        );
      }
      await fail(delivery, attempts, code);
    }
  }

  async function processPartition(partition: number): Promise<number> {
    await fanOut(partition);
    let delivered = 0;
    // Keep draining due heads; each pass handles at most one delivery per (consumer, key).
    for (let pass = 0; pass < 100; pass++) {
      const due = (await repo.heads(deps.db, partition)).filter(
        (d) => isDue(d) && deps.outbox.consumer(d.consumer_name),
      );
      if (due.length === 0) break;
      for (const delivery of due) await deliver(delivery);
      delivered += due.length;
    }
    return delivered;
  }

  async function reportBacklog(): Promise<number> {
    const oldest = await repo.oldestWaiting(deps.db);
    const ageSeconds = oldest
      ? Math.max(0, (new Date(now()).getTime() - oldest.getTime()) / 1000)
      : 0;
    deps.metrics.setGauge('outbox_backlog_age_seconds', ageSeconds);
    if (ageSeconds > BACKLOG_ALERT_SECONDS)
      deps.onAlert({ code: 'OUTBOX_BACKLOG_OLD', ageSeconds });
    return ageSeconds;
  }

  async function runOnce(): Promise<{ delivered: number; partitions: number[] }> {
    const partitions = await acquire();
    let delivered = 0;
    for (const partition of partitions) delivered += await processPartition(partition);
    await reportBacklog();
    return { delivered, partitions };
  }

  /**
   * Runs until stopped: wakes on NOTIFY outbox_event and polls at least once a second (BR11.4).
   * Returns a stop function that finishes the current pass and releases the leases.
   */
  async function start(
    listenClient: pg.Client,
    options: { pollMs?: number } = {},
  ): Promise<() => Promise<void>> {
    let isRunning = true;
    let wake: (() => void) | undefined;
    // A notification that arrives mid-pass is latched so the next sleep is skipped (no lost wake-up).
    let hasPendingWake = false;
    await listenClient.query('LISTEN outbox_event');
    listenClient.on('notification', () => {
      hasPendingWake = true;
      wake?.();
    });
    const loop = (async () => {
      while (isRunning) {
        hasPendingWake = false;
        try {
          await runOnce();
        } catch (error) {
          log.error({ err: error, code: 'RELAY_PASS_FAILED' }, 'relay pass failed; retrying');
        }
        if (!isRunning) break;
        if (hasPendingWake) continue;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.pollMs ?? 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    })();
    return async () => {
      isRunning = false;
      wake?.();
      await loop;
      await repo.releaseLeases(deps.db, deps.workerId);
    };
  }

  /** Releases this worker's partition leases (shutdown, tests). */
  async function release(): Promise<void> {
    await repo.releaseLeases(deps.db, deps.workerId);
  }

  return { runOnce, start, reportBacklog, release };
}
