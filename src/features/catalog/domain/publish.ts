// Publishing a course (rules.md BR9.1–BR9.7, BR8.12, BR4.3; security-design SD-212; functional-spec
// UC15). Plain TypeScript: which sections a publish changes, which block it, and the caption
// confirmation. The server re-reads every input under its row locks and applies the plan in one
// transaction (BR12.2), so nothing unseen is ever published.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { type CourseStatus, invalidState } from './course.ts';
import type { WorkingState } from './review.ts';

export type PublishField =
  | 'leadInstructor'
  | 'listPrice'
  | 'accessDuration'
  | 'description'
  | 'sections';

export type PublishCourseShape = {
  status: CourseStatus;
  leadInstructorId: string | null;
  listPricePoisha: number | null;
  accessDurationMonths: number | null;
  descriptionBn: string | null;
  descriptionEn: string | null;
};

export type PublishSectionShape = {
  sectionId: string;
  structureState: 'active' | 'removal_pending' | 'removed';
  isLive: boolean;
  isUnderTakedown: boolean;
  pendingPosition: number | null;
  position: number;
  /** The working copy, if any, and whether its lessons pass BR7.3. */
  working: { state: WorkingState; isComplete: boolean } | null;
};

export type PublishPlan = {
  isFirstPublish: boolean;
  /** Sections whose approved working copy becomes live. */
  publish: string[];
  /** Sections whose draft or in-review copy the Admin approves now (BR9.3). */
  adminApprove: string[];
  /** removal_pending sections removed by this publish (BR8.12). */
  remove: string[];
  /** Sections left as they are (still in draft or review on a republish, BR9.4). */
  leftOut: string[];
  /** The order of the remaining sections after the publish (BR9.4). */
  order: string[];
};

const hasText = (v: string | null) => v !== null && v.trim().length > 0;

/** BR9.2: the fields a first publish needs, each named when missing. */
export function missingPublishFields(
  course: PublishCourseShape,
  sections: readonly PublishSectionShape[],
): PublishField[] {
  const missing: PublishField[] = [];
  if (course.leadInstructorId === null) missing.push('leadInstructor');
  if (course.listPricePoisha === null) missing.push('listPrice');
  if (course.accessDurationMonths === null) missing.push('accessDuration');
  if (!hasText(course.descriptionBn) && !hasText(course.descriptionEn)) missing.push('description');
  if (!sections.some((s) => s.structureState !== 'removed')) missing.push('sections');
  return missing;
}

function preconditions(
  missing: readonly PublishField[],
  blockingSectionIds: readonly string[],
): AppError<'INVALID_STATE'> {
  const details: Record<string, string | boolean | number> = {};
  for (const field of missing) details[`missing.${field}`] = true;
  if (blockingSectionIds.length > 0) details.blockingSectionIds = blockingSectionIds.join(',');
  return { code: 'INVALID_STATE', i18nKey: 'errors.catalog.publishPreconditions', details };
}

/** The positions after a publish: pendingPosition order where set, else current order (BR9.4). */
function finalOrder(sections: readonly PublishSectionShape[], removed: ReadonlySet<string>) {
  return sections
    .filter((s) => s.structureState !== 'removed' && !removed.has(s.sectionId))
    .map((s) => ({ id: s.sectionId, key: s.pendingPosition ?? s.position, position: s.position }))
    .sort((a, b) => a.key - b.key || a.position - b.position)
    .map((s) => s.id);
}

/**
 * BR9.2–BR9.4, BR8.12, BR4.3: the publish plan, or the refusal. A Lead's first publish needs every
 * kept section approved; an Admin's publish approves every complete draft or in-review copy and is
 * refused naming any incomplete one (BR9.3). A republish publishes approved copies only and is
 * refused when nothing would change (nothingToPublish). Hidden or retired courses never publish.
 */
export function planPublish(
  course: PublishCourseShape,
  sections: readonly PublishSectionShape[],
  options: { isAdmin: boolean },
): Result<PublishPlan, AppError<'INVALID_STATE'>> {
  if (course.status === 'hidden') return err(invalidState('underTakedown'));
  if (course.status === 'retired') return err(invalidState('invalidTransition'));
  const isFirstPublish = course.status === 'draft';
  const kept = sections.filter((s) => s.structureState !== 'removed');
  const missing = missingPublishFields(course, sections);
  if (missing.length > 0) return err(preconditions(missing, []));

  const publish: string[] = [];
  const adminApprove: string[] = [];
  const leftOut: string[] = [];
  const blocking: string[] = [];
  const remove = kept.filter((s) => s.structureState === 'removal_pending').map((s) => s.sectionId);
  for (const section of kept) {
    if (section.structureState === 'removal_pending' || section.working === null) continue;
    const { state, isComplete } = section.working;
    if (state === 'approved') publish.push(section.sectionId);
    else if (options.isAdmin && isComplete) adminApprove.push(section.sectionId);
    else if (options.isAdmin || isFirstPublish) blocking.push(section.sectionId);
    else leftOut.push(section.sectionId);
  }
  if (blocking.length > 0) return err(preconditions([], blocking));
  const changing = [...publish, ...adminApprove];
  if (changing.some((id) => kept.find((s) => s.sectionId === id)?.isUnderTakedown)) {
    return err(invalidState('underTakedown'));
  }
  const hasPendingOrder = kept.some((s) => s.pendingPosition !== null);
  if (
    course.status === 'published' &&
    changing.length === 0 &&
    remove.length === 0 &&
    !hasPendingOrder
  ) {
    return err(invalidState('nothingToPublish'));
  }
  return ok({
    isFirstPublish,
    publish,
    adminApprove,
    remove,
    leftOut,
    order: finalOrder(sections, new Set(remove)),
  });
}

/**
 * BR9.5: when video lessons being published have no caption track, the request must acknowledge
 * exactly those lessons. Captions never block a confirmed publish.
 */
export function checkCaptionsConfirmed(
  missing: readonly string[],
  acknowledged: readonly string[],
): Result<void, AppError<'INVALID_STATE'>> {
  const want = new Set(missing);
  const got = new Set(acknowledged);
  const isExact = want.size === got.size && [...want].every((id) => got.has(id));
  if (want.size === 0 || isExact) return ok(undefined);
  return err({
    code: 'INVALID_STATE',
    i18nKey: 'errors.catalog.captionsNotConfirmed',
    details: { lessonIds: [...want].join(','), count: want.size },
  });
}
