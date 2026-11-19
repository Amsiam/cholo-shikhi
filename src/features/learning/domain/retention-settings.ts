// Settings declared by U5 retention (Q8=B: amounts are Admin settings; defaults proposed here).
import { defineSetting } from '#src/features/platform/domain/settings.ts';

export const RETENTION_SETTINGS = {
  /** Streak-tokens credited for the first qualifying activity of each Asia/Dhaka day (US5.16). */
  dailyTokens: defineSetting({
    settingKey: 'retention.tokens.daily',
    ownerFeature: 'learning',
    valueType: 'integer',
    min: 0,
    max: 100,
    unit: 'count',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 5,
  }),
  /** Tokens a quick match costs, returned if no opponent is found in 90 seconds (US5.8). 0 = free. */
  battleEntryTokens: defineSetting({
    settingKey: 'retention.tokens.battleEntry',
    ownerFeature: 'learning',
    valueType: 'integer',
    min: 0,
    max: 100,
    unit: 'count',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 2,
  }),
  /** How many top finishers of a live pop-quiz earn a streak-shield (FR5.3, US5.6). */
  shieldTopN: defineSetting({
    settingKey: 'retention.shields.topN',
    ownerFeature: 'learning',
    valueType: 'integer',
    min: 1,
    max: 100,
    unit: 'count',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 10,
  }),
  /** How 1.2 × the daily tokens is rounded on a study buddy day: half_up, down or up (US5.13). */
  buddyRounding: defineSetting({
    settingKey: 'retention.buddy.rounding',
    ownerFeature: 'learning',
    valueType: 'string',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 'half_up',
  }),
  /** US3.12: how often the viewer badge jumps to a new place on the video (seconds). */
  videoBadgeSeconds: defineSetting({
    settingKey: 'learning.video.badgeSeconds',
    ownerFeature: 'learning',
    valueType: 'integer',
    min: 10,
    max: 600,
    unit: 'count',
    scope: 'global',
    blocksWhenUnset: false,
    defaultValue: 45,
  }),
} as const;
