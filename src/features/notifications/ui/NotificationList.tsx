// S16 NotificationCentre (BR12.18): the user's own notifications, newest first, in their language.
import { CheckCheck } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';

export type NotificationItem = {
  notificationId: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
};

export function NotificationList(props: { items: readonly NotificationItem[] }) {
  const { t, formatDateTime } = useI18n();
  if (props.items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 border border-dashed border-primary/30 bg-background px-6 py-12 text-center"
        data-testid="notification-list-empty"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-pass/15 text-pass">
          <CheckCheck aria-hidden="true" className="size-6" />
        </span>
        <p className="font-semibold text-ink">{t('notifications.empty')}</p>
      </div>
    );
  }
  return (
    <ul
      className="flex flex-col divide-y divide-primary/10 border border-primary/15 bg-background"
      data-testid="notification-list"
    >
      {props.items.map((item) => (
        <li
          key={item.notificationId}
          className="flex gap-3 px-5 py-4"
          data-testid="notification-list-item"
        >
          {/* Unread is a filled answer bubble, read an empty one (not colour alone: weight too). */}
          <span
            aria-hidden="true"
            className={`mt-1.5 size-3 shrink-0 rounded-full border-2 ${item.isRead ? 'border-ink/20' : 'border-primary bg-primary'}`}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p className={item.isRead ? 'text-ink' : 'font-semibold text-ink'}>{item.title}</p>
            <p className="text-sm text-ink/75">{item.body}</p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
