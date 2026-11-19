// Notification types TrustOps sends (contract 4): to the instructors of affected content.
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';

export const TRUSTOPS_TYPES = {
  takedownHonoured: 'notify.takedown.honoured',
  takedownReversed: 'notify.takedown.reversed',
} as const;

export const TRUSTOPS_NOTIFICATION_TYPES = [
  defineNotificationType({
    typeKey: TRUSTOPS_TYPES.takedownHonoured,
    category: 'instructor',
    defaultChannels: ['in_app', 'email'],
    titleKey: 'notify.takedown.honoured.title',
    bodyKey: 'notify.takedown.honoured.body',
  }),
  defineNotificationType({
    typeKey: TRUSTOPS_TYPES.takedownReversed,
    category: 'instructor',
    defaultChannels: ['in_app', 'email'],
    titleKey: 'notify.takedown.reversed.title',
    bodyKey: 'notify.takedown.reversed.body',
  }),
] as const;
