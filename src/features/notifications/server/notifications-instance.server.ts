import { CATALOG_NOTIFICATION_TYPES } from '#src/features/catalog/domain/catalog-notifications.ts';
import { COMMERCE_NOTIFICATION_TYPES } from '#src/features/commerce/domain/commerce-notifications.ts';
import { GOALS_NOTIFICATION_TYPES } from '#src/features/goals/domain/goals-notifications.ts';
import { KYC_NOTIFICATION_TYPES } from '#src/features/kyc/domain/kyc-notifications.ts';
import { PAYOUT_NOTIFICATION_TYPES } from '#src/features/payouts/domain/payout-notifications.ts';
import { getInstrument } from '#src/features/platform/server/instrument.server.ts';
import { outbox } from '#src/features/platform/server/outbox-instance.server.ts';
import { getSettings } from '#src/features/platform/server/settings-instance.server.ts';
import { TRUSTOPS_NOTIFICATION_TYPES } from '#src/features/trustops/domain/trustops-notifications.ts';
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { U1_NOTIFICATION_TYPES } from '../domain/notification-types.ts';
import { createDevMailboxSender } from './email-sender.server.ts';
import { createNotifications, type Notifications } from './notifications.server.ts';

// Notification-type registry: modules register here by convention; see README.md "Adding a module".
let shared: Notifications | undefined;

/** Later units append their notification types here when they are built. */
export function getNotifications(): Notifications {
  if (!shared) {
    const log = getLogger().child({ component: 'email' });
    shared = createNotifications({
      db: getDb(),
      clock: systemClock,
      outbox,
      settings: getSettings(),
      // The global email provider is chosen later (recorded exception, Q10=B); locally the dev mailbox.
      emailSender: createDevMailboxSender(undefined, (message) => log.info(message)),
      types: [
        ...U1_NOTIFICATION_TYPES,
        ...GOALS_NOTIFICATION_TYPES,
        ...CATALOG_NOTIFICATION_TYPES,
        ...KYC_NOTIFICATION_TYPES,
        ...PAYOUT_NOTIFICATION_TYPES,
        ...TRUSTOPS_NOTIFICATION_TYPES,
        ...COMMERCE_NOTIFICATION_TYPES,
      ],
      metrics,
      instrument: getInstrument(),
    });
  }
  return shared;
}
