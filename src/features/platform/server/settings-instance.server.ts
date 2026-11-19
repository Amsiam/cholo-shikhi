import { CATALOG_SETTINGS } from '#src/features/catalog/domain/catalog-settings.ts';
import { COMMERCE_SETTINGS } from '#src/features/commerce/domain/commerce-settings.ts';
import { RETENTION_SETTINGS } from '#src/features/learning/domain/retention-settings.ts';
import { PAYOUT_SETTINGS } from '#src/features/payouts/domain/payout-settings.ts';
import { REFERRAL_SETTINGS } from '#src/features/referrals/domain/referral-settings.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { U1_SETTINGS } from '../domain/u1-settings.ts';
import { getInstrument } from './instrument.server.ts';
import { createSettings, type Settings } from './settings.server.ts';

// Settings registry: modules register here by convention; see README.md "Adding a module".
let shared: Settings | undefined;

/** Later units add their definitions to this list when they are built. */
export function getSettings(): Settings {
  if (!shared) {
    shared = createSettings({
      db: getDb(),
      clock: systemClock,
      definitions: [
        ...Object.values(U1_SETTINGS),
        ...Object.values(CATALOG_SETTINGS),
        ...Object.values(COMMERCE_SETTINGS),
        ...Object.values(RETENTION_SETTINGS),
        ...Object.values(PAYOUT_SETTINGS),
        ...Object.values(REFERRAL_SETTINGS),
      ],
      instrument: getInstrument(),
    });
  }
  return shared;
}
