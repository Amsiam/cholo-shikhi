// Notifications tables (entities.md). NotificationType is declared in code, not stored.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authSession, userAccount } from './identity.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const CHANNELS = ['in_app', 'push', 'email', 'sms'] as const;

export const notification = pgTable(
  'notification',
  {
    notificationId: uuid('notification_id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => userAccount.id),
    typeKey: text('type_key').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    params: jsonb('params').$type<Record<string, string | number | boolean>>().notNull(),
    priority: text('priority', { enum: ['normal', 'high'] })
      .notNull()
      .default('normal'),
    requestedChannels: text('requested_channels').array().notNull(),
    resolvedChannels: text('resolved_channels').array().notNull(),
    status: text('status', { enum: ['created', 'suppressed'] }).notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    readAt: ts('read_at'),
  },
  (t) => [
    uniqueIndex('notification_dedupe_uq').on(t.recipientUserId, t.dedupeKey),
    index('notification_recipient_idx').on(t.recipientUserId, t.createdAt),
  ],
);

export const notificationDelivery = pgTable(
  'notification_delivery',
  {
    notificationDeliveryId: uuid('notification_delivery_id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notification.notificationId),
    channel: text('channel', { enum: CHANNELS }).notNull(),
    status: text('status', {
      enum: ['pending', 'sending', 'retry_wait', 'delivered', 'failed', 'skipped'],
    })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: ts('next_attempt_at'),
    skipReason: text('skip_reason', {
      enum: ['no_active_push_subscription', 'recipient_not_active'],
    }),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [
    uniqueIndex('notification_delivery_uq').on(t.notificationId, t.channel),
    index('notification_delivery_due_idx').on(t.status, t.nextAttemptAt),
  ],
);

export const deliveryAttempt = pgTable('delivery_attempt', {
  deliveryAttemptId: uuid('delivery_attempt_id').primaryKey().defaultRandom(),
  notificationDeliveryId: uuid('notification_delivery_id')
    .notNull()
    .references(() => notificationDelivery.notificationDeliveryId),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status', { enum: ['succeeded', 'failed_retryable', 'failed_permanent'] }).notNull(),
  attemptedAt: ts('attempted_at').notNull(),
  providerMessageId: text('provider_message_id'),
  failureReason: text('failure_reason'),
});

export const notificationPreference = pgTable(
  'notification_preference',
  {
    preferenceId: uuid('preference_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id),
    typeKey: text('type_key').notNull(),
    channel: text('channel', { enum: CHANNELS }).notNull(),
    isEnabled: boolean('is_enabled').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_preference_uq').on(t.userId, t.typeKey, t.channel)],
);

/** Table only: push is switched off at launch (TS-09, BR12.20). */
export const pushSubscription = pgTable(
  'push_subscription',
  {
    pushSubscriptionId: uuid('push_subscription_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id),
    sessionId: uuid('session_id').references(() => authSession.id, { onDelete: 'set null' }),
    endpoint: text('endpoint').notNull(),
    keysCiphertext: text('keys_ciphertext').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    uniqueIndex('push_subscription_endpoint_active_uq')
      .on(t.endpoint)
      .where(sql`${t.revokedAt} is null`),
  ],
);
