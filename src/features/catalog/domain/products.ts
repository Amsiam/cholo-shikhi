// Exam packages, subscription plans and Practice Packs (functional-spec §3.5–§3.7; rules.md BR10.1–
// BR10.11, BR11.11). Plain TypeScript: no framework, DB or env access. Every expected failure is a
// typed Result. Prices are checked in pricing.ts; this module owns states, contents and versions.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { type CourseRole, invalidState, notFound, notLead, validationFailed } from './course.ts';

export const PRODUCT_STATUSES = ['draft', 'published', 'unpublished', 'retired'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type ProductEvent = 'publish' | 'unpublish' | 'retire';

/** Upper bounds from entities.md. */
export const MAX_EXAM_QUESTIONS = 500;
export const MAX_PACK_QUESTION_SETS = 50;
export const MAX_PLAN_ITEMS = 500;
export const TIME_LIMIT_RANGE = { min: 1, max: 600 } as const;
export const PLAN_NAME_MAX = 100;

// ------------------------------------------------------------------ state machine (§3.5–§3.7)

const TRANSITIONS: Readonly<Record<ProductEvent, readonly ProductStatus[]>> = {
  // draft → published (version 1); published → published (next version); unpublished → published.
  publish: ['draft', 'published', 'unpublished'],
  unpublish: ['published'],
  retire: ['published', 'unpublished'],
};
const TARGET: Readonly<Record<ProductEvent, ProductStatus>> = {
  publish: 'published',
  unpublish: 'unpublished',
  retire: 'retired',
};

/** The one state machine of exam packages, plans and Practice Packs; retired is terminal. */
export function transitionProduct(
  from: ProductStatus,
  event: ProductEvent,
): Result<ProductStatus, AppError<'INVALID_STATE'>> {
  return TRANSITIONS[event].includes(from)
    ? ok(TARGET[event])
    : err(invalidState('invalidTransition'));
}

/** A retired product accepts no edit; every other state saves to the draft fields (BR10.3). */
export function checkProductEditable(
  status: ProductStatus,
): Result<void, AppError<'INVALID_STATE'>> {
  return status === 'retired' ? err(invalidState('invalidTransition')) : ok(undefined);
}

/**
 * BR10.3 / BR10.6: whether a publish creates the next immutable version. A first publish and a
 * publish of saved draft changes do; republishing an unpublished product with no change reuses the
 * current version, so past buyers and new buyers keep exactly the same contents.
 */
export function needsNewVersion(product: {
  currentVersionId: string | null;
  hasUnpublishedChanges: boolean;
}): boolean {
  return product.currentVersionId === null || product.hasUnpublishedChanges;
}

/** BR10.3 / BR10.6: version numbers start at 1 and grow by one. */
export function nextVersionNumber(latest: number | null): number {
  return (latest ?? 0) + 1;
}

/**
 * BR10.3: a draft edit of a product that has a current version marks unpublished changes when the
 * versioned contents differ; titles and the list price are not versioned and apply at once.
 */
export function marksUnpublishedChanges(
  status: ProductStatus,
  before: readonly unknown[],
  after: readonly unknown[],
): boolean {
  if (status === 'draft') return false;
  return JSON.stringify(before) !== JSON.stringify(after);
}

// ------------------------------------------------------------------ names (BR3.1)

export type PlanNames = { nameBn: string; nameEn: string };

/** BR3.1 for plans: both names are required after trimming; each is at most 100 characters. */
export function validatePlanNames(
  input: PlanNames,
): Result<PlanNames, AppError<'VALIDATION_FAILED'>> {
  const trimmed = { nameBn: input.nameBn.trim(), nameEn: input.nameEn.trim() };
  const fieldErrors: Record<string, string[]> = {};
  for (const key of ['nameBn', 'nameEn'] as const) {
    if (trimmed[key].length === 0) fieldErrors[key] = ['errors.catalog.titleRequired'];
    else if (trimmed[key].length > PLAN_NAME_MAX)
      fieldErrors[key] = ['errors.catalog.titleTooLong'];
  }
  return Object.keys(fieldErrors).length > 0 ? err(validationFailed(fieldErrors)) : ok(trimmed);
}

/** Ordered, no duplicates (entities.md): a repeated ID is refused rather than dropped. */
export function checkDistinctIds(
  ids: readonly string[],
  field: string,
): Result<string[], AppError<'VALIDATION_FAILED'>> {
  return new Set(ids).size === ids.length
    ? ok([...ids])
    : err(validationFailed({ [field]: ['errors.catalog.duplicateIds'] }));
}

// ------------------------------------------------------------------ exam package publish (BR10.2)

export type ExamPackageDraft = {
  titleBn: string;
  titleEn: string;
  goalId: string | null;
  listPricePoisha: number | null;
  draftQuestionIds: readonly string[];
  draftTimeLimitMinutes: number | null;
};

/** BR10.2: at least one question and a time limit of 1 to 600 minutes, titles, a Goal, a price. */
export function checkExamPackagePublish(
  draft: ExamPackageDraft,
): Result<{ questionIds: string[]; timeLimitMinutes: number }, AppError<'VALIDATION_FAILED'>> {
  const fieldErrors: Record<string, string[]> = {};
  if (draft.draftQuestionIds.length === 0)
    fieldErrors.questionIds = ['errors.catalog.examPackageIncomplete'];
  const limit = draft.draftTimeLimitMinutes;
  if (limit === null || limit < TIME_LIMIT_RANGE.min || limit > TIME_LIMIT_RANGE.max)
    fieldErrors.timeLimitMinutes = ['errors.catalog.examPackageIncomplete'];
  if (draft.titleBn.trim() === '') fieldErrors.titleBn = ['errors.catalog.titleRequired'];
  if (draft.titleEn.trim() === '') fieldErrors.titleEn = ['errors.catalog.titleRequired'];
  if (draft.goalId === null) fieldErrors.goalId = ['errors.catalog.goalRequired'];
  if (draft.listPricePoisha === null) fieldErrors.price = ['errors.catalog.priceRequired'];
  if (Object.keys(fieldErrors).length > 0) {
    const isIncomplete = 'questionIds' in fieldErrors || 'timeLimitMinutes' in fieldErrors;
    return err({
      ...validationFailed(fieldErrors),
      ...(isIncomplete ? { i18nKey: 'errors.catalog.examPackageIncomplete' } : {}),
    });
  }
  return ok({ questionIds: [...draft.draftQuestionIds], timeLimitMinutes: limit as number });
}

// ------------------------------------------------------------------ plan contents (BR10.1, BR10.5)

export type PlanItemRef = { type: 'course' | 'exam_package'; id: string };
export type PlanItemFacts = PlanItemRef & { goalId: string; status: string };

/**
 * BR10.1 / BR10.5. On save (`requirePublished` false): at least one item, every item known and of
 * the plan's Goal. At publish (`requirePublished` true) every item must also be published now.
 * A refused item is named in details.itemIds.
 */
export function checkPlanItems(
  planGoalId: string,
  requested: readonly PlanItemRef[],
  known: readonly PlanItemFacts[],
  requirePublished: boolean,
): Result<PlanItemRef[], AppError<'VALIDATION_FAILED'>> {
  if (requested.length === 0)
    return err(validationFailed({ items: ['errors.catalog.planNoItems'] }));
  const byKey = new Map(known.map((k) => [`${k.type}:${k.id}`, k]));
  const refused = requested.filter((item) => {
    const facts = byKey.get(`${item.type}:${item.id}`);
    if (!facts || facts.goalId !== planGoalId) return true;
    return requirePublished && facts.status !== 'published';
  });
  if (refused.length > 0) {
    return err({
      ...validationFailed({ items: ['errors.catalog.planItemNotEligible'] }),
      details: { itemIds: refused.map((r) => r.id).join(',') },
    });
  }
  return ok([...requested]);
}

/** BR10.8: an item in a published plan's current version cannot be unpublished or retired. */
export function checkNotInCurrentPlan(
  planIds: readonly string[],
): Result<void, AppError<'CONFLICT'>> {
  if (planIds.length === 0) return ok(undefined);
  return err({
    code: 'CONFLICT',
    i18nKey: 'errors.catalog.inCurrentPlan',
    details: { planIds: [...planIds].sort().join(',') },
  });
}

// ------------------------------------------------------------------ Practice Packs (BR10.9)

/**
 * BR10.9: only the course's Lead authors a pack, and only on a published course. A Co-instructor
 * is told notLead; anyone else is answered like a missing course (BR4.4).
 */
export function decidePackAuthoring(
  role: CourseRole | null,
  courseStatus: string,
): Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_STATE'>> {
  if (role === 'co_instructor') return err(notLead());
  if (role !== 'lead') return err(notFound());
  if (courseStatus !== 'published') return err(invalidState('courseNotPublished'));
  return ok(undefined);
}

// ------------------------------------------------------------------ question references (BR10.4, CR-8)

export type QuestionCheckInput = {
  questionIds?: string[];
  questionSetIds?: string[];
  courseId?: string;
};
export type QuestionCheckOutcome = { valid: true } | { valid: false; unknownIds: string[] };
export type QuestionReferenceCheck = (input: QuestionCheckInput) => Promise<QuestionCheckOutcome>;

/**
 * BR10.4: not registered → INVALID_STATE questionCheckUnavailable (the draft is kept); unknown or
 * untagged IDs → VALIDATION_FAILED on the field, listing them.
 */
export function decideQuestionCheck(
  outcome: QuestionCheckOutcome | 'unavailable',
  field: 'questionIds' | 'questionSetIds',
): Result<void, AppError<'INVALID_STATE' | 'VALIDATION_FAILED'>> {
  if (outcome === 'unavailable') {
    return err({ code: 'INVALID_STATE', i18nKey: 'errors.catalog.questionCheckUnavailable' });
  }
  if (outcome.valid) return ok(undefined);
  const key =
    field === 'questionIds'
      ? 'errors.catalog.unknownQuestions'
      : 'errors.catalog.unknownQuestionSets';
  return err({
    ...validationFailed({ [field]: [key] }),
    details: { unknownIds: outcome.unknownIds.join(',') },
  });
}
