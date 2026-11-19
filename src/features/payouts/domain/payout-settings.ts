// Settings declared by U9 Payouts.
import { defineSetting } from '#src/features/platform/domain/settings.ts';

export const PAYOUT_SETTINGS = {
  /** FR7.4 / AC7.8.3: how long payout statements are kept; never below 10 years. */
  statementRetentionYears: defineSetting({
    settingKey: 'payouts.statementRetentionYears',
    ownerFeature: 'payouts',
    valueType: 'integer',
    min: 10,
    max: 50,
    unit: 'years',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 10,
  }),
} as const;

/** Feature flags declared by U9 Payouts. */
export const PAYOUT_FLAGS = {
  /**
   * Off by default. Turns on the payout rules whose golden examples are still a DRAFT
   * (./golden/drafts): attribution money (US7.13), payroll salary lines (US7.16) and hybrid lines
   * (US7.27). With it on, a payout cycle refuses to commit until the human approves the drafts.
   */
  payrollAndAttribution: 'payouts.payrollAndAttribution',
} as const;
