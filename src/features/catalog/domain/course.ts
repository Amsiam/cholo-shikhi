// Course roles, Lead-only and owner-only decisions, the course state machine and version tokens
// (rules.md BR3.1, BR4.1–BR4.8, BR6.1, BR6.2, BR6.8, BR6.9, BR12.1; functional-spec §3.1).
// Plain TypeScript: no framework, DB or env access. Every expected failure is a typed Result.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

// ------------------------------------------------------------------ errors (rules.md mapping)

export function notFound(): AppError<'NOT_FOUND'> {
  return { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' };
}

export function notLead(): AppError<'FORBIDDEN'> {
  return { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' };
}

export function notSectionOwner(): AppError<'FORBIDDEN'> {
  return { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' };
}

export function staleVersion(currentVersion: number): AppError<'CONFLICT'> {
  return { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion', details: { currentVersion } };
}

export type CatalogStateKey =
  | 'durationLocked'
  | 'courseNotEditable'
  | 'underTakedown'
  | 'sectionRemovalPending'
  | 'sectionRemoved'
  | 'sectionNotPendingRemoval'
  | 'lastSection'
  | 'sectionHasNoOwner'
  | 'durationNotSet'
  | 'invalidTransition'
  | 'workingCopyReadOnly'
  | 'nothingToPublish'
  | 'courseNotPublished';

export function invalidState(key: CatalogStateKey): AppError<'INVALID_STATE'> {
  return { code: 'INVALID_STATE', i18nKey: `errors.catalog.${key}` };
}

export function isTrialCourse(): AppError<'CONFLICT'> {
  return { code: 'CONFLICT', i18nKey: 'errors.catalog.isTrialCourse' };
}

export function validationFailed(
  fieldErrors: Record<string, readonly string[]>,
): AppError<'VALIDATION_FAILED'> {
  return { code: 'VALIDATION_FAILED', i18nKey: 'errors.common.VALIDATION_FAILED', fieldErrors };
}

// ------------------------------------------------------------------ titles (BR3.1)

export const TITLE_MAX = 150;

export type Titles = { titleBn: string; titleEn: string };

/** BR3.1: both languages are required after trimming; each is at most 150 characters. */
export function validateTitles(
  input: Titles,
  fieldPrefix = '',
): Result<Titles, AppError<'VALIDATION_FAILED'>> {
  const trimmed = { titleBn: input.titleBn.trim(), titleEn: input.titleEn.trim() };
  const fieldErrors: Record<string, string[]> = {};
  for (const key of ['titleBn', 'titleEn'] as const) {
    if (trimmed[key].length === 0)
      fieldErrors[`${fieldPrefix}${key}`] = ['errors.catalog.titleRequired'];
    else if (trimmed[key].length > TITLE_MAX)
      fieldErrors[`${fieldPrefix}${key}`] = ['errors.catalog.titleTooLong'];
  }
  return Object.keys(fieldErrors).length > 0 ? err(validationFailed(fieldErrors)) : ok(trimmed);
}

// ------------------------------------------------------------------ roles (BR6.1, BR6.2, BR6.8, BR6.9)

export type CourseRole = 'lead' | 'co_instructor' | 'admin';
export type CourseActor = { userId: string; isAdmin: boolean };

/**
 * BR6.1: the Lead is leadInstructorId; a Co-instructor is anyone else who owns a section now (an
 * open period of a section that is not removed); an Admin otherwise; anyone else has no role.
 */
export function deriveCourseRole(
  course: { leadInstructorId: string | null; openOwnerIds: readonly string[] },
  actor: CourseActor,
): CourseRole | null {
  if (course.leadInstructorId !== null && course.leadInstructorId === actor.userId) return 'lead';
  if (course.openOwnerIds.includes(actor.userId)) return 'co_instructor';
  return actor.isAdmin ? 'admin' : null;
}

/** BR6.1, BR4.4: course staff and Admins read a course in I1; everyone else gets not-found. */
export function decideCourseRead(
  role: CourseRole | null,
): Result<CourseRole, AppError<'NOT_FOUND'>> {
  return role === null ? err(notFound()) : ok(role);
}

/** True when the caller may use the Lead-only controls (BR6.9): the Lead, or any Admin. */
export function canManageCourse(role: CourseRole | null, actor: CourseActor): boolean {
  return role === 'lead' || actor.isAdmin;
}

/** BR6.2, BR6.9: Lead-only actions. A Co-instructor gets notLead; an outsider gets not-found. */
export function decideLeadAction(
  role: CourseRole | null,
  actor: CourseActor,
): Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>> {
  if (canManageCourse(role, actor)) return ok(undefined);
  return role === 'co_instructor' ? err(notLead()) : err(notFound());
}

/** BR6.8: only the section's current owner (or an Admin) edits its content. */
export function decideSectionEdit(
  role: CourseRole | null,
  actor: CourseActor,
  currentOwnerId: string | null,
): Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>> {
  if (actor.isAdmin || (currentOwnerId !== null && currentOwnerId === actor.userId)) {
    return ok(undefined);
  }
  return role === null ? err(notFound()) : err(notSectionOwner());
}

// ------------------------------------------------------------------ version tokens (BR12.1)

/** BR12.1: a write based on a stale version is refused and changes nothing. */
export function checkVersion(
  stored: number,
  expected: number | undefined,
): Result<void, AppError<'CONFLICT'>> {
  return expected === stored ? ok(undefined) : err(staleVersion(stored));
}

// ------------------------------------------------------------------ course state machine (§3.1)

export type CourseStatus = 'draft' | 'published' | 'unpublished' | 'hidden' | 'retired';
export type HideableStatus = 'published' | 'unpublished' | 'retired';
export type CourseEvent = 'publish' | 'unpublish' | 'retire' | 'hide' | 'restore';

const TRANSITIONS: Readonly<Record<CourseEvent, Partial<Record<CourseStatus, CourseStatus>>>> = {
  publish: { draft: 'published', published: 'published', unpublished: 'published' },
  unpublish: { published: 'unpublished' },
  retire: { published: 'retired', unpublished: 'retired' },
  hide: { published: 'hidden', unpublished: 'hidden', retired: 'hidden' },
  restore: {},
};

/**
 * BR4.3, BR4.8, BR12.5: the next course status for an event, or a refusal. `restore` returns the
 * status the course had before it was hidden. A course named as a trial course cannot be
 * unpublished or retired (BR4.8).
 */
export function transitionCourse(
  status: CourseStatus,
  event: CourseEvent,
  context: { isTrialCourse?: boolean; statusBeforeHidden?: HideableStatus | null } = {},
): Result<CourseStatus, AppError<'INVALID_STATE' | 'CONFLICT'>> {
  if (event === 'restore') {
    if (status === 'hidden' && context.statusBeforeHidden) return ok(context.statusBeforeHidden);
    return err(invalidState('invalidTransition'));
  }
  const next = TRANSITIONS[event][status];
  if (!next) return err(invalidState('invalidTransition'));
  if ((event === 'unpublish' || event === 'retire') && context.isTrialCourse) {
    return err(isTrialCourse());
  }
  return ok(next);
}

/**
 * NFR6.219, SD-221: hidden content (a takedown) accepts no U2 write from anyone, staff included,
 * and the refusal names the takedown. Checked before every other state rule.
 */
export function checkNotUnderTakedown(
  ...hiddenFlags: ReadonlyArray<boolean>
): Result<void, AppError<'INVALID_STATE'>> {
  return hiddenFlags.some(Boolean) ? err(invalidState('underTakedown')) : ok(undefined);
}

/** BR8.10–BR8.12, BR5.5: retired and hidden courses accept no structure or field change. */
export function checkCourseEditable(status: CourseStatus): Result<void, AppError<'INVALID_STATE'>> {
  return status === 'retired' || status === 'hidden'
    ? err(invalidState('courseNotEditable'))
    : ok(undefined);
}

/** BR5.7: a locked access duration is read-only. */
export function checkDurationEditable(
  durationLockedAt: string | null,
): Result<void, AppError<'INVALID_STATE'>> {
  return durationLockedAt === null ? ok(undefined) : err(invalidState('durationLocked'));
}

/**
 * BR5.6 (CR-4): what lockAccessDuration does. NOT_FOUND for no course; INVALID_STATE when the
 * duration is unset; otherwise the stored lock time, or `now` when this call sets it.
 */
export function decideDurationLock(
  course: { accessDurationMonths: number | null; durationLockedAt: string | null } | undefined,
  now: string,
): Result<
  { accessDurationMonths: number; lockedAt: string; isNewLock: boolean },
  AppError<'NOT_FOUND' | 'INVALID_STATE'>
> {
  if (!course) return err(notFound());
  if (course.accessDurationMonths === null) return err(invalidState('durationNotSet'));
  return ok({
    accessDurationMonths: course.accessDurationMonths,
    lockedAt: course.durationLockedAt ?? now,
    isNewLock: course.durationLockedAt === null,
  });
}
