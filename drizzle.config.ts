import { defineConfig } from 'drizzle-kit';

// Generated SQL is reviewed and forward-only (TS-03). audit.ts is excluded on purpose: its
// partitioned table lives in a hand-written migration.
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/server/schema/identity.ts',
    './src/server/schema/platform.ts',
    './src/server/schema/notifications.ts',
    './src/server/schema/goals.ts',
    './src/server/schema/catalog.ts',
    './src/server/schema/learning.ts',
    './src/server/schema/ledger.ts',
    './src/server/schema/assessment.ts',
    './src/server/schema/battle.ts',
    './src/server/schema/live.ts',
    './src/server/schema/rewards.ts',
    './src/server/schema/kyc.ts',
    './src/server/schema/payouts.ts',
    './src/server/schema/insights.ts',
    './src/server/schema/trustops.ts',
    './src/server/schema/marketing.ts',
    './src/server/schema/hr.ts',
    './src/server/schema/referrals.ts',
  ],
  out: './drizzle',
  strict: true,
  verbose: true,
});
