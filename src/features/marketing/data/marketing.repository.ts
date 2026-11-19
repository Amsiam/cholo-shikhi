// Campaigns, promo codes (with their uses) and bundles. The services check roles and inputs.
import { and, arrayContains, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { bundle, campaign, promoCode, promoRedemption } from '#src/server/schema/index.ts';

export type CampaignRow = typeof campaign.$inferSelect;
export type PromoRow = typeof promoCode.$inferSelect;
export type BundleRow = typeof bundle.$inferSelect;

const LIST_LIMIT = 200;

export function createMarketingRepository() {
  return {
    async campaigns(exec: Executor): Promise<CampaignRow[]> {
      return exec.select().from(campaign).orderBy(desc(campaign.startsOn)).limit(LIST_LIMIT);
    },
    /** Campaigns for the segment that run on this Dhaka date. */
    async liveCampaigns(exec: Executor, segmentId: string, today: string): Promise<CampaignRow[]> {
      return exec
        .select()
        .from(campaign)
        .where(
          and(
            arrayContains(campaign.segmentIds, [segmentId]),
            lte(campaign.startsOn, today),
            gte(campaign.endsOn, today),
          ),
        )
        .orderBy(desc(campaign.startsOn))
        .limit(3);
    },
    async insertCampaign(exec: Executor, row: typeof campaign.$inferInsert): Promise<CampaignRow> {
      const [created] = await exec.insert(campaign).values(row).returning();
      return created as CampaignRow;
    },

    async promos(exec: Executor): Promise<PromoRow[]> {
      return exec.select().from(promoCode).orderBy(desc(promoCode.createdAt)).limit(LIST_LIMIT);
    },
    async promoByCode(exec: Executor, code: string): Promise<PromoRow | null> {
      const rows = await exec.select().from(promoCode).where(eq(promoCode.code, code)).limit(1);
      return rows[0] ?? null;
    },
    async promoForUpdate(exec: Executor, promoCodeId: string): Promise<PromoRow | null> {
      const rows = await exec
        .select()
        .from(promoCode)
        .where(eq(promoCode.promoCodeId, promoCodeId))
        .for('update')
        .limit(1);
      return rows[0] ?? null;
    },
    async insertPromo(exec: Executor, row: typeof promoCode.$inferInsert): Promise<PromoRow> {
      const [created] = await exec.insert(promoCode).values(row).returning();
      return created as PromoRow;
    },
    async setPromoActive(exec: Executor, promoCodeId: string, isActive: boolean): Promise<void> {
      await exec.update(promoCode).set({ isActive }).where(eq(promoCode.promoCodeId, promoCodeId));
    },
    /**
     * AC8.3.5: claims one use only while uses are left, in one guarded statement; two buyers racing
     * for the last use cannot both succeed. False when none is left.
     */
    async claimUse(exec: Executor, promoCodeId: string): Promise<boolean> {
      const rows = await exec
        .update(promoCode)
        .set({ usedCount: sql`${promoCode.usedCount} + 1` })
        .where(
          and(eq(promoCode.promoCodeId, promoCodeId), lt(promoCode.usedCount, promoCode.maxUses)),
        )
        .returning({ id: promoCode.promoCodeId });
      return rows.length === 1;
    },
    async insertRedemption(
      exec: Executor,
      row: typeof promoRedemption.$inferInsert,
    ): Promise<void> {
      await exec.insert(promoRedemption).values(row);
    },
    /** Gives the use back when its payment fails. Idempotent: a released use is not given back twice. */
    async releaseUse(exec: Executor, paymentId: string): Promise<boolean> {
      const released = await exec
        .update(promoRedemption)
        .set({ isReleased: true })
        .where(and(eq(promoRedemption.paymentId, paymentId), eq(promoRedemption.isReleased, false)))
        .returning({ promoCodeId: promoRedemption.promoCodeId });
      const id = released[0]?.promoCodeId;
      if (!id) return false;
      await exec
        .update(promoCode)
        .set({ usedCount: sql`${promoCode.usedCount} - 1` })
        .where(eq(promoCode.promoCodeId, id));
      return true;
    },

    async bundleById(exec: Executor, bundleId: string): Promise<BundleRow | null> {
      const rows = await exec.select().from(bundle).where(eq(bundle.bundleId, bundleId)).limit(1);
      return rows[0] ?? null;
    },
    async bundles(exec: Executor): Promise<BundleRow[]> {
      return exec.select().from(bundle).orderBy(desc(bundle.createdAt)).limit(LIST_LIMIT);
    },
    async bundlesOfSegment(exec: Executor, segmentId: string): Promise<BundleRow[]> {
      return exec
        .select()
        .from(bundle)
        .where(and(eq(bundle.segmentId, segmentId), eq(bundle.isActive, true)))
        .orderBy(desc(bundle.createdAt))
        .limit(LIST_LIMIT);
    },
    async insertBundle(exec: Executor, row: typeof bundle.$inferInsert): Promise<BundleRow> {
      const [created] = await exec.insert(bundle).values(row).returning();
      return created as BundleRow;
    },
  };
}
