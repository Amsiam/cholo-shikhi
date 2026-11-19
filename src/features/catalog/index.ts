// Contract 5 (Catalog part) public surface. Other units import only from here.
// Server-only, in-process functions: none of them is a server function or an HTTP route (NFR6.201).
// Route and UI code calls the server functions in ./server/*.functions.ts instead.
// Bolt 2 adds the additive CR-4 and CR-7 exports; Bolt 3 adds setLessonMedia (with the CR-8
// captionLanguages input), the CR-8 setQuizContentStatus and the takedown hideContent and
// restoreContent; Bolt 4 adds the contract 5 reads (getProductTerms, getLessonPlacement,
// listPiecesPublished, getOwnershipSnapshot, listInstructorCourses, canScheduleLive,
// assertSectionOwner); Bolt 5 adds the product terms, getExamPackage and the CR-8 question-check
// port. CR-5 / CR-6 are not approved, so ProductTerms keeps the current shape.
import type { Actor } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import type { Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import type { CoursePage, PublishedLesson } from './server/catalog-browse.types.ts';
import type {
  ExamPackageRead,
  LessonPlacement,
  OwnershipSnapshot,
  ProductRef,
  ProductTerms,
} from './server/catalog-contract.server.ts';
import { getCatalog } from './server/catalog-instance.server.ts';

export type { ExamPackageRead, LessonPlacement, OwnershipSnapshot, ProductRef, ProductTerms };

/**
 * CR-4 (BR5.6): called by U3 Commerce inside the first enrolment's transaction. Takes the course row
 * lock, sets the duration lock once and returns the locked duration. Idempotent.
 */
export async function lockAccessDuration(
  tx: TxHandle,
  courseId: string,
): Promise<
  Result<
    { accessDurationMonths: number; lockedAt: string },
    AppError<'NOT_FOUND' | 'INVALID_STATE'>
  >
> {
  return getCatalog().lockAccessDuration(tx, courseId);
}

/** CR-7 (BR6.9): the course's Lead or an Admin passes; a Co-instructor gets FORBIDDEN notLead. */
export async function assertCourseLead(
  actor: Actor,
  courseId: string,
): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
  return getCatalog().assertCourseLead(actor, courseId);
}

/**
 * Contract 5 (CR-8 adds captionLanguages): ContentDelivery only, in its own transaction. Binds a new
 * asset to a draft working copy, and keeps the asset's media status and caption languages current
 * on the working and live versions without a new version or review (BR7.6).
 */
export async function setLessonMedia(
  tx: TxHandle,
  input: {
    lessonId: string;
    videoAssetId: string;
    mediaStatus: 'processing' | 'ready' | 'failed';
    captionLanguages?: Array<'bn' | 'en'>;
  },
): Promise<Result<void, AppError<'NOT_FOUND' | 'INVALID_STATE'>>> {
  return getCatalog().setLessonMedia(tx, input);
}

/** CR-8 (BR7.7): Assessment only, in its own transaction: a quiz lesson's question count. */
export async function setQuizContentStatus(
  tx: TxHandle,
  input: { lessonId: string; questionCount: number },
): Promise<Result<void, AppError<'NOT_FOUND' | 'INVALID_STATE'>>> {
  return getCatalog().setQuizContentStatus(tx, input);
}

type ContentRef = { type: 'course' | 'section' | 'lesson'; id: string };

/**
 * Contract 5 (U11 TrustOps only, in its own transaction): hides a course, section or lesson under a
 * takedown notice. Hidden content is refused to everyone and accepts no U2 write (BR12.5, NFR6.219).
 * Repeating the same notice is a no-op; another notice on hidden content is INVALID_STATE.
 */
export async function hideContent(
  tx: TxHandle,
  input: { contentRef: ContentRef; takedownNoticeId: string },
): Promise<Result<void, AppError<'NOT_FOUND' | 'INVALID_STATE'>>> {
  return getCatalog().hideContent(tx, input);
}

/** Contract 5 (U11 only): restores hidden content; only the notice that hid it can restore it. */
export async function restoreContent(
  tx: TxHandle,
  input: { contentRef: ContentRef; takedownNoticeId: string },
): Promise<Result<void, AppError<'NOT_FOUND' | 'INVALID_STATE'>>> {
  return getCatalog().restoreContent(tx, input);
}

/**
 * Contract 5 (BR13.1): the terms other units sell and grant by, for courses, exam packages, Practice
 * Packs and plans. NOT_FOUND for an unknown product or an unpriced draft. A product unpublished
 * behind the catalog.unpublish flag (CR-5 fallback) reports `retired`; a Practice Pack reports
 * `hidden` while its course is hidden. CR-6 is not approved: no versionId or parentCourseId yet.
 */
export async function getProductTerms(
  product: ProductRef,
): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
  return getCatalog().getProductTerms(product);
}

/**
 * Contract 5 (BR13.7, CR-6 fallback): an exam package's ID, Goal and status. The unpublished draft
 * fields are never returned.
 */
export async function getExamPackage(
  examPackageId: string,
): Promise<Result<ExamPackageRead, AppError<'NOT_FOUND'>>> {
  return getCatalog().getExamPackage(examPackageId);
}

/**
 * Contract 5 (BR13.2), for U4 content access. status is exactly one of: hidden (refused to everyone),
 * withdrawn (no new viewing, progress kept), never_published (course staff only) or live (serve to
 * entitled viewers). An unpublished or retired course leaves its live lessons live (BR4.5).
 */
export async function getLessonPlacement(
  lessonId: string,
): Promise<Result<LessonPlacement, AppError<'NOT_FOUND'>>> {
  return getCatalog().getLessonPlacement(lessonId);
}

/** Contract 5 (BR13.3), for U9 Payouts: first publications in the half-open period, owner at that instant. */
export async function listPiecesPublished(
  instructorId: string,
  period: { start: string; end: string },
): Promise<Array<{ lessonId: string; firstPublishedAt: string }>> {
  return getCatalog().listPiecesPublished(instructorId, period);
}

/** Contract 5 (BR6.7): each section's owner at an instant, for Payouts attribution. */
export async function getOwnershipSnapshot(
  courseId: string,
  at: string,
): Promise<Result<OwnershipSnapshot, AppError<'NOT_FOUND'>>> {
  return getCatalog().getOwnershipSnapshot(courseId, at);
}

/** US7.13: the course's sections at an instant, owned or not, for Payouts attribution money. */
export async function getSectionsAt(courseId: string, at: string): Promise<string[]> {
  return getCatalog().getSectionsAt(courseId, at);
}

/** Titles, status and Lead of some courses, by ID (statistics and finance views). */
export async function courseTitlesOf(courseIds: readonly string[]): Promise<
  Record<
    string,
    {
      courseId: string;
      titleBn: string;
      titleEn: string;
      status: string;
      leadInstructorId: string | null;
    }
  >
> {
  return getCatalog().courseTitlesOf(courseIds);
}

/** Contract 5 (BR13.4): the instructor's current course roles; a malformed cursor is thrown. */
export async function listInstructorCourses(
  instructorId: string,
  page: { cursor?: string; limit: number },
): Promise<{
  items: Array<{ courseId: string; role: 'lead' | 'co_instructor' }>;
  nextCursor?: string;
}> {
  return getCatalog().listInstructorCourses(instructorId, page);
}

/** Contract 5 (BR13.8), for U8 LiveClass. */
export async function canScheduleLive(
  actor: Actor,
  courseId: string,
): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
  return getCatalog().canScheduleLive(actor, courseId);
}

/** Contract 5: the section's current owner or an Admin (uploads, questions, quizzes). */
export async function assertSectionOwner(
  actor: Actor,
  sectionId: string,
): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
  return getCatalog().assertSectionOwner(actor, sectionId);
}

export type {
  QuestionCheckInput,
  QuestionCheckOutcome,
  QuestionReferenceCheck,
} from './domain/products.ts';
/**
 * CR-8 (BR10.4): Assessment registers its question-reference check once at start-up; a second call
 * throws. Until it is registered, exam packages and Practice Packs save as drafts but cannot publish
 * (INVALID_STATE errors.catalog.questionCheckUnavailable).
 */
/**
 * The learning area's course read: the published course's header, instructors and outline (the
 * same read as S4, with no actor). NOT_FOUND for anything not published. The caller (the learning
 * feature) has already checked the Student's enrolment.
 */
export async function getPublishedCourse(
  courseId: string,
): Promise<Result<CoursePage, AppError<'NOT_FOUND'>>> {
  if (!Id.safeParse(courseId).success) return { ok: false, error: appError('NOT_FOUND') };
  return getCatalog().getCoursePage(null, { courseId });
}

/** The learning area's lesson read: one live lesson of a published course, or NOT_FOUND. */
export async function getPublishedLesson(
  courseId: string,
  lessonId: string,
): Promise<Result<PublishedLesson, AppError<'NOT_FOUND'>>> {
  return getCatalog().getPublishedLesson(courseId, lessonId);
}

export type { LessonDocument } from './domain/lesson-document.ts';
export { parseYoutubeVideoId } from './domain/lesson-media.ts';
export {
  type ExamPackageContent,
  examPackageContent,
  type ProductDetails,
  productDetails,
  publishedPackContents,
} from './server/catalog-sales.server.ts';
export { registerQuestionReferenceCheck } from './server/question-check.server.ts';
export type { CoursePage, PublishedLesson };
