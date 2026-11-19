// Platform tables (entities.md). audit_log_entry is created by the custom migration
// (partitioned yearly, append-only trigger) and declared here for typed queries only; see
// src/server/schema/audit.ts, which drizzle-kit does not scan.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './identity.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const featureFlag = pgTable('feature_flag', {
  flagKey: text('flag_key').primaryKey(),
  description: text('description').notNull(),
  state: text('state', { enum: ['off', 'on', 'targeted'] })
    .notNull()
    .default('off'),
  targetRoles: text('target_roles').array().notNull().default(sql`'{}'::text[]`),
  targetGoalSegmentIds: text('target_goal_segment_ids')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  rolloutPercent: integer('rollout_percent').notNull().default(100),
  revision: integer('revision').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => userAccount.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const settingVersion = pgTable(
  'setting_version',
  {
    settingVersionId: uuid('setting_version_id').primaryKey().defaultRandom(),
    settingKey: text('setting_key').notNull(),
    scopeKey: text('scope_key').notNull().default('global'),
    value: jsonb('value').notNull(),
    version: integer('version').notNull(),
    effectiveFrom: ts('effective_from').notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => userAccount.id),
    reason: text('reason').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('setting_version_uq').on(t.settingKey, t.scopeKey, t.version)],
);

export const jobRun = pgTable(
  'job_run',
  {
    jobRunId: uuid('job_run_id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    payload: jsonb('payload'),
    scheduledFor: ts('scheduled_for').notNull(),
    status: text('status', { enum: ['scheduled', 'running', 'retry_wait', 'succeeded', 'failed'] })
      .notNull()
      .default('scheduled'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: ts('next_attempt_at'),
    lockOwner: text('lock_owner'),
    lockExpiresAt: ts('lock_expires_at'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    lastErrorCode: text('last_error_code'),
    resultSummary: jsonb('result_summary'),
  },
  (t) => [
    uniqueIndex('job_run_idempotency_uq').on(t.idempotencyKey),
    index('job_run_due_idx').on(t.status, t.nextAttemptAt),
  ],
);

export const outboxEvent = pgTable(
  'outbox_event',
  {
    // Ordering sequence for per-key recording order.
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    outboxEventId: uuid('outbox_event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    version: integer('version').notNull(),
    aggregateKey: text('aggregate_key').notNull(),
    partition: integer('partition').notNull(),
    producer: text('producer').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    // Set once the relay has created a delivery row for every registered consumer.
    fannedOutAt: ts('fanned_out_at'),
  },
  (t) => [
    index('outbox_event_fanout_idx').on(t.partition, t.seq).where(sql`${t.fannedOutAt} is null`),
  ],
);

export const outboxDelivery = pgTable(
  'outbox_delivery',
  {
    outboxDeliveryId: uuid('outbox_delivery_id').primaryKey().defaultRandom(),
    outboxEventId: uuid('outbox_event_id')
      .notNull()
      .references(() => outboxEvent.outboxEventId),
    eventSeq: integer('event_seq').notNull(),
    consumerName: text('consumer_name').notNull(),
    aggregateKey: text('aggregate_key').notNull(),
    partition: integer('partition').notNull(),
    status: text('status', {
      enum: ['pending', 'in_flight', 'retry_wait', 'handled', 'dead_lettered', 'discarded'],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    lastErrorCode: text('last_error_code'),
    attemptTimes: jsonb('attempt_times').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    handledAt: ts('handled_at'),
    deadLetteredAt: ts('dead_lettered_at'),
    resolvedBy: uuid('resolved_by').references(() => userAccount.id),
    discardJustification: text('discard_justification'),
  },
  (t) => [
    uniqueIndex('outbox_delivery_uq').on(t.outboxEventId, t.consumerName),
    index('outbox_delivery_work_idx').on(
      t.partition,
      t.status,
      t.consumerName,
      t.aggregateKey,
      t.eventSeq,
    ),
  ],
);

export const processedEvent = pgTable(
  'processed_event',
  {
    consumerName: text('consumer_name').notNull(),
    outboxEventId: uuid('outbox_event_id').notNull(),
    processedAt: ts('processed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerName, t.outboxEventId] })],
);

export const partitionLease = pgTable('partition_lease', {
  partition: integer('partition').primaryKey(),
  workerId: text('worker_id'),
  heartbeatAt: ts('heartbeat_at'),
  leaseExpiresAt: ts('lease_expires_at'),
});

export const instrumentationEvent = pgTable(
  'instrumentation_event',
  {
    instrumentationEventId: uuid('instrumentation_event_id').primaryKey().defaultRandom(),
    eventName: text('event_name').notNull(),
    featureArea: text('feature_area').notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    properties: jsonb('properties').$type<Record<string, string | number | boolean>>(),
  },
  (t) => [index('instrumentation_event_name_idx').on(t.eventName, t.occurredAt)],
);

export const healthCheckResult = pgTable(
  'health_check_result',
  {
    healthCheckId: uuid('health_check_id').primaryKey().defaultRandom(),
    checkName: text('check_name').notNull(),
    statusComponent: text('status_component', {
      enum: [
        'app',
        'sign_in',
        'catalog',
        'checkout',
        'lessons',
        'live',
        'payouts',
        'notifications',
      ],
    }).notNull(),
    status: text('status', { enum: ['operational', 'degraded', 'down'] }).notNull(),
    latencyMs: integer('latency_ms'),
    checkedAt: ts('checked_at').notNull(),
  },
  (t) => [index('health_check_component_idx').on(t.statusComponent, t.checkedAt)],
);

export const renderedDocument = pgTable('rendered_document', {
  documentId: uuid('document_id').primaryKey().defaultRandom(),
  objectKey: text('object_key').notNull().unique(),
  template: text('template').notNull(),
  format: text('format', { enum: ['pdf', 'csv'] }).notNull(),
  locale: text('locale', { enum: ['bn', 'en'] }).notNull(),
  requestingFeature: text('requesting_feature').notNull(),
  correlationId: text('correlation_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  retainUntil: ts('retain_until').notNull(),
});
