// Lessons in a section's working copy (rules.md BR3.2, BR7.1–BR7.4, BR7.6, BR7.7; functional-spec
// UC12, UC21, §3.3). Plain TypeScript: titles, kinds, completeness and the reorder plan. The server
// applies what this module decides inside one transaction.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { TITLE_MAX, validationFailed } from './course.ts';
import { isDocumentEmpty, type LessonDocument } from './lesson-document.ts';

export const LESSON_KINDS = ['video', 'text', 'quiz'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export type MediaStatus = 'none' | 'processing' | 'ready' | 'failed';
export type LessonLanguage = 'bn' | 'en';
/** A section version holds at most this many lessons (SC-209); far above any real section. */
export const MAX_LESSONS_PER_SECTION = 300;

/** BR3.2: a lesson title needs at least one language; each is at most 150 characters. */
export function validateLessonTitles(input: {
  titleBn: string;
  titleEn: string;
}): Result<{ titleBn: string | null; titleEn: string | null }, AppError<'VALIDATION_FAILED'>> {
  const bn = input.titleBn.trim();
  const en = input.titleEn.trim();
  if (bn.length === 0 && en.length === 0) {
    return err(validationFailed({ titleBn: ['errors.catalog.lessonTitleRequired'] }));
  }
  const fieldErrors: Record<string, string[]> = {};
  if (bn.length > TITLE_MAX) fieldErrors.titleBn = ['errors.catalog.titleTooLong'];
  if (en.length > TITLE_MAX) fieldErrors.titleEn = ['errors.catalog.titleTooLong'];
  if (Object.keys(fieldErrors).length > 0) return err(validationFailed(fieldErrors));
  return ok({ titleBn: bn || null, titleEn: en || null });
}

/** BR7.1: a text body is accepted only on a text lesson; the kind never changes. */
export function checkTextLesson(kind: LessonKind): Result<void, AppError<'VALIDATION_FAILED'>> {
  return kind === 'text'
    ? ok(undefined)
    : err(validationFailed({ body: ['errors.catalog.lessonKindMismatch'] }));
}

export function checkVideoLesson(kind: LessonKind): Result<void, AppError<'VALIDATION_FAILED'>> {
  return kind === 'video'
    ? ok(undefined)
    : err(validationFailed({ video: ['errors.catalog.lessonKindMismatch'] }));
}

export function checkQuizLesson(kind: LessonKind): Result<void, AppError<'VALIDATION_FAILED'>> {
  return kind === 'quiz'
    ? ok(undefined)
    : err(validationFailed({ questions: ['errors.catalog.lessonKindMismatch'] }));
}

export type LessonContent = {
  lessonId: string;
  kind: LessonKind;
  titleBn: string | null;
  titleEn: string | null;
  bodyBn: LessonDocument | null;
  bodyEn: LessonDocument | null;
  videoAssetId: string | null;
  mediaStatus: MediaStatus;
  /** A YouTube (unlisted) video; a video lesson with one is complete without an uploaded asset. */
  youtubeVideoId: string | null;
  quizQuestionCount: number;
};

const hasText = (value: string | null) => value !== null && value.trim().length > 0;
const hasBody = (doc: LessonDocument | null) => doc !== null && !isDocumentEmpty(doc);

/** BR7.3: a title in one language and the content its kind needs. */
export function isLessonComplete(lesson: LessonContent): boolean {
  if (!hasText(lesson.titleBn) && !hasText(lesson.titleEn)) return false;
  switch (lesson.kind) {
    case 'video':
      return (
        lesson.youtubeVideoId !== null ||
        (lesson.videoAssetId !== null && lesson.mediaStatus === 'ready')
      );
    case 'text':
      return hasBody(lesson.bodyBn) || hasBody(lesson.bodyEn);
    case 'quiz':
      return lesson.quizQuestionCount > 0;
  }
}

/**
 * BR7.3: a section is complete when it has at least one lesson and every lesson is complete
 * (both section titles are guaranteed by BR3.1 on every save). Refusals list the lesson IDs.
 */
export function checkSectionComplete(
  lessons: readonly LessonContent[],
): Result<void, AppError<'INVALID_STATE'>> {
  const incomplete = lessons.filter((l) => !isLessonComplete(l)).map((l) => l.lessonId);
  if (lessons.length > 0 && incomplete.length === 0) return ok(undefined);
  return err({
    code: 'INVALID_STATE',
    i18nKey: 'errors.catalog.incompleteLessons',
    details: { incompleteLessonIds: incomplete.join(','), lessonCount: lessons.length },
  });
}

/** BR7.2: a reorder must be a permutation of the working copy's lessons; positions become 1..n. */
export function planLessonReorder(
  currentIds: readonly string[],
  requested: readonly string[],
): Result<Array<{ lessonId: string; position: number }>, AppError<'VALIDATION_FAILED'>> {
  const current = new Set(currentIds);
  const isPermutation =
    requested.length === current.size &&
    new Set(requested).size === requested.length &&
    requested.every((id) => current.has(id));
  if (!isPermutation) {
    return err(validationFailed({ lessonIds: ['errors.catalog.reorderNotPermutation'] }));
  }
  return ok(requested.map((lessonId, index) => ({ lessonId, position: index + 1 })));
}

/** BR7.4: a lesson that was never live and is in no other version is deleted; else only unlinked. */
export function removalOf(lesson: {
  liveState: 'never_published' | 'live' | 'withdrawn';
  otherVersionCount: number;
}): 'delete' | 'unlink' {
  return lesson.liveState === 'never_published' && lesson.otherVersionCount === 0
    ? 'delete'
    : 'unlink';
}

/** Positions after removing one lesson: the rest keep their order, renumbered 1..n. */
export function renumberAfterRemoval(
  orderedIds: readonly string[],
  removedId: string,
): Array<{ lessonId: string; position: number }> {
  return orderedIds
    .filter((id) => id !== removedId)
    .map((lessonId, index) => ({ lessonId, position: index + 1 }));
}

export type TechnicalStatusTarget = {
  lessonVersionId: string;
  role: 'working' | 'live';
  reviewState: string;
  videoAssetId: string | null;
};

/**
 * BR7.6: what setLessonMedia writes. A new asset binds only to a draft working copy; the status
 * (and CR-8 caption languages) of the same asset is kept current on the working and live versions.
 * Superseded and discarded versions are never targets.
 */
export function planMediaPush(
  kind: LessonKind,
  targets: readonly TechnicalStatusTarget[],
  videoAssetId: string,
): Result<{ bindTo: string | null; statusOn: string[] }, AppError<'INVALID_STATE'>> {
  const invalid: AppError<'INVALID_STATE'> = {
    code: 'INVALID_STATE',
    i18nKey: 'errors.catalog.mediaNotAccepted',
  };
  if (kind !== 'video') return err(invalid);
  const working = targets.find((t) => t.role === 'working');
  let bindTo: string | null = null;
  if (working && working.videoAssetId !== videoAssetId) {
    if (working.reviewState !== 'draft') return err(invalid);
    bindTo = working.lessonVersionId;
  }
  const statusOn = targets
    .filter((t) => t.lessonVersionId === bindTo || t.videoAssetId === videoAssetId)
    .map((t) => t.lessonVersionId);
  if (statusOn.length === 0) return err(invalid);
  return ok({ bindTo, statusOn });
}
