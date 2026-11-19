// Route-level adapter for Marketing's public bundle read (U3; BR11.3, US8.4). The catalog route
// composes it beside the course list; the catalog feature never imports Marketing (ADR-020).
import { listGoalBundles } from '#src/features/marketing/server/marketing.functions.ts';
import type { BundleCard } from '#src/features/marketing/server/marketing.server.ts';

export type { BundleCard };

export async function listBundlesForGoal(goalId: string): Promise<BundleCard[]> {
  const r = await listGoalBundles({ data: { goalId } });
  return r.ok ? (r.value as BundleCard[]) : [];
}
