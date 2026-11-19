// NotificationBell (BR12.18): unread count in the accessible name, announced politely when it changes.
import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';

export function NotificationBell(props: { unread: number }) {
  const { t, formatInteger } = useI18n();
  const label = t('shell.bell.label', { count: props.unread });
  return (
    <Link
      to="/notifications"
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-sm hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      data-testid="notification-bell-link"
    >
      <Bell aria-hidden="true" />
      {props.unread > 0 ? (
        <span
          className="absolute top-1 right-1 rounded-full bg-destructive px-1.5 text-xs text-white"
          data-testid="notification-bell-count"
        >
          {formatInteger(props.unread)}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </Link>
  );
}
