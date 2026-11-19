// Notification types Commerce sends (contract 4): course switch outcomes to the Student.
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';

export const COMMERCE_TYPES = {
  switchApproved: 'notify.switch.approved',
  switchDenied: 'notify.switch.denied',
  switchExpired: 'notify.switch.expired',
} as const;

export const COMMERCE_NOTIFICATION_TYPES = (['approved', 'denied', 'expired'] as const).map((k) =>
  defineNotificationType({
    typeKey: `notify.switch.${k}`,
    category: 'payment',
    defaultChannels: ['in_app', 'email'],
    titleKey: `notify.switch.${k}.title`,
    bodyKey: `notify.switch.${k}.body`,
  }),
);
