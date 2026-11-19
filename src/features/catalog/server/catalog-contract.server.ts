// The contract 5 reads (UC25; BR13.1–BR13.4, BR13.8, BR6.7). In-process only, never a server function
// or route (NFR6.201). Point reads without a transaction or cache (PD-206).
//
// Contract changes CR-5 / CR-6 have no recorded approval, so their fallbacks apply: ProductTerms keeps
// the current contract shape (no versionId / parentCourseId) and the current status enum. A course
// is only `unpublished` while the catalog.unpublish flag (CR-5 fallback, default off) is on; such a
// course is reported as `retired`, which means the same to every consumer (no new sales, enrolled
// students keep access, BR4.5) until CR-5 adds the `unpublished` value.
import type { Actor } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { createContractRepository } from '../data/contract.repository.ts';
import { createProductRepository } from '../data/products.repository.ts';
import { decideSectionEdit, deriveCourseRole, notFound } from '../domain/course.ts';
import type { CursorCodec } from '../domain/cursor.ts';
import type { CatalogKernel } from './catalog-kernel.ts';

export type ProductRef =
  | { type: 'course'; id: string }
  | { type: 'exam_package'; id: string }
  | { type: 'practice_pack'; id: string }
  | { type: 'subscription_plan'; id: string };

export type ProductTerms = {
  product: ProductRef;
  goalId: string | null;
  listPrice: number;
  accessDurationMonths: number | null;
  status: 'draft' | 'published' | 'hidden' | 'retired';
  includedCourseIds: string[];
  includedExamPackageIds: string[];
};

export type LessonPlacement = {
  lessonId: string;
  sectionId: string;
  courseId: string;
  /** Exactly one of these four values (BR13.2); the contract types it as a string. */
  status: 'hidden' | 'withdrawn' | 'never_published' | 'live';
};

export type OwnershipSnapshot = {
  courseId: string;
  at: string;
  sections: Array<{ sectionId: string; instructorId: string }>;
};

/** BR13.7 under the CR-6 fallback: the current getExamPackage shape only. */
export type ExamPackageRead = {
  examPackageId: string;
  goalId: string;
  status: ProductTerms['status'];
};

type ProductRowStatus = 'draft' | 'published' | 'unpublished' | 'retired';
/** CR-5 fallback: an unpublished product is reported as retired (no new sales, buyers keep access). */
const contractStatus = (status: ProductRowStatus): ProductTerms['status'] =>
  status === 'unpublished' ? 'retired' : status;

const INSTRUCTOR_PAGE_MAX = 100;
const UtcInstant = (value: string) => {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
};

export function createContractReads(kernel: CatalogKernel, cursor: CursorCodec | undefined) {
  const db = kernel.deps.db;
  const repo = createContractRepository();
  const products = createProductRepository();

  /** BR13.1, course: NOT_FOUND for a draft with no price yet. */
  async function courseTerms(id: string): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
    const row = await repo.courseTerms(db, id);
    if (!row || row.listPricePoisha === null) return err(notFound());
    return ok({
      product: { type: 'course', id: row.courseId },
      goalId: row.goalId,
      listPrice: row.listPricePoisha,
      accessDurationMonths: row.accessDurationMonths,
      status: row.status === 'unpublished' ? 'retired' : row.status,
      includedCourseIds: [],
      includedExamPackageIds: [],
    });
  }

  /** BR13.1, exam package: never expires (FR2.7), so no access duration. */
  async function examTerms(id: string): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
    const row = await products.getExam(db, id);
    if (!row) return err(notFound());
    return ok({
      product: { type: 'exam_package', id: row.examPackageId },
      goalId: row.goalId,
      listPrice: row.listPricePoisha,
      accessDurationMonths: null,
      status: contractStatus(row.status),
      includedCourseIds: [],
      includedExamPackageIds: [],
    });
  }

  /** BR13.1, Practice Pack: its course's Goal; hidden while its course is hidden (BR10.10). */
  async function packTerms(id: string): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
    const pack = await products.getPack(db, id);
    if (!pack) return err(notFound());
    const course = await repo.courseTerms(db, pack.courseId);
    if (!course) return err(notFound());
    return ok({
      product: { type: 'practice_pack', id: pack.practicePackId },
      goalId: course.goalId,
      listPrice: pack.listPricePoisha,
      accessDurationMonths: null,
      status: course.status === 'hidden' ? 'hidden' : contractStatus(pack.status),
      includedCourseIds: [],
      includedExamPackageIds: [],
    });
  }

  /**
   * BR13.1, plan: once a version exists, the current version's monthly price and items; before the
   * first publish, the draft price and lists (NOT_FOUND while no price is set). One paid period.
   */
  async function planTerms(id: string): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
    const plan = await products.getPlan(db, id);
    if (!plan) return err(notFound());
    let listPrice = plan.draftMonthlyPricePoisha;
    let items = {
      courseIds: [...plan.draftCourseIds].sort(),
      examPackageIds: [...plan.draftExamPackageIds].sort(),
    };
    if (plan.currentVersionId) {
      const version = await products.getPlanVersion(db, plan.currentVersionId);
      if (!version) return err(notFound());
      listPrice = version.monthlyPricePoisha;
      items = await products.planVersionItems(db, version.planVersionId);
    }
    if (listPrice === null) return err(notFound());
    return ok({
      product: { type: 'subscription_plan', id: plan.planId },
      goalId: plan.goalId,
      listPrice,
      accessDurationMonths: 1,
      status: contractStatus(plan.status),
      includedCourseIds: items.courseIds,
      includedExamPackageIds: items.examPackageIds,
    });
  }

  /** BR13.1: the terms other units sell and grant by, for every product type. */
  async function getProductTerms(
    product: ProductRef,
  ): Promise<Result<ProductTerms, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(product.id).success) return err(notFound());
    switch (product.type) {
      case 'course':
        return courseTerms(product.id);
      case 'exam_package':
        return examTerms(product.id);
      case 'practice_pack':
        return packTerms(product.id);
      case 'subscription_plan':
        return planTerms(product.id);
      default:
        return err(notFound());
    }
  }

  /**
   * BR13.7 (CR-6 fallback): { examPackageId, goalId, status }. The draft fields are never returned;
   * currentVersionId, questionIds and timeLimitMinutes arrive only once CR-6 is approved.
   */
  async function getExamPackage(
    examPackageId: string,
  ): Promise<Result<ExamPackageRead, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(examPackageId).success) return err(notFound());
    const row = await products.getExam(db, examPackageId);
    if (!row) return err(notFound());
    return ok({
      examPackageId: row.examPackageId,
      goalId: row.goalId,
      status: contractStatus(row.status),
    });
  }

  /** BR13.2: hidden, then withdrawn, then never_published, else live (one query, PD-206). */
  async function getLessonPlacement(
    lessonId: string,
  ): Promise<Result<LessonPlacement, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(lessonId).success) return err(notFound());
    const row = await repo.placement(db, lessonId);
    if (!row) return err(notFound());
    const status: LessonPlacement['status'] =
      row.isLessonHidden || row.isSectionHidden || row.courseStatus === 'hidden'
        ? 'hidden'
        : row.liveState === 'withdrawn'
          ? 'withdrawn'
          : row.liveState === 'never_published'
            ? 'never_published'
            : 'live';
    return ok({ lessonId: row.lessonId, sectionId: row.sectionId, courseId: row.courseId, status });
  }

  /** BR13.3: each lesson once, at its first publication, for the owner at that instant. */
  async function listPiecesPublished(
    instructorId: string,
    period: { start: string; end: string },
  ): Promise<Array<{ lessonId: string; firstPublishedAt: string }>> {
    const start = UtcInstant(period.start);
    const end = UtcInstant(period.end);
    if (!Id.safeParse(instructorId).success || !start || !end || start >= end) return [];
    const rows = await repo.piecesPublished(db, instructorId, start, end);
    return rows.map((r) => ({
      lessonId: r.lessonId,
      firstPublishedAt: (r.firstPublishedAt as Date).toISOString(),
    }));
  }

  /** BR6.7: who owned each section at an instant. */
  async function getOwnershipSnapshot(
    courseId: string,
    at: string,
  ): Promise<Result<OwnershipSnapshot, AppError<'NOT_FOUND'>>> {
    const instant = UtcInstant(at);
    if (!Id.safeParse(courseId).success || !instant) return err(notFound());
    if (!(await repo.courseExists(db, courseId))) return err(notFound());
    const sections = await repo.ownershipAt(db, courseId, instant);
    return ok({ courseId, at: instant.toISOString(), sections });
  }

  /** US7.13: the course's sections at an instant, owned or not (empty if unknown). */
  async function getSectionsAt(courseId: string, at: string): Promise<string[]> {
    const instant = UtcInstant(at);
    if (!Id.safeParse(courseId).success || !instant) return [];
    return repo.sectionIdsAt(db, courseId, instant);
  }

  async function courseTitlesOf(courseIds: readonly string[]) {
    const valid = courseIds.filter((id) => Id.safeParse(id).success);
    const rows = await repo.courseTitles(db, valid);
    return Object.fromEntries(rows.map((r) => [r.courseId, r]));
  }

  /** BR13.4: current course roles, newest course first, opaque cursor; a bad cursor is thrown. */
  async function listInstructorCourses(
    instructorId: string,
    page: { cursor?: string; limit: number },
  ): Promise<{
    items: Array<{ courseId: string; role: 'lead' | 'co_instructor' }>;
    nextCursor?: string;
  }> {
    if (!cursor) throw new Error('catalog cursor is not wired');
    const limit = Math.min(INSTRUCTOR_PAGE_MAX, Math.max(1, Math.trunc(page.limit) || 1));
    if (!Id.safeParse(instructorId).success) return { items: [] };
    const filter = `instructorCourses|${instructorId}`;
    let after: { createdAt: string; courseId: string } | null = null;
    if (page.cursor !== undefined) {
      const decoded = cursor.decode(page.cursor, filter);
      const [createdAt] = decoded.ok ? decoded.value.sortKeys : [];
      if (!decoded.ok || typeof createdAt !== 'string')
        throw new Error('listInstructorCourses: malformed cursor (caller bug)');
      after = { createdAt, courseId: decoded.value.lastId };
    }
    const rows = await repo.instructorCourses(db, instructorId, after, limit);
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(({ courseId, role }) => ({ courseId, role })),
      ...(rows.length > limit && last
        ? {
            nextCursor: cursor.encode(
              { sortKeys: [last.createdAt], lastId: last.courseId },
              filter,
            ),
          }
        : {}),
    };
  }

  /** BR13.8: the Lead, a current Co-instructor or an Admin, on a published or unpublished course. */
  async function canScheduleLive(
    actor: Actor,
    courseId: string,
  ): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
    if (!Id.safeParse(courseId).success) return err(notFound());
    const loaded = await kernel.load(db, courseId, kernel.courseActor(actor), 'none');
    if (!loaded.ok) return loaded;
    if (loaded.value.role === null) return err(notFound());
    const { status } = loaded.value.course;
    return status === 'published' || status === 'unpublished'
      ? ok(undefined)
      : err(appError('FORBIDDEN'));
  }

  /** Contract 5: the section's current owner or an Admin (uploads, questions, quizzes; BR6.8). */
  async function assertSectionOwner(
    actor: Actor,
    sectionId: string,
  ): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
    if (!Id.safeParse(sectionId).success) return err(notFound());
    const row = await repo.sectionWithOwner(db, sectionId);
    if (!row) return err(notFound());
    const who = kernel.courseActor(actor);
    const loaded = await kernel.load(db, row.courseId, who, 'none');
    const role = loaded.ok
      ? loaded.value.role
      : deriveCourseRole({ leadInstructorId: row.leadInstructorId, openOwnerIds: [] }, who);
    return decideSectionEdit(role, who, row.ownerId ?? null);
  }

  return {
    getProductTerms,
    getExamPackage,
    getLessonPlacement,
    listPiecesPublished,
    getOwnershipSnapshot,
    getSectionsAt,
    courseTitlesOf,
    listInstructorCourses,
    canScheduleLive,
    assertSectionOwner,
  };
}
