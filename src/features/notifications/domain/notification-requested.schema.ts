// Contract 4: notifications.NotificationRequested v1 (the Notifications inbox).
import { z } from 'zod';
import { Id, IdempotencyKey } from '#src/lib/ids.ts';

export const NOTIFICATION_REQUESTED = {
  type: 'notifications.NotificationRequested',
  version: 1,
} as const;

export const NotificationRequestedV1 = z.object({
  recipientUserId: Id,
  templateKey: z.string().regex(/^notify\.[a-z0-9.]+$/i),
  dedupeKey: IdempotencyKey,
  params: z.record(z.string(), z.union([z.string().max(200), z.number().int(), z.boolean()])),
  channels: z.array(z.enum(['in_app', 'push', 'email', 'sms'])).min(1),
  priority: z.enum(['normal', 'high']),
});
export type NotificationRequestedV1 = z.infer<typeof NotificationRequestedV1>;
