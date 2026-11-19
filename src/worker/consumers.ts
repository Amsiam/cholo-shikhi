// Every outbox consumer that runs in the worker process registers here (contract 2).
import type { Notifications } from '#src/features/notifications/server/notifications.server.ts';

export function registerWorkerConsumers(notifications: Notifications): void {
  notifications.registerInboxConsumer();
  notifications.registerWelcomeConsumer();
}
