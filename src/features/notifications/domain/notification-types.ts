// Notification types are declared in code by the producing feature and read-only at runtime (Q3).
import type { MessageKey } from '#src/lib/i18n/index.ts';

export type Channel = 'in_app' | 'push' | 'email' | 'sms';
export type Category =
  | 'security'
  | 'payment'
  | 'account'
  | 'learning'
  | 'live_class'
  | 'instructor'
  | 'referral'
  | 'data_rights';

export type NotificationType = {
  typeKey: string;
  category: Category;
  /** True exactly when the category is security or payment (Q3, BR12.8). */
  isLocked: boolean;
  defaultChannels: readonly Channel[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
};

const TYPE_KEY = /^notify\.[a-z0-9.]+$/i;

export function defineNotificationType(
  input: Omit<NotificationType, 'isLocked'>,
): NotificationType {
  if (!TYPE_KEY.test(input.typeKey))
    throw new Error(`invalid notification type key ${input.typeKey}`);
  if (input.defaultChannels.length === 0)
    throw new Error('a notification type needs at least one default channel');
  return { ...input, isLocked: input.category === 'security' || input.category === 'payment' };
}

/** Types U1 itself sends. Later units declare theirs next to their producers. */
export const U1_NOTIFICATION_TYPES = [
  defineNotificationType({
    typeKey: 'notify.account.welcome',
    category: 'account',
    defaultChannels: ['in_app'],
    titleKey: 'notify.account.welcome.title',
    bodyKey: 'notify.account.welcome.body',
  }),
  defineNotificationType({
    typeKey: 'notify.security.passwordChanged',
    category: 'security',
    defaultChannels: ['in_app', 'email'],
    titleKey: 'notify.security.passwordChanged.title',
    bodyKey: 'notify.security.passwordChanged.body',
  }),
] as const;
