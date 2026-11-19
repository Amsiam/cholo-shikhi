// Notification types Goals sends (BR2.3). Declared in code next to the producer and registered with
// Notifications at start-up (contract 4).
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';

export const NO_ACTIVE_GOALS_TYPE = 'notify.goals.noActiveGoals';

export const GOALS_NOTIFICATION_TYPES = [
  defineNotificationType({
    typeKey: NO_ACTIVE_GOALS_TYPE,
    category: 'account',
    defaultChannels: ['in_app'],
    titleKey: 'notify.goals.noActiveGoals.title',
    bodyKey: 'notify.goals.noActiveGoals.body',
  }),
] as const;
