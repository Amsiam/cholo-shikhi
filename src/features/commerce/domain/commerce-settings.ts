// Settings declared by U3 Commerce. The refund window blocks when unset and has no default
// (PRD FR-DIST-5 / §4.6): Students cannot ask for a refund until an Admin sets it.
import { defineSetting } from '#src/features/platform/domain/settings.ts';

/** An unpaid checkout is abandoned after an hour unless an Admin sets otherwise. */
export const DEFAULT_PENDING_EXPIRY_MINUTES = 60;

export const COMMERCE_SETTINGS = {
  /** How many days after a purchase a Student may still ask for a refund. */
  refundWindowDays: defineSetting({
    settingKey: 'commerce.refund.windowDays',
    ownerFeature: 'commerce',
    valueType: 'integer',
    min: 1,
    max: 365,
    unit: 'days',
    scope: 'global',
    blocksWhenUnset: true,
  }),
  /** US2.23: how many days a new trial in this Goal segment lasts (scope key: the segment ID). */
  trialDays: defineSetting({
    settingKey: 'commerce.trial.days',
    ownerFeature: 'commerce',
    valueType: 'integer',
    min: 1,
    max: 365,
    unit: 'days',
    scope: 'goal_segment',
    blocksWhenUnset: false,
    defaultValue: 30,
  }),
  /** US2.23: how many lessons a new trial in this Goal segment opens. */
  trialLessons: defineSetting({
    settingKey: 'commerce.trial.lessons',
    ownerFeature: 'commerce',
    valueType: 'integer',
    min: 1,
    max: 100,
    unit: 'count',
    scope: 'goal_segment',
    blocksWhenUnset: false,
    defaultValue: 5,
  }),
  /**
   * How long an unpaid checkout stays open. After it, the pending payment is expired (failed) and
   * its promo-code use is given back, so an abandoned checkout never holds a use for ever.
   */
  pendingPaymentExpiryMinutes: defineSetting({
    settingKey: 'commerce.checkout.pendingExpiryMinutes',
    ownerFeature: 'commerce',
    valueType: 'integer',
    min: 15,
    max: 1440,
    unit: 'minutes',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: DEFAULT_PENDING_EXPIRY_MINUTES,
  }),
} as const;
