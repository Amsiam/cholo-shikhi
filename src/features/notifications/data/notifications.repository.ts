// Notifications persistence. The recipient's address is read at send time, inside the BD-hosted app.
import { and, count, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Json } from '#src/lib/json.ts';
import type { Executor } from '#src/server/db.ts';
import {
  deliveryAttempt,
  notification,
  notificationDelivery,
  notificationPreference,
  pushSubscription,
  userAccount,
} from '#src/server/schema/index.ts';
import type { Channel } from '../domain/notification-types.ts';

export function createNotificationsRepository() {
  return {
    async recipient(db: Executor, userId: string) {
      const [row] = await db
        .select({
          id: userAccount.id,
          email: userAccount.email,
          locale: userAccount.locale,
          status: userAccount.status,
        })
        .from(userAccount)
        .where(eq(userAccount.id, userId))
        .limit(1);
      return row;
    },

    async preferences(
      db: Executor,
      userId: string,
      typeKey: string,
    ): Promise<Partial<Record<Channel, boolean>>> {
      const rows = await db
        .select({
          channel: notificationPreference.channel,
          isEnabled: notificationPreference.isEnabled,
        })
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.userId, userId),
            eq(notificationPreference.typeKey, typeKey),
          ),
        );
      return Object.fromEntries(rows.map((r) => [r.channel, r.isEnabled]));
    },

    async setPreference(
      db: Executor,
      input: { userId: string; typeKey: string; channel: Channel; isEnabled: boolean; at: Date },
    ) {
      await db
        .insert(notificationPreference)
        .values({
          userId: input.userId,
          typeKey: input.typeKey,
          channel: input.channel,
          isEnabled: input.isEnabled,
          updatedAt: input.at,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreference.userId,
            notificationPreference.typeKey,
            notificationPreference.channel,
          ],
          set: { isEnabled: input.isEnabled, updatedAt: input.at },
        });
    },

    /** BR12.2: returns undefined when (recipient, dedupeKey) already exists. */
    async createNotification(
      db: Executor,
      row: typeof notification.$inferInsert,
    ): Promise<string | undefined> {
      const [inserted] = await db
        .insert(notification)
        .values(row)
        .onConflictDoNothing({ target: [notification.recipientUserId, notification.dedupeKey] })
        .returning({ id: notification.notificationId });
      return inserted?.id;
    },

    async createDeliveries(
      db: Executor,
      notificationId: string,
      channels: readonly Channel[],
      now: Date,
      maxAttempts: number,
    ) {
      if (channels.length === 0) return;
      await db.insert(notificationDelivery).values(
        channels.map((channel) =>
          channel === 'in_app'
            ? // BR12.10: the in-app copy is delivered when the notification is created.
              {
                notificationId,
                channel,
                status: 'delivered' as const,
                deliveredAt: now,
                maxAttempts,
              }
            : {
                notificationId,
                channel,
                status: 'pending' as const,
                nextAttemptAt: now,
                maxAttempts,
              },
        ),
      );
    },

    /** Claims due push/email/SMS deliveries (in_app never waits). */
    async claimDue(db: Executor, now: Date, limit: number) {
      const due = await db
        .select({ id: notificationDelivery.notificationDeliveryId })
        .from(notificationDelivery)
        .where(
          and(
            or(
              eq(notificationDelivery.status, 'pending'),
              eq(notificationDelivery.status, 'retry_wait'),
            ),
            lte(notificationDelivery.nextAttemptAt, now),
          ),
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      if (due.length === 0) return [];
      return db
        .update(notificationDelivery)
        .set({ status: 'sending', attempts: sql`${notificationDelivery.attempts} + 1` })
        .where(
          sql`${notificationDelivery.notificationDeliveryId} IN (${sql.join(
            due.map((d) => sql`${d.id}::uuid`),
            sql`, `,
          )})`,
        )
        .returning();
    },

    async notificationById(db: Executor, notificationId: string) {
      const [row] = await db
        .select()
        .from(notification)
        .where(eq(notification.notificationId, notificationId))
        .limit(1);
      return row;
    },

    async finishDelivery(
      db: Executor,
      input: {
        deliveryId: string;
        status: 'delivered' | 'retry_wait' | 'failed' | 'skipped';
        at: Date;
        nextAttemptAt?: Date;
        skipReason?: 'no_active_push_subscription' | 'recipient_not_active';
      },
    ) {
      await db
        .update(notificationDelivery)
        .set({
          status: input.status,
          nextAttemptAt: input.nextAttemptAt ?? null,
          ...(input.status === 'delivered' ? { deliveredAt: input.at } : {}),
          ...(input.skipReason ? { skipReason: input.skipReason } : {}),
        })
        .where(eq(notificationDelivery.notificationDeliveryId, input.deliveryId));
    },

    async recordAttempt(
      db: Executor,
      input: {
        deliveryId: string;
        attemptNumber: number;
        status: 'succeeded' | 'failed_retryable' | 'failed_permanent';
        at: Date;
        providerMessageId?: string;
        failureReason?: string;
      },
    ) {
      await db.insert(deliveryAttempt).values({
        notificationDeliveryId: input.deliveryId,
        attemptNumber: input.attemptNumber,
        status: input.status,
        attemptedAt: input.at,
        providerMessageId: input.providerMessageId ?? null,
        failureReason: input.failureReason?.slice(0, 200) ?? null,
      });
    },

    async activePushEndpoints(db: Executor, userId: string): Promise<string[]> {
      const rows = await db
        .select({ endpoint: pushSubscription.endpoint })
        .from(pushSubscription)
        .where(and(eq(pushSubscription.userId, userId), isNull(pushSubscription.revokedAt)));
      return rows.map((r) => r.endpoint);
    },

    async list(db: Executor, userId: string, page: number, pageSize: number) {
      const rows = await db
        .select()
        .from(notification)
        .where(and(eq(notification.recipientUserId, userId), eq(notification.status, 'created')))
        .orderBy(desc(notification.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [total] = await db
        .select({ n: count() })
        .from(notification)
        .where(and(eq(notification.recipientUserId, userId), eq(notification.status, 'created')));
      return { rows, total: total?.n ?? 0 };
    },

    async unreadCount(db: Executor, userId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(notification)
        .where(
          and(
            eq(notification.recipientUserId, userId),
            eq(notification.status, 'created'),
            isNull(notification.readAt),
          ),
        );
      return row?.n ?? 0;
    },

    async markAllRead(db: Executor, userId: string, at: Date) {
      await db
        .update(notification)
        .set({ readAt: at })
        .where(and(eq(notification.recipientUserId, userId), isNull(notification.readAt)));
    },
  };
}

export type NotificationParams = Record<string, Json>;
