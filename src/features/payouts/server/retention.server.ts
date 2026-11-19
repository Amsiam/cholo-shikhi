// How long instructor statements are kept (FR7.4, AC7.8.3): the setting, never below 10 years.
import { settings } from '#src/features/platform/index.ts';
import { PAYOUT_SETTINGS } from '../domain/payout-settings.ts';

export async function statementRetentionYears(): Promise<number> {
  const r = await settings().get(PAYOUT_SETTINGS.statementRetentionYears);
  return Math.max(10, r.ok ? r.value.value : 10);
}
