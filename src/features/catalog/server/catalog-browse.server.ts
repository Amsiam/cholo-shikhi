// The catalog read module for S3 and S4 (UC5, UC6; LC-201). Only published items of the Student's
// current Goal are listed (BR11.1), pinned first, then newest, 20 per page with a signed keyset
// cursor (BR11.5; PD-203, SD-205). S4 answers a published course, and anything else exactly like a
// missing ID (BR4.4; SD-204). Visibility lives in the queries (PD-201), so hidden content is refused
// on the very next request (NFR6.218). No transaction, lock or cache (PD-205, PD-206).
import type { Actor } from '#src/features/identity-access/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import {
  type BrowseRepository,
  CATALOG_PAGE_SIZE,
  type CardPosition,
  type CardRow,
  createBrowseRepository,
  type ExamCardPosition,
} from '../data/browse.repository.ts';
import { CATALOG_FLAGS } from '../domain/catalog-flags.ts';
import { notFound } from '../domain/course.ts';
import type { CursorCodec } from '../domain/cursor.ts';
import { badCursor } from '../domain/cursor.ts';
import { LessonDocumentSchema } from '../domain/lesson-document.ts';
import {
  type CatalogServedTab,
  COURSE_SEARCH_PAGE_SIZE,
  CoursePageInput,
  ListCatalogInput,
  SearchCoursesInput,
} from './catalog-browse.schema.ts';
import type {
  CatalogCard,
  CatalogPage,
  CourseCard,
  CoursePage,
  CourseSearchPage,
  PublishedLesson,
} from './catalog-browse.types.ts';
import type { CatalogKernel } from './catalog-kernel.ts';

export type { CatalogCard, CatalogPage, CoursePage };

/** What the read module needs beyond the kernel; wired once in catalog-instance.server.ts. */
export type BrowseDeps = {
  /** Contract 5 getCurrentGoal: NOT_FOUND when the Student has not chosen a Goal (BR2.1). */
  currentGoal(
    userId: string,
  ): Promise<Result<{ goalId: string; segmentId: string }, AppError<'NOT_FOUND'>>>;
  /** Contract 5: an active Goal by ID for the catalog finder; NOT_FOUND for any other status. */
  activeGoal(
    goalId: string,
  ): Promise<
    Result<
      { goalId: string; segmentId: string; nameBn: string; nameEn: string },
      AppError<'NOT_FOUND'>
    >
  >;
  /**
   * BR11.4: the trial course named by trial.policy for a segment. The unit that declares
   * trial.policy supplies it; until then no segment has a trial course.
   */
  trialCourseOf(segmentId: string): Promise<string | null>;
  /** Contract 3: instructor display names for S4, one batched read (PD-204). */
  displayNamesOf(userIds: readonly string[]): Promise<Record<string, string>>;
  /** The signed paging cursor (SD-205) with the keys from the secrets store (LC-213). */
  cursor: CursorCodec;
};

const filterOf = (goalId: string, tab: CatalogServedTab) => `${goalId}|${tab}`;

function toCard(row: CardRow): CatalogCard {
  return {
    kind: 'course',
    courseId: row.courseId,
    titleBn: row.titleBn,
    titleEn: row.titleEn,
    listPricePoisha: row.listPricePoisha,
    accessDurationMonths: row.accessDurationMonths,
    isPinned: row.pinRank !== null,
  };
}

function positionOf(sortKeys: ReadonlyArray<string | number | null>, lastId: string) {
  const [pinRank, firstPublishedAt] = sortKeys;
  const isValid =
    (pinRank === null || (typeof pinRank === 'number' && Number.isInteger(pinRank))) &&
    typeof firstPublishedAt === 'string' &&
    Id.safeParse(lastId).success;
  return isValid ? ({ pinRank, firstPublishedAt, courseId: lastId } as CardPosition) : null;
}

export function createBrowseService(
  kernel: CatalogKernel,
  deps: BrowseDeps,
  browse: BrowseRepository = createBrowseRepository(),
) {
  const db = kernel.deps.db;
  const log = kernel.deps.log;

  async function courseCards(goalId: string, tab: CatalogServedTab, cursor: string | undefined) {
    let after: CardPosition | null = null;
    if (cursor) {
      const decoded = deps.cursor.decode(cursor, filterOf(goalId, tab));
      if (!decoded.ok) return decoded;
      after = positionOf(decoded.value.sortKeys, decoded.value.lastId);
      if (!after) return err(badCursor());
    }
    const rows = await browse.listCourseCards(db, goalId, after);
    const page = rows.slice(0, CATALOG_PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor =
      rows.length > CATALOG_PAGE_SIZE && last
        ? deps.cursor.encode(
            { sortKeys: [last.pinRank, last.firstPublishedAt], lastId: last.courseId },
            filterOf(goalId, tab),
          )
        : null;
    return ok({ items: page.map(toCard), nextCursor });
  }

  /** BR11.1: one Exam packages page, in the course order, with the same signed cursor (SD-205). */
  async function examCards(goalId: string, cursor: string | undefined) {
    const filter = filterOf(goalId, 'exam_packages');
    let after: ExamCardPosition | null = null;
    if (cursor) {
      const decoded = deps.cursor.decode(cursor, filter);
      if (!decoded.ok) return decoded;
      const position = positionOf(decoded.value.sortKeys, decoded.value.lastId);
      if (!position) return err(badCursor());
      after = {
        pinRank: position.pinRank,
        firstPublishedAt: position.firstPublishedAt,
        examPackageId: position.courseId,
      };
    }
    const rows = await browse.listExamCards(db, goalId, after);
    const page = rows.slice(0, CATALOG_PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor =
      rows.length > CATALOG_PAGE_SIZE && last
        ? deps.cursor.encode(
            { sortKeys: [last.pinRank, last.firstPublishedAt], lastId: last.examPackageId },
            filter,
          )
        : null;
    const items: CatalogCard[] = page.map((row) => ({
      kind: 'exam_package',
      examPackageId: row.examPackageId,
      titleBn: row.titleBn,
      titleEn: row.titleEn,
      listPricePoisha: row.listPricePoisha,
      isPinned: row.pinRank !== null,
    }));
    return ok({ items, nextCursor });
  }

  /** BR11.2: the Goal's published plans as cards, priced per month by the current version. */
  async function planCards(goalId: string): Promise<CatalogCard[]> {
    const rows = await browse.listPlanCards(db, goalId);
    return rows.map((row) => ({
      kind: 'plan',
      planId: row.planId,
      nameBn: row.nameBn,
      nameEn: row.nameEn,
      monthlyPricePoisha: row.monthlyPricePoisha,
      isPinned: row.pinRank !== null,
    }));
  }

  /** BR11.4: the segment's trial course, only if published and its Goal is in that segment. */
  async function trialCards(segmentId: string): Promise<CatalogCard[]> {
    const trialCourseId = await deps.trialCourseOf(segmentId);
    if (!trialCourseId || !Id.safeParse(trialCourseId).success) return [];
    const row = await browse.getVisibleCourse(db, trialCourseId);
    if (!row) return [];
    if (row.goalSegmentId !== segmentId) {
      log.warn(
        { event: 'catalog.trial_course_wrong_segment', segmentId, courseId: row.courseId },
        'trial course is in another segment',
      );
      return [];
    }
    return [
      {
        kind: 'course',
        courseId: row.courseId,
        titleBn: row.titleBn,
        titleEn: row.titleEn,
        listPricePoisha: row.listPricePoisha,
        accessDurationMonths: row.accessDurationMonths,
        isPinned: false,
      },
    ];
  }

  /** UC5: one S3 tab page for the caller's current Goal. */
  async function listCatalog(
    actor: Actor,
    raw: ListCatalogInput,
  ): Promise<Result<CatalogPage, AppError>> {
    const input = ListCatalogInput.parse(raw);
    const current = await deps.currentGoal(actor.userId);
    if (!current.ok) return current;
    return pageFor(current.value, input, actor.userId);
  }

  /**
   * The catalog course finder: a Goal's published courses, optionally filtered by title, one numbered
   * page at a time. Only an active Goal is served (anyone may call it: the catalog is public), through
   * the same published-only predicate as S3.
   */
  async function searchCourses(
    raw: SearchCoursesInput,
  ): Promise<Result<CourseSearchPage, AppError<'NOT_FOUND'>>> {
    const input = SearchCoursesInput.parse(raw);
    const goal = await deps.activeGoal(input.goalId);
    if (!goal.ok) return goal;
    const query = input.query ? input.query : null;
    const { rows, total } = await browse.searchCourseCards(db, {
      goalId: goal.value.goalId,
      query,
      limit: COURSE_SEARCH_PAGE_SIZE,
      offset: (input.page - 1) * COURSE_SEARCH_PAGE_SIZE,
    });
    return ok({
      goal: { goalId: goal.value.goalId, nameBn: goal.value.nameBn, nameEn: goal.value.nameEn },
      query,
      items: rows.map((row) => toCard(row) as CourseCard),
      total,
      page: input.page,
      pageSize: COURSE_SEARCH_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / COURSE_SEARCH_PAGE_SIZE)),
    });
  }

  async function pageFor(
    goal: { goalId: string; segmentId: string },
    input: { tab: CatalogServedTab; cursor?: string | undefined },
    flagUserId: string | null,
  ): Promise<Result<CatalogPage, AppError>> {
    const { goalId, segmentId } = goal;
    const isFirstPage = !input.cursor;
    const [hasCourses, hasExamPackages, plans, trial, isBundlesTabEnabled] = await Promise.all([
      browse.hasCourses(db, goalId),
      browse.hasExamPackages(db, goalId),
      isFirstPage ? planCards(goalId) : Promise.resolve([]),
      input.tab === 'free_trial' || isFirstPage ? trialCards(segmentId) : Promise.resolve([]),
      flagUserId === null
        ? Promise.resolve(false)
        : kernel.deps.isFlagEnabled(CATALOG_FLAGS.bundlesTab, flagUserId),
    ]);
    const tabsWithItems: CatalogServedTab[] = [
      ...(hasCourses || plans.length > 0 ? (['courses'] as const) : []),
      ...(hasExamPackages ? (['exam_packages'] as const) : []),
      ...(trial.length > 0 ? (['free_trial'] as const) : []),
    ];

    let items: CatalogCard[] = [];
    let nextCursor: string | null = null;
    if (input.tab === 'courses') {
      // BR11.2: plan cards head the first page of the Courses tab; course pages follow.
      const cards = await courseCards(goalId, input.tab, input.cursor);
      if (!cards.ok) return cards;
      items = [...plans, ...cards.value.items];
      nextCursor = cards.value.nextCursor;
    } else if (input.tab === 'exam_packages') {
      const cards = await examCards(goalId, input.cursor);
      if (!cards.ok) return cards;
      ({ items, nextCursor } = cards.value);
    } else if (input.tab === 'free_trial') {
      if (input.cursor) return err(badCursor());
      items = trial;
    } else if (input.cursor) {
      return err(badCursor());
    }
    return ok({
      goal: { goalId, segmentId },
      tab: input.tab,
      items,
      nextCursor,
      tabsWithItems,
      isBundlesTabEnabled,
    });
  }

  /** UC6: S4 for a published course; any other status answers like a missing ID (BR4.4, SD-204). */
  async function getCoursePage(
    actor: Actor | null,
    raw: CoursePageInput,
  ): Promise<Result<CoursePage, AppError<'NOT_FOUND'>>> {
    const input = CoursePageInput.parse(raw);
    // An anonymous visitor (the public course page) has no current Goal.
    const [row, current] = await Promise.all([
      browse.getVisibleCourse(db, input.courseId),
      actor ? deps.currentGoal(actor.userId) : Promise.resolve(err(notFound())),
    ]);
    if (!row) return err(notFound());
    const outlineRows = await browse.outline(db, row.courseId);

    const outline: CoursePage['outline'] = [];
    for (const r of outlineRows) {
      let entry = outline.at(-1);
      if (!entry || entry.sectionId !== r.sectionId) {
        entry = {
          sectionId: r.sectionId,
          titleBn: r.sectionTitleBn,
          titleEn: r.sectionTitleEn,
          lessons: [],
        };
        outline.push(entry);
      }
      if (r.lessonId && r.lessonKind)
        entry.lessons.push({
          lessonId: r.lessonId,
          kind: r.lessonKind,
          titleBn: r.lessonTitleBn,
          titleEn: r.lessonTitleEn,
          streakBonusDays: r.lessonStreakBonusDays,
        });
    }

    const periods = await kernel.repos.ownership.openForSections(
      db,
      outline.map((x) => x.sectionId),
    );
    const ownerOf = new Map(periods.map((p) => [p.sectionId, p.instructorId]));
    const leadId = row.leadInstructorId;
    const order = [...(leadId ? [leadId] : [])];
    for (const x of outline) {
      const owner = ownerOf.get(x.sectionId);
      if (owner && !order.includes(owner)) order.push(owner);
    }
    const names = await deps.displayNamesOf(order);
    const instructors = order.map((instructorId) => ({
      instructorId,
      role: instructorId === leadId ? ('lead' as const) : ('co_instructor' as const),
      displayName: names[instructorId] ?? '',
      sections: outline
        .filter((x) => ownerOf.get(x.sectionId) === instructorId)
        .map(({ sectionId, titleBn, titleEn }) => ({ sectionId, titleBn, titleEn })),
    }));

    return ok({
      courseId: row.courseId,
      goal: { goalId: row.goalId, nameBn: row.goalNameBn, nameEn: row.goalNameEn },
      isCurrentGoal: current.ok && current.value.goalId === row.goalId,
      titleBn: row.titleBn,
      titleEn: row.titleEn,
      descriptionBn: row.descriptionBn,
      descriptionEn: row.descriptionEn,
      listPricePoisha: row.listPricePoisha,
      accessDurationMonths: row.accessDurationMonths,
      hasCoverImage: row.coverImageKey !== null,
      instructors,
      outline,
      // BR11.8: the course is published (checked above), so only the pack's own status matters.
      practicePacks: await browse.listPublishedPacks(db, row.courseId),
    });
  }

  /**
   * The player read for one lesson of a published course (the caller has checked the enrolment).
   * The body is re-validated against the lesson-document schema, so a stored body that no longer
   * parses is served as no body rather than passed to the renderer.
   */
  async function getPublishedLesson(
    courseId: string,
    lessonId: string,
  ): Promise<Result<PublishedLesson, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(courseId).success || !Id.safeParse(lessonId).success) return err(notFound());
    const row = await browse.liveLesson(db, courseId, lessonId);
    if (!row) return err(notFound());
    const parse = (body: unknown) => {
      if (body === null || body === undefined) return null;
      const parsed = LessonDocumentSchema.safeParse(body);
      return parsed.success ? parsed.data : null;
    };
    return ok({
      lessonId: row.lessonId,
      lessonVersionId: row.lessonVersionId,
      sectionId: row.sectionId,
      kind: row.kind,
      titleBn: row.titleBn,
      titleEn: row.titleEn,
      bodyBn: parse(row.bodyBn),
      bodyEn: parse(row.bodyEn),
      youtubeVideoId: row.youtubeVideoId,
      streakBonusDays: row.streakBonusDays,
    });
  }

  return { listCatalog, searchCourses, getCoursePage, getPublishedLesson };
}

export type BrowseService = ReturnType<typeof createBrowseService>;
