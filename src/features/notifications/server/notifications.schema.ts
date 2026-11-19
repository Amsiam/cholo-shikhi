import { z } from 'zod';

export const NotificationListInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const NotificationPreferenceInput = z.object({
  typeKey: z.string().regex(/^notify\.[a-z0-9.]+$/i),
  channel: z.enum(['in_app', 'push', 'email', 'sms']),
  isEnabled: z.boolean(),
});
