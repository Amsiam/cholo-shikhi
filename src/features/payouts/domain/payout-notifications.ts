// Notification types Payouts sends (contract 4). Payment category: always delivered. Params carry no
// amount text written by a person and no account number.
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';

export const PAYOUT_TYPES = {
  held: 'notify.payout.held',
  paid: 'notify.payout.paid',
} as const;

export const PAYOUT_NOTIFICATION_TYPES = [
  defineNotificationType({
    typeKey: PAYOUT_TYPES.held,
    category: 'payment',
    defaultChannels: ['in_app', 'email'],
    titleKey: 'notify.payout.held.title',
    bodyKey: 'notify.payout.held.body',
  }),
  defineNotificationType({
    typeKey: PAYOUT_TYPES.paid,
    category: 'payment',
    defaultChannels: ['in_app', 'email'],
    titleKey: 'notify.payout.paid.title',
    bodyKey: 'notify.payout.paid.body',
  }),
] as const;
