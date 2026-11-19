// Marketing (U3; screen A9 for Admins with two-step sign-in, banners on S2, bundles on the catalog).
// - Campaigns (US8.1): a bilingual banner and an in-app landing path for chosen segments between
//   two Asia/Dhaka dates; an end before the start is refused.
// - Promo codes (US8.2): percent (basis points) or fixed (poisha), scoped by course, segment, dates
//   and maximum uses. Checkout (Commerce) claims a use through claimPromoUse inside its own
//   transaction, so the discounted price and the logged use commit together (US8.3).
// - Bundles (US8.4): at least two published courses of one segment at one price. An academic
//   segment's Students hold one active course at a time (US2.16), so a bundle of more than one
//   course is refused there.
// Every Admin write is audit-logged.
import { courseTitlesOf, getProductTerms } from '#src/features/catalog/index.ts';
import { getActiveGoal, getCurrentGoal, getSegment } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  type BundleRow,
  type CampaignRow,
  createMarketingRepository,
  type PromoRow,
} from '../data/marketing.repository.ts';
import { dhakaToday, distinctCourses, isBundleSize, isDateRange } from '../domain/campaign.ts';
import {
  type Discount,
  discountFor,
  normaliseCode,
  type PromoError,
  promoRefusal,
  validatePromoTerms,
} from '../domain/pricing.ts';
import {
  GoalBundlesInput,
  SaveBundleInput,
  SaveCampaignInput,
  SavePromoInput,
  SetPromoActiveInput,
} from './marketing.schema.ts';

const repo = createMarketingRepository();
const audit = createAudit({ clock: systemClock });

type MarketingError = PromoError | AppError<'FORBIDDEN' | 'CONFLICT'>;
const withKey = <C extends PromoError['code'] | 'FORBIDDEN' | 'CONFLICT'>(
  code: C,
  i18nKey: `errors.${string}`,
) => ({ ...appError(code), i18nKey });
const forbidden = () => withKey('FORBIDDEN', 'errors.marketing.forbidden');
const canManage = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

/** The segment a course is sold under (its Goal's segment), or null. */
async function segmentOfGoal(goalId: string | null): Promise<string | null> {
  if (!goalId) return null;
  const goal = await getActiveGoal(goalId);
  return goal.ok ? goal.value.segmentId : null;
}

/** Published courses only; each with its segment. NOT_FOUND names the first that is not. */
async function publishedCourses(
  courseIds: readonly string[],
): Promise<
  Result<Array<{ courseId: string; segmentId: string | null; price: number }>, PromoError>
> {
  const out: Array<{ courseId: string; segmentId: string | null; price: number }> = [];
  for (const courseId of courseIds) {
    const terms = await getProductTerms({ type: 'course', id: courseId });
    if (!terms.ok || terms.value.status !== 'published')
      return err(withKey('NOT_FOUND', 'errors.marketing.courseNotPublished'));
    out.push({
      courseId,
      segmentId: await segmentOfGoal(terms.value.goalId),
      price: terms.value.listPrice,
    });
  }
  return ok(out);
}

// ------------------------------------------------------------------------------- campaigns

export async function saveCampaign(
  actor: Actor,
  raw: SaveCampaignInput,
  correlationId: string,
): Promise<Result<{ campaignId: string }, MarketingError>> {
  if (!canManage(actor)) return err(forbidden());
  const input = SaveCampaignInput.parse(raw);
  if (!isDateRange(input.startsOn, input.endsOn))
    return err({
      ...withKey('VALIDATION_FAILED', 'errors.marketing.dates'),
      fieldErrors: { endsOn: ['errors.marketing.dates'] },
    });
  return withTransaction(getDb(), async (tx) => {
    const row = await repo.insertCampaign(unwrapTx(tx), {
      ...input,
      segmentIds: [...new Set(input.segmentIds)],
      createdBy: actor.userId,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'marketing.campaign.created',
      subjectType: 'campaign',
      subjectId: row.campaignId,
      after: { segmentIds: row.segmentIds.join(','), startsOn: row.startsOn, endsOn: row.endsOn },
      correlationId,
    });
    return ok({ campaignId: row.campaignId });
  });
}

export type CampaignBanner = {
  campaignId: string;
  bannerBn: string;
  bannerEn: string;
  landingPath: string;
};

/** AC8.1.1 / AC8.1.2: the banners for the Student's segment today (Asia/Dhaka). */
export async function myCampaignBanners(
  actor: Actor,
  at: Date = new Date(),
): Promise<Result<CampaignBanner[], never>> {
  const goal = await getCurrentGoal(actor.userId);
  if (!goal.ok) return ok([]);
  const rows = await repo.liveCampaigns(
    getDb(),
    goal.value.segmentId,
    dhakaToday(at.toISOString()),
  );
  return ok(
    rows.map((r) => ({
      campaignId: r.campaignId,
      bannerBn: r.bannerBn,
      bannerEn: r.bannerEn,
      landingPath: r.landingPath,
    })),
  );
}

// ------------------------------------------------------------------------------- promo codes

const discountOf = (row: PromoRow): Discount =>
  row.kind === 'percent'
    ? { kind: 'percent', bps: row.percentBps ?? 0 }
    : { kind: 'fixed', poisha: row.fixedPoisha ?? 0 };

export async function savePromo(
  actor: Actor,
  raw: SavePromoInput,
  correlationId: string,
): Promise<Result<{ promoCodeId: string }, MarketingError>> {
  if (!canManage(actor)) return err(forbidden());
  const input = SavePromoInput.parse(raw);
  const discount: Discount =
    input.kind === 'percent'
      ? { kind: 'percent', bps: input.percentBps ?? Number.NaN }
      : { kind: 'fixed', poisha: input.fixedPoisha ?? Number.NaN };
  const valid = validatePromoTerms({ ...input, discount });
  if (!valid.ok) return valid;
  const courses = await publishedCourses(distinctCourses(input.courseIds));
  if (!courses.ok) return courses;
  const code = normaliseCode(input.code);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    if (await repo.promoByCode(exec, code))
      return err(withKey('CONFLICT', 'errors.promo.duplicate'));
    const row = await repo.insertPromo(exec, {
      code,
      kind: discount.kind,
      percentBps: discount.kind === 'percent' ? discount.bps : null,
      fixedPoisha: discount.kind === 'fixed' ? discount.poisha : null,
      courseIds: distinctCourses(input.courseIds),
      segmentIds: [...new Set(input.segmentIds)],
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      maxUses: input.maxUses,
      createdBy: actor.userId,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'marketing.promo.created',
      subjectType: 'promo_code',
      subjectId: row.promoCodeId,
      after: {
        code,
        kind: row.kind,
        percentBps: row.percentBps,
        fixedPoisha: row.fixedPoisha,
        maxUses: row.maxUses,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
      },
      correlationId,
    });
    return ok({ promoCodeId: row.promoCodeId });
  });
}

export async function setPromoActive(
  actor: Actor,
  raw: SetPromoActiveInput,
  correlationId: string,
): Promise<Result<{ isActive: boolean }, MarketingError>> {
  if (!canManage(actor)) return err(forbidden());
  const input = SetPromoActiveInput.parse(raw);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const row = await repo.promoForUpdate(exec, input.promoCodeId);
    if (!row) return err(withKey('NOT_FOUND', 'errors.promo.notFound'));
    await repo.setPromoActive(exec, row.promoCodeId, input.isActive);
    await audit.record(tx, {
      actorId: actor.userId,
      action: input.isActive ? 'marketing.promo.activated' : 'marketing.promo.deactivated',
      subjectType: 'promo_code',
      subjectId: row.promoCodeId,
      before: { isActive: row.isActive },
      after: { isActive: input.isActive },
      correlationId,
    });
    return ok({ isActive: input.isActive });
  });
}

export type PromoClaim = { promoCodeId: string; discountPoisha: number; payPoisha: number };

/**
 * US8.3, inside Commerce's checkout transaction: checks the code against the course, its segment and
 * today's Dhaka date, prices it, claims one use (only while uses are left, AC8.3.5) and logs the use
 * against the payment. Any refusal names its reason and leaves the price unchanged (AC8.3.3).
 */
export async function claimPromoUse(
  tx: TxHandle,
  input: {
    code: string;
    courseId: string;
    goalId: string | null;
    listPricePoisha: number;
    paymentId: string;
    userId: string;
    at: Date;
  },
): Promise<Result<PromoClaim, PromoError>> {
  const exec = unwrapTx(tx);
  const found = await repo.promoByCode(exec, normaliseCode(input.code));
  if (!found) return err(withKey('NOT_FOUND', 'errors.promo.notFound'));
  const reason = promoRefusal(found, {
    courseId: input.courseId,
    segmentId: await segmentOfGoal(input.goalId),
    today: dhakaToday(input.at.toISOString()),
  });
  if (reason) return err(withKey('INVALID_STATE', reason));
  const priced = discountFor(input.listPricePoisha as MoneyPoisha, discountOf(found));
  if (!priced.ok) return priced;
  if (!(await repo.claimUse(exec, found.promoCodeId)))
    return err(withKey('INVALID_STATE', 'errors.promo.usedUp'));
  await repo.insertRedemption(exec, {
    promoCodeId: found.promoCodeId,
    paymentId: input.paymentId,
    userId: input.userId,
    listPricePoisha: input.listPricePoisha,
    discountPoisha: priced.value.discountPoisha,
  });
  return ok({ promoCodeId: found.promoCodeId, ...priced.value });
}

/** A failed payment gives its promo use back (idempotent). */
export async function releasePromoUse(tx: TxHandle, paymentId: string): Promise<void> {
  await repo.releaseUse(unwrapTx(tx), paymentId);
}

// ------------------------------------------------------------------------------- bundles

export async function saveBundle(
  actor: Actor,
  raw: SaveBundleInput,
  correlationId: string,
): Promise<Result<{ bundleId: string }, MarketingError>> {
  if (!canManage(actor)) return err(forbidden());
  const input = SaveBundleInput.parse(raw);
  const courseIds = distinctCourses(input.courseIds);
  if (!isBundleSize(courseIds))
    return err({
      ...withKey('VALIDATION_FAILED', 'errors.marketing.bundleSize'),
      fieldErrors: { courseIds: ['errors.marketing.bundleSize'] },
    });
  const courses = await publishedCourses(courseIds);
  if (!courses.ok) return courses;
  if (courses.value.some((c) => c.segmentId !== input.segmentId))
    return err(withKey('VALIDATION_FAILED', 'errors.marketing.bundleSegment'));
  const segment = await getSegment(input.segmentId);
  if (segment.ok && segment.value.segmentType === 'academic' && courseIds.length > 1)
    return err({
      ...withKey('VALIDATION_FAILED', 'errors.marketing.academicBundle'),
      fieldErrors: { courseIds: ['errors.marketing.academicBundle'] },
    });
  return withTransaction(getDb(), async (tx) => {
    const row = await repo.insertBundle(unwrapTx(tx), {
      nameBn: input.nameBn,
      nameEn: input.nameEn,
      segmentId: input.segmentId,
      pricePoisha: input.pricePoisha,
      courseIds,
      createdBy: actor.userId,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'marketing.bundle.created',
      subjectType: 'bundle',
      subjectId: row.bundleId,
      after: { segmentId: row.segmentId, pricePoisha: row.pricePoisha, courses: courseIds.length },
      correlationId,
    });
    return ok({ bundleId: row.bundleId });
  });
}

export type BundleCard = {
  bundleId: string;
  nameBn: string;
  nameEn: string;
  pricePoisha: number;
  courses: Array<{ courseId: string; titleBn: string; titleEn: string }>;
};

export type ActiveBundle = {
  bundleId: string;
  nameBn: string;
  nameEn: string;
  segmentId: string;
  pricePoisha: number;
  courseIds: string[];
};

/** US8.5 (Commerce's bundle checkout): an active bundle, or null. */
export async function activeBundle(bundleId: string): Promise<ActiveBundle | null> {
  const row = await repo.bundleById(getDb(), bundleId);
  if (!row?.isActive) return null;
  return {
    bundleId: row.bundleId,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    segmentId: row.segmentId,
    pricePoisha: row.pricePoisha,
    courseIds: row.courseIds,
  };
}

/** AC8.4.1: the active bundles of a Goal's segment, for the catalog's Bundles list. */
export async function goalBundles(raw: GoalBundlesInput): Promise<Result<BundleCard[], never>> {
  const input = GoalBundlesInput.parse(raw);
  const segmentId = await segmentOfGoal(input.goalId);
  if (!segmentId) return ok([]);
  const rows = await repo.bundlesOfSegment(getDb(), segmentId);
  const titles = await courseTitlesOf([...new Set(rows.flatMap((r) => r.courseIds))]);
  return ok(
    rows.map((r) => ({
      bundleId: r.bundleId,
      nameBn: r.nameBn,
      nameEn: r.nameEn,
      pricePoisha: r.pricePoisha,
      courses: r.courseIds.map((courseId) => ({
        courseId,
        titleBn: titles[courseId]?.titleBn ?? '',
        titleEn: titles[courseId]?.titleEn ?? '',
      })),
    })),
  );
}

// ------------------------------------------------------------------------------- A9 overview

export type MarketingOverview = {
  campaigns: Array<Omit<CampaignRow, 'createdAt'> & { createdAt: string }>;
  promos: Array<Omit<PromoRow, 'createdAt'> & { createdAt: string }>;
  bundles: Array<Omit<BundleRow, 'createdAt'> & { createdAt: string }>;
};

export async function marketingOverview(
  actor: Actor,
): Promise<Result<MarketingOverview, MarketingError>> {
  if (!canManage(actor)) return err(forbidden());
  const db = getDb();
  const [campaigns, promos, bundles] = await Promise.all([
    repo.campaigns(db),
    repo.promos(db),
    repo.bundles(db),
  ]);
  const iso = <T extends { createdAt: Date }>(r: T) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  });
  return ok({
    campaigns: campaigns.map(iso),
    promos: promos.map(iso),
    bundles: bundles.map(iso),
  });
}
