// Settings declared by Referrals (US8.7, US8.8). Both have a default the Admin can change on A1:
// a referrer earns 10% (1000 bp) of each paid referred enrolment, and a referral balance can be
// withdrawn once it reaches ৳500 (50000 poisha).
import { defineSetting } from '#src/features/platform/domain/settings.ts';

/** The default referrer share: 10%. */
export const DEFAULT_REFERRAL_SHARE_BPS = 1000;
/** The default smallest withdrawable referral balance: ৳500. */
export const DEFAULT_REFERRAL_PAYOUT_THRESHOLD_POISHA = 50_000;

export const REFERRAL_SETTINGS = {
  /** The referrer's share of each paid enrolment (after promo), in basis points. */
  shareBps: defineSetting({
    settingKey: 'referrals.shareBps',
    ownerFeature: 'referrals',
    valueType: 'integer',
    min: 0,
    max: 10_000,
    unit: 'basis_points',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: DEFAULT_REFERRAL_SHARE_BPS,
  }),
  /** The smallest balance that can be paid out, in poisha. */
  payoutThresholdPoisha: defineSetting({
    settingKey: 'referrals.payoutThresholdPoisha',
    ownerFeature: 'referrals',
    valueType: 'integer',
    min: 1,
    max: 100_000_000,
    unit: 'poisha',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: DEFAULT_REFERRAL_PAYOUT_THRESHOLD_POISHA,
  }),
} as const;
