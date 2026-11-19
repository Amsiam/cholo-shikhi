// Every table of U1 (identity, platform, notifications, audit), U2 (goals, catalog) and the
// commerce/learning slice (learning.ts). drizzle.config.ts
// points drizzle-kit at every file except audit.ts (a hand-written partitioned table).

export * from './assessment.ts';
export * from './audit.ts';
export * from './battle.ts';
export * from './catalog.ts';
export * from './goals.ts';
export * from './hr.ts';
export * from './identity.ts';
export * from './insights.ts';
export * from './kyc.ts';
export * from './learning.ts';
export * from './ledger.ts';
export * from './live.ts';
export * from './marketing.ts';
export * from './notifications.ts';
export * from './payouts.ts';
export * from './platform.ts';
export * from './referrals.ts';
export * from './rewards.ts';
export * from './trustops.ts';
