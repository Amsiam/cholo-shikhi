// Notifications (US10.1–US10.4, US11.6; contract 4). notify() enqueues a NotificationRequested inbox
// event in the producer's transaction; the inbox consumer creates the notification and its per-channel
// deliveries; dispatchDue() sends push/email/SMS with independent retries (BR12.10, BR12.11).

import { AccountCreatedV1 } from '#src/features/identity-access/domain/account-created.schema.ts';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import type { Instrument } from '#src/features/platform/domain/instrumentation.ts';
import {
  isPersonalDataKey,
  keyTokens,
  looksLikePersonalValue,
} from '#src/features/platform/domain/instrumentation.ts';
import { decideAfterFailure } from '#src/features/platform/domain/retry.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import type { Outbox } from '#src/features/platform/server/outbox.server.ts';
import type { Settings } from '#src/features/platform/server/settings.server.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createNotificationsRepository } from '../data/notifications.repository.ts';
import { resolveChannels } from '../domain/channels.ts';
import {
  NOTIFICATION_REQUESTED,
  NotificationRequestedV1,
} from '../domain/notification-requested.schema.ts';
import type { Channel, NotificationType } from '../domain/notification-types.ts';
import { pushPayload, renderNotification } from '../domain/render.ts';
import {
  type PushSender,
  type SmsSender,
  unavailablePushSender,
  unavailableSmsSender,
} from './channel-senders.server.ts';
import { EmailSendError, type EmailSender } from './email-sender.server.ts';

export const INBOX_CONSUMER = 'notifications.inbox';

export type NotificationsDeps = {
  db: Database;
  clock: Clock;
  outbox: Outbox;
  settings: Settings;
  emailSender: EmailSender;
  pushSender?: PushSender;
  smsSender?: SmsSender;
  types: readonly NotificationType[];
  metrics: Metrics;
  instrument?: Instrument;
  random?: () => number;
};

export type NotificationView = {
  notificationId: string;
  typeKey: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
};

/** BR12.16 / contract 4: params carry IDs, poisha amounts and dates; never phone, email, KYC or account numbers. */
function assertNoPersonalData(params: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(params)) {
    const tokens = keyTokens(key);
    const isAccountNumber = tokens.includes('account') && tokens.includes('number');
    if (isPersonalDataKey(key) || isAccountNumber || looksLikePersonalValue(value)) {
      throw new Error(`notification parameter ${key} looks like personal data`);
    }
  }
}

export function createNotifications(deps: NotificationsDeps) {
  const repo = createNotificationsRepository();
  const types = new Map(deps.types.map((t) => [t.typeKey, t]));
  const log = getLogger().child({ component: 'notifications' });
  const random = deps.random ?? Math.random;
  const push = deps.pushSender ?? unavailablePushSender;
  const sms = deps.smsSender ?? unavailableSmsSender;
  const now = () => new Date(deps.clock.now());

  async function setting<T>(key: { settingKey: string }, fallback: T): Promise<T> {
    const result = await deps.settings.get(key as never);
    return result.ok ? (result.value.value as T) : fallback;
  }

  /** Contract 4 notify(): enqueued in the producer's transaction. Throws only on a programming error. */
  async function notify(
    tx: TxHandle,
    request: NotificationRequestedV1,
    correlationId: string,
  ): Promise<void> {
    const parsed = NotificationRequestedV1.parse(request);
    assertNoPersonalData(parsed.params);
    if (!types.has(parsed.templateKey))
      throw new Error(`undeclared notification type ${parsed.templateKey}`);
    await deps.outbox.publish(tx, {
      type: NOTIFICATION_REQUESTED.type,
      version: NOTIFICATION_REQUESTED.version,
      aggregateKey: parsed.recipientUserId,
      occurredAt: deps.clock.now(),
      payload: parsed,
      correlationId,
    });
  }

  async function handleRequested(
    tx: TxHandle,
    event: { id: string; payload: NotificationRequestedV1; correlationId: string },
  ): Promise<Result<void, AppError>> {
    const exec = unwrapTx(tx);
    const request = event.payload;
    const type = types.get(request.templateKey);
    if (!type) return err(appError('UNKNOWN_NOTIFICATION_TYPE', { namespace: 'notifications' }));
    const recipient = await repo.recipient(exec, request.recipientUserId);
    if (!recipient) return err(appError('NOT_FOUND'));
    const channels =
      recipient.status === 'active'
        ? resolveChannels({
            requested: request.channels,
            isSmsEnabled: await setting(U1_SETTINGS.smsEnabled, false),
            isPushEnabled: await setting(U1_SETTINGS.pushEnabled, false),
            isLocked: type.isLocked,
            preferences: await repo.preferences(exec, recipient.id, type.typeKey),
          })
        : (['in_app'] as Channel[]);
    const notificationId = await repo.createNotification(exec, {
      recipientUserId: recipient.id,
      typeKey: type.typeKey,
      dedupeKey: request.dedupeKey,
      params: request.params,
      priority: request.priority,
      requestedChannels: request.channels,
      resolvedChannels: channels,
      status: channels.length === 0 ? 'suppressed' : 'created',
      sourceEventId: event.id,
      createdAt: now(),
    });
    // BR12.2: a repeated dedupe key yields no second notification.
    if (!notificationId) return ok(undefined);
    await repo.createDeliveries(
      exec,
      notificationId,
      channels,
      now(),
      await setting(U1_SETTINGS.notificationMaxAttempts, 5),
    );
    deps.instrument?.emit({
      eventName: 'notification_created',
      featureArea: 'notifications',
      correlationId: event.correlationId,
      properties: { typeKey: type.typeKey },
    });
    return ok(undefined);
  }

  function registerInboxConsumer(): void {
    deps.outbox.registerConsumer({
      consumerName: INBOX_CONSUMER,
      type: NOTIFICATION_REQUESTED.type,
      version: NOTIFICATION_REQUESTED.version,
      schema: NotificationRequestedV1,
      handle: (tx, event) => handleRequested(tx, event),
    });
  }

  type Claimed = Awaited<ReturnType<typeof repo.claimDue>>[number];

  async function sendOne(
    delivery: Claimed,
  ): Promise<'delivered' | 'skipped' | { failure: string; isRetryable: boolean }> {
    const item = await repo.notificationById(deps.db, delivery.notificationId);
    const type = item ? types.get(item.typeKey) : undefined;
    const recipient = item ? await repo.recipient(deps.db, item.recipientUserId) : undefined;
    if (!item || !type || !recipient)
      return { failure: 'NOTIFICATION_MISSING', isRetryable: false };
    if (recipient.status !== 'active') return 'skipped';
    // BR12.12: rendered in the recipient's account language at send time.
    const locale = recipient.locale;
    if (delivery.channel === 'push') {
      const endpoints = await repo.activePushEndpoints(deps.db, recipient.id);
      if (endpoints.length === 0) return 'skipped';
      for (const endpoint of endpoints) await push.send(endpoint, pushPayload(locale));
      return 'delivered';
    }
    const rendered = renderNotification(type, item.params, locale);
    if (delivery.channel === 'email') {
      await deps.emailSender.send({
        to: recipient.email,
        locale,
        kind: 'notification',
        subject: rendered.title,
        text: rendered.body,
        link: '/notifications',
      });
      return 'delivered';
    }
    await sms.send({ recipientUserId: recipient.id, text: rendered.title });
    return 'delivered';
  }

  /** Sends due push/email/SMS deliveries. Each channel retries on its own (BR12.10, BR12.11). */
  async function dispatchDue(limit = 50): Promise<number> {
    const claimed = await withTransaction(deps.db, (tx) =>
      repo.claimDue(unwrapTx(tx), now(), limit),
    );
    for (const delivery of claimed) {
      let outcome: Awaited<ReturnType<typeof sendOne>>;
      try {
        outcome = await sendOne(delivery);
      } catch (error) {
        const isRetryable = !(error instanceof EmailSendError) || error.isRetryable;
        const failure =
          error instanceof EmailSendError
            ? error.providerCode
            : error instanceof Error
              ? error.name
              : 'UNKNOWN';
        outcome = { failure, isRetryable };
      }
      const at = now();
      if (outcome === 'delivered' || outcome === 'skipped') {
        await repo.finishDelivery(deps.db, {
          deliveryId: delivery.notificationDeliveryId,
          status: outcome,
          at,
          ...(outcome === 'skipped'
            ? {
                skipReason:
                  delivery.channel === 'push'
                    ? 'no_active_push_subscription'
                    : 'recipient_not_active',
              }
            : {}),
        });
        if (outcome === 'delivered') {
          await repo.recordAttempt(deps.db, {
            deliveryId: delivery.notificationDeliveryId,
            attemptNumber: delivery.attempts,
            status: 'succeeded',
            at,
          });
        }
        continue;
      }
      const decision = outcome.isRetryable
        ? decideAfterFailure(delivery.attempts, delivery.maxAttempts, deps.clock.now(), random)
        : ({ status: 'failed' } as const);
      await repo.recordAttempt(deps.db, {
        deliveryId: delivery.notificationDeliveryId,
        attemptNumber: delivery.attempts,
        status: decision.status === 'failed' ? 'failed_permanent' : 'failed_retryable',
        at,
        failureReason: outcome.failure,
      });
      await repo.finishDelivery(deps.db, {
        deliveryId: delivery.notificationDeliveryId,
        status: decision.status,
        at,
        ...(decision.status === 'retry_wait'
          ? { nextAttemptAt: new Date(decision.nextAttemptAt) }
          : {}),
      });
      deps.metrics.increment('notification_delivery_failures_total', { channel: delivery.channel });
      if (decision.status === 'failed') {
        log.warn(
          {
            code: 'NOTIFICATION_DELIVERY_FAILED',
            channel: delivery.channel,
            failure: outcome.failure,
          },
          'notification delivery failed',
        );
      }
    }
    return claimed.length;
  }

  function view(
    row: Awaited<ReturnType<typeof repo.list>>['rows'][number],
    locale: 'bn' | 'en',
  ): NotificationView {
    const type = types.get(row.typeKey);
    const rendered = type
      ? renderNotification(type, row.params, locale)
      : { title: row.typeKey, body: '' };
    return {
      notificationId: row.notificationId,
      typeKey: row.typeKey,
      ...rendered,
      createdAt: row.createdAt.toISOString(),
      isRead: row.readAt !== null,
    };
  }

  /** BR12.18: only the user's own notifications, newest first, in the account's current language. */
  async function list(actor: Actor, input: { page: number; pageSize: number }) {
    const { rows, total } = await repo.list(deps.db, actor.userId, input.page, input.pageSize);
    return {
      rows: rows.map((r) => view(r, actor.locale)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async function get(
    actor: Actor,
    notificationId: string,
  ): Promise<Result<NotificationView, AppError<'NOT_FOUND'>>> {
    const row = await repo.notificationById(deps.db, notificationId);
    // BR1.4: another user's notification is NOT_FOUND, never FORBIDDEN.
    if (!row || row.recipientUserId !== actor.userId || row.status !== 'created')
      return err(appError('NOT_FOUND'));
    return ok(view(row, actor.locale));
  }

  async function markAllRead(actor: Actor): Promise<void> {
    await repo.markAllRead(deps.db, actor.userId, now());
  }

  async function unreadCount(actor: Actor): Promise<number> {
    return repo.unreadCount(deps.db, actor.userId);
  }

  /** BR12.8: security and payment types stay on for every channel. */
  async function setPreference(
    actor: Actor,
    input: { typeKey: string; channel: Channel; isEnabled: boolean },
  ): Promise<Result<void, AppError>> {
    const type = types.get(input.typeKey);
    if (!type) return err(appError('NOT_FOUND'));
    if (type.isLocked) return err(appError('NOTIFICATION_LOCKED', { namespace: 'notifications' }));
    await repo.setPreference(deps.db, { userId: actor.userId, ...input, at: now() });
    return ok(undefined);
  }

  /** Welcomes each new account: identity.AccountCreated (contract 4) -> notify.account.welcome in-app. */
  function registerWelcomeConsumer(): void {
    deps.outbox.registerConsumer({
      consumerName: 'notifications.welcome',
      type: 'identity.AccountCreated',
      version: 1,
      schema: AccountCreatedV1,
      handle: async (tx, event) => {
        await notify(
          tx,
          {
            recipientUserId: event.payload.userId,
            templateKey: 'notify.account.welcome',
            dedupeKey: `welcome:${event.payload.userId}`,
            params: {},
            channels: ['in_app'],
            priority: 'normal',
          },
          event.correlationId,
        );
        return ok(undefined);
      },
    });
  }

  return {
    notify,
    registerInboxConsumer,
    registerWelcomeConsumer,
    dispatchDue,
    list,
    get,
    markAllRead,
    unreadCount,
    setPreference,
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
