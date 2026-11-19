// One schema per marketing read and write (A9 forms and the server functions share them). Money is
// integer poisha and percent values are basis points; the domain re-checks both (AC8.2.2).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Bilingual = {
  nameBn: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
};

export const NoInput = z.object({}).default({});

export const SaveCampaignInput = z.object({
  ...Bilingual,
  bannerBn: z.string().trim().min(5).max(200),
  bannerEn: z.string().trim().min(5).max(200),
  landingPath: z
    .string()
    .trim()
    .regex(/^\/[^/]/)
    .max(300),
  segmentIds: z.array(Id).min(1).max(20),
  startsOn: Day,
  endsOn: Day,
});
export type SaveCampaignInput = z.input<typeof SaveCampaignInput>;

export const SavePromoInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,40}$/),
  kind: z.enum(['percent', 'fixed']),
  /** Percent codes: basis points (2000 = 20%). */
  percentBps: z.number().optional(),
  /** Fixed codes: integer poisha. */
  fixedPoisha: z.number().optional(),
  courseIds: z.array(Id).max(50).default([]),
  segmentIds: z.array(Id).max(20).default([]),
  startsOn: Day,
  endsOn: Day,
  maxUses: z.number(),
});
export type SavePromoInput = z.input<typeof SavePromoInput>;

export const SetPromoActiveInput = z.object({ promoCodeId: Id, isActive: z.boolean() });
export type SetPromoActiveInput = z.input<typeof SetPromoActiveInput>;

export const SaveBundleInput = z.object({
  ...Bilingual,
  segmentId: Id,
  pricePoisha: z.number().int().min(1).safe(),
  courseIds: z.array(Id).max(20),
});
export type SaveBundleInput = z.input<typeof SaveBundleInput>;

export const GoalBundlesInput = z.object({ goalId: Id });
export type GoalBundlesInput = z.input<typeof GoalBundlesInput>;
