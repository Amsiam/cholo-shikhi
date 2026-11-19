// Job handlers and recurring schedules run by the worker process.

import {
  COMMERCE_SETTINGS,
  DEFAULT_PENDING_EXPIRY_MINUTES,
} from '#src/features/commerce/domain/commerce-settings.ts';
import { expireAbandonedBundleOrders } from '#src/features/commerce/server/bundle.server.ts';
import { expireAbandonedCheckouts } from '#src/features/commerce/server/commerce.server.ts';
import { expireDueSwitches } from '#src/features/commerce/server/switch.server.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { createAuditLog } from '#src/features/platform/server/audit-log.server.ts';
import { getHealth } from '#src/features/platform/server/health-instance.server.ts';
import type { JobHandler, RecurringJob } from '#src/features/platform/server/jobs.server.ts';
import { createFileObjectStore } from '#src/features/platform/server/object-store.server.ts';
import { createRenderer } from '#src/features/platform/server/renderer.server.ts';
import type { Settings } from '#src/features/platform/server/settings.server.ts';
import { ok } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';

export function createJobHandlers(deps: {
  db: Database;
  clock: Clock;
  settings: Settings;
}): Record<string, JobHandler> {
  return {
    'platform.auditRetention': async () => {
      const years = await deps.settings.get(U1_SETTINGS.auditRetentionYears);
      const result = await createAuditLog({ db: deps.db, clock: deps.clock }).runRetention({
        retentionYears: years.ok ? years.value.value : undefined,
      });
      return ok({ dropped: result.dropped, retentionYears: result.retentionYears });
    },
    // BR15.3: each component is probed every minute.
    'platform.healthProbe': async () => {
      const status = await getHealth().checkAndRecord();
      return ok({ overall: status.overall });
    },
    // US2.19: switch requests expire 24 hours after they were made.
    'commerce.expireSwitches': async () =>
      ok({ expired: await expireDueSwitches(new Date(deps.clock.now())) }),
    // An unpaid checkout older than the Admin-set expiry is failed and its promo use given back;
    // an unpaid bundle checkout expires on the same clock.
    'commerce.expirePendingPayments': async () => {
      const minutes = await deps.settings.get(COMMERCE_SETTINGS.pendingPaymentExpiryMinutes);
      const expiryMinutes = minutes.ok ? minutes.value.value : DEFAULT_PENDING_EXPIRY_MINUTES;
      const now = new Date(deps.clock.now());
      return ok({
        expired: await expireAbandonedCheckouts(now, expiryMinutes),
        expiredBundleOrders: await expireAbandonedBundleOrders(now, expiryMinutes),
        expiryMinutes,
      });
    },
    'platform.renderedRetention': async () => {
      const renderer = createRenderer({
        db: deps.db,
        clock: deps.clock,
        store: createFileObjectStore(),
        templates: [],
      });
      return ok({ purged: await renderer.purgeExpired() });
    },
  };
}

export const RECURRING_JOBS: readonly RecurringJob[] = [
  { name: 'platform.auditRetention', everyMinutes: 24 * 60 },
  { name: 'platform.renderedRetention', everyMinutes: 60 },
  { name: 'platform.healthProbe', everyMinutes: 1 },
  { name: 'commerce.expireSwitches', everyMinutes: 5 },
  { name: 'commerce.expirePendingPayments', everyMinutes: 5 },
];
