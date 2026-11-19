// Marketing (U3; US8.1, US8.2, US8.4; FR8.1): campaigns, promo codes and their uses, and bundles.
// Money is integer poisha in bigint columns and percent discounts are basis points (FR7.10).
// Dates are Asia/Dhaka calendar dates ("YYYY-MM-DD"), both ends inclusive. Cross-unit IDs (segments,
// courses, payments, users) are not foreign keys (ADR-020); the marketing service checks them.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });

/** US8.1: a banner with a landing page, shown to chosen segments between two dates. */
export const campaign = pgTable(
  'campaign',
  {
    campaignId: uuid('campaign_id').primaryKey().defaultRandom(), // C2
    nameBn: text('name_bn').notNull(), // C2
    nameEn: text('name_en').notNull(), // C2
    bannerBn: text('banner_bn').notNull(), // C1
    bannerEn: text('banner_en').notNull(), // C1
    /** An in-app path the banner links to ("/catalog?goal=…"). */
    landingPath: text('landing_path').notNull(), // C1
    segmentIds: uuid('segment_ids').array().notNull(), // C2
    startsOn: day('starts_on').notNull(), // C2
    endsOn: day('ends_on').notNull(), // C2
    createdBy: uuid('created_by').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('campaign_dates_ck', sql`${t.endsOn} >= ${t.startsOn}`),
    check('campaign_landing_ck', sql`${t.landingPath} ~ '^/[^/]'`),
    check('campaign_segments_ck', sql`cardinality(${t.segmentIds}) >= 1`),
    index('campaign_dates_idx').on(t.endsOn, t.startsOn),
  ],
);

export const PROMO_KINDS = ['percent', 'fixed'] as const;

/** US8.2: a percent (basis points) or fixed (poisha) code, scoped by course, segment, dates, uses. */
export const promoCode = pgTable(
  'promo_code',
  {
    promoCodeId: uuid('promo_code_id').primaryKey().defaultRandom(), // C2
    /** Stored in upper case; matched case-insensitively. */
    code: text('code').notNull(), // C2
    kind: text('kind', { enum: PROMO_KINDS }).notNull(), // C2
    percentBps: integer('percent_bps'), // C2
    fixedPoisha: bigint('fixed_poisha', { mode: 'number' }), // C2
    /** Empty: any course. */
    courseIds: uuid('course_ids').array().notNull().default(sql`'{}'::uuid[]`), // C2
    /** Empty: any segment. */
    segmentIds: uuid('segment_ids').array().notNull().default(sql`'{}'::uuid[]`), // C2
    startsOn: day('starts_on').notNull(), // C2
    endsOn: day('ends_on').notNull(), // C2
    maxUses: integer('max_uses').notNull(), // C2
    usedCount: integer('used_count').notNull().default(0), // C2
    isActive: boolean('is_active').notNull().default(true), // C2
    createdBy: uuid('created_by').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    unique('promo_code_code_uq').on(t.code),
    check('promo_code_code_ck', sql`${t.code} ~ '^[A-Z0-9_-]{3,40}$'`),
    check('promo_code_kind_ck', sql`${t.kind} in ('percent', 'fixed')`),
    check(
      'promo_code_value_ck',
      sql`(${t.kind} = 'percent' and ${t.percentBps} between 1 and 10000 and ${t.fixedPoisha} is null) or (${t.kind} = 'fixed' and ${t.fixedPoisha} >= 1 and ${t.percentBps} is null)`,
    ),
    check('promo_code_dates_ck', sql`${t.endsOn} >= ${t.startsOn}`),
    // AC8.3.5: uses are claimed with a guarded increment, so the count can never pass the limit.
    check(
      'promo_code_uses_ck',
      sql`${t.maxUses} >= 1 and ${t.usedCount} between 0 and ${t.maxUses}`,
    ),
  ],
);

/** One use of a code, logged against the order (AC8.3.1). Released if the payment fails. */
export const promoRedemption = pgTable(
  'promo_redemption',
  {
    redemptionId: uuid('redemption_id').primaryKey().defaultRandom(), // C2
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => promoCode.promoCodeId, { onDelete: 'restrict' }), // C2
    paymentId: uuid('payment_id').notNull(), // C2
    userId: uuid('user_id').notNull(), // C3
    listPricePoisha: bigint('list_price_poisha', { mode: 'number' }).notNull(), // C2
    discountPoisha: bigint('discount_poisha', { mode: 'number' }).notNull(), // C2
    isReleased: boolean('is_released').notNull().default(false), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    unique('promo_redemption_payment_uq').on(t.paymentId),
    check(
      'promo_redemption_amounts_ck',
      sql`${t.discountPoisha} >= 1 and ${t.discountPoisha} < ${t.listPricePoisha}`,
    ),
    index('promo_redemption_code_idx').on(t.promoCodeId),
  ],
);

/** US8.4: several published courses of one segment at one price. */
export const bundle = pgTable(
  'bundle',
  {
    bundleId: uuid('bundle_id').primaryKey().defaultRandom(), // C2
    nameBn: text('name_bn').notNull(), // C1
    nameEn: text('name_en').notNull(), // C1
    segmentId: uuid('segment_id').notNull(), // C1
    pricePoisha: bigint('price_poisha', { mode: 'number' }).notNull(), // C1
    courseIds: uuid('course_ids').array().notNull(), // C1
    isActive: boolean('is_active').notNull().default(true), // C2
    createdBy: uuid('created_by').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('bundle_price_ck', sql`${t.pricePoisha} >= 1`),
    check('bundle_courses_ck', sql`cardinality(${t.courseIds}) >= 2`),
    index('bundle_segment_idx').on(t.segmentId),
  ],
);
