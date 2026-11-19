import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  listMyNotifications,
  markMyNotificationsRead,
} from '#src/features/notifications/server/notifications.functions.ts';
import { NotificationList } from '#src/features/notifications/ui/NotificationList.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// S16: opening the centre marks the shown items read, so the bell drops to 0 (BR12.18).
export const Route = createFileRoute('/notifications')({
  loader: async () => {
    const page = await listMyNotifications({ data: { page: 1, pageSize: 20 } });
    if (!page.ok) throw redirect({ to: '/sign-in' });
    await markMyNotificationsRead({ data: {} });
    return page.value;
  },
  component: NotificationsPage,
});

function NotificationsPage() {
  const { t } = useI18n();
  const page = Route.useLoaderData();
  return (
    <section className="grid gap-4" data-testid="notifications-page">
      <h1 className="text-2xl font-semibold">{t('notifications.title')}</h1>
      <NotificationList items={page.rows} />
    </section>
  );
}
