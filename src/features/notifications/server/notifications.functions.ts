// The bell and in-app centre (S16): every function needs a signed-in user and only touches their own data.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { ok } from '#src/lib/result.ts';
import { authedFn, typedInput } from '#src/server/fn.ts';
import { NotificationListInput, NotificationPreferenceInput } from './notifications.schema.ts';
import { getNotifications } from './notifications-instance.server.ts';

const NoInput = z.object({}).default({});

export const listMyNotifications = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NotificationListInput>())
  .handler(
    authedFn(NotificationListInput, async ({ actor, input }) =>
      ok(await getNotifications().list(actor, input)),
    ),
  );

export const getMyUnreadCount = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor }) =>
      ok({ unread: await getNotifications().unreadCount(actor) }),
    ),
  );

export const markMyNotificationsRead = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor }) => {
      await getNotifications().markAllRead(actor);
      return ok({ unread: 0 });
    }),
  );

export const setNotificationPreference = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NotificationPreferenceInput>())
  .handler(
    authedFn(NotificationPreferenceInput, ({ actor, input }) =>
      getNotifications().setPreference(actor, input),
    ),
  );
