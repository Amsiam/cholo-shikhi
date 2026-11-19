// Browse reads for S3 and S4 (UC5, UC6; PD-201–PD-206, SD-204). Visibility is part of every query,
// written once in browseVisible(): a course is visible while its status is published (a course
// takedown sets status hidden); sections and lessons also need no takedown marker and must be live.
// There is no load-then-filter step, so a hidden, unpublished, retired or draft row and a missing
// row take the same path and come back as "no row". Every read is bounded (SC-209) and runs without
// a transaction or lock (PD-206); there is no shared cache (PD-205).
import { and, asc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  course,
  examPackage,
  goal,
  lesson,
  lessonVersion,
  practicePack,
  section,
  sectionVersion,
  subscriptionPlan,
  subscriptionPlanVersion,
} from '#src/server/schema/index.ts';

/** S3 page size (BR11.5); one extra row tells whether another page exists (PD-203). */
export const CATALOG_PAGE_SIZE = 20;
/** Upper bound on the sections and lessons read for one S4 outline (SC-209). */
export const OUTLINE_ROW_LIMIT = 2000;

/** The one place the course browse predicate is written (PD-201). */
export function browseVisible() {
  return eq(course.status, 'published');
}

/** The keyset position of a card: (pin rank or null, first publish as exact text, course ID). */
export type CardPosition = { pinRank: number | null; firstPublishedAt: string; courseId: string };

export type CardRow = CardPosition & {
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
  accessDurationMonths: number;
};

export type VisibleCourseRow = {
  courseId: string;
  goalId: string;
  goalSegmentId: string;
  goalNameBn: string;
  goalNameEn: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  coverImageKey: string | null;
  listPricePoisha: number;
  accessDurationMonths: number;
  leadInstructorId: string | null;
};

export type LiveLessonRow = {
  lessonId: string;
  lessonVersionId: string;
  sectionId: string;
  kind: 'video' | 'text' | 'quiz';
  titleBn: string | null;
  titleEn: string | null;
  bodyBn: unknown;
  bodyEn: unknown;
  youtubeVideoId: string | null;
  streakBonusDays: number | null;
};

export type OutlineRow = {
  sectionId: string;
  sectionPosition: number;
  sectionTitleBn: string;
  sectionTitleEn: string;
  lessonId: string | null;
  lessonKind: 'video' | 'text' | 'quiz' | null;
  lessonPosition: number | null;
  lessonTitleBn: string | null;
  lessonTitleEn: string | null;
  /** US4.13: the streak a streak-only bonus quiz needs, else null. */
  lessonStreakBonusDays: number | null;
};

const cardColumns = {
  courseId: course.courseId,
  pinRank: course.pinRank,
  // Exact microsecond text, so the keyset never skips or repeats a row (a JS Date keeps ms only).
  firstPublishedAt: sql<string>`${course.firstPublishedAt}::text`,
  titleBn: course.titleBn,
  titleEn: course.titleEn,
  listPricePoisha: course.listPricePoisha,
  accessDurationMonths: course.accessDurationMonths,
};

/** Rows strictly after `after` in the order pinned (rank ascending) first, newest, then ID (BR11.5). */
function afterPosition(after: CardPosition) {
  const sameTimeLaterId = sql`(${course.firstPublishedAt} < ${after.firstPublishedAt}::timestamptz
    OR (${course.firstPublishedAt} = ${after.firstPublishedAt}::timestamptz AND ${course.courseId} > ${after.courseId}))`;
  if (after.pinRank === null) return sql`(${course.pinRank} IS NULL AND ${sameTimeLaterId})`;
  return sql`(${course.pinRank} IS NULL OR ${course.pinRank} > ${after.pinRank}
    OR (${course.pinRank} = ${after.pinRank} AND ${sameTimeLaterId}))`;
}

/** The keyset position of an exam package card, in the same order as courses (BR11.5). */
export type ExamCardPosition = {
  pinRank: number | null;
  firstPublishedAt: string;
  examPackageId: string;
};

export type ExamCardRow = ExamCardPosition & {
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
};

export type PlanCardRow = {
  planId: string;
  pinRank: number | null;
  nameBn: string;
  nameEn: string;
  monthlyPricePoisha: number;
};

/** BR11.2: at most this many plan cards head the Courses tab (SC-209). */
export const PLAN_CARD_LIMIT = 20;

function afterExamPosition(after: ExamCardPosition) {
  const sameTimeLaterId = sql`(${examPackage.firstPublishedAt} < ${after.firstPublishedAt}::timestamptz
    OR (${examPackage.firstPublishedAt} = ${after.firstPublishedAt}::timestamptz AND ${examPackage.examPackageId} > ${after.examPackageId}))`;
  if (after.pinRank === null) return sql`(${examPackage.pinRank} IS NULL AND ${sameTimeLaterId})`;
  return sql`(${examPackage.pinRank} IS NULL OR ${examPackage.pinRank} > ${after.pinRank}
    OR (${examPackage.pinRank} = ${after.pinRank} AND ${sameTimeLaterId}))`;
}

export function createBrowseRepository() {
  return {
    /** One S3 page of a Goal's published exam packages, plus one row for the next page (BR11.1). */
    async listExamCards(
      exec: Executor,
      goalId: string,
      after: ExamCardPosition | null,
    ): Promise<ExamCardRow[]> {
      const rows = await exec
        .select({
          examPackageId: examPackage.examPackageId,
          pinRank: examPackage.pinRank,
          firstPublishedAt: sql<string>`${examPackage.firstPublishedAt}::text`,
          titleBn: examPackage.titleBn,
          titleEn: examPackage.titleEn,
          listPricePoisha: examPackage.listPricePoisha,
        })
        .from(examPackage)
        .where(
          and(
            eq(examPackage.goalId, goalId),
            eq(examPackage.status, 'published'),
            after ? afterExamPosition(after) : undefined,
          ),
        )
        .orderBy(
          sql`${examPackage.pinRank} ASC NULLS LAST`,
          sql`${examPackage.firstPublishedAt} DESC`,
          asc(examPackage.examPackageId),
        )
        .limit(CATALOG_PAGE_SIZE + 1);
      return rows as ExamCardRow[];
    },

    async hasExamPackages(exec: Executor, goalId: string): Promise<boolean> {
      const rows = await exec
        .select({ id: examPackage.examPackageId })
        .from(examPackage)
        .where(and(eq(examPackage.goalId, goalId), eq(examPackage.status, 'published')))
        .limit(1);
      return rows.length > 0;
    },

    /**
     * BR11.2: the Goal's published plans, pinned first then newest, with the monthly price of the
     * current version (never the draft price).
     */
    async listPlanCards(exec: Executor, goalId: string): Promise<PlanCardRow[]> {
      const rows = await exec
        .select({
          planId: subscriptionPlan.planId,
          pinRank: subscriptionPlan.pinRank,
          nameBn: subscriptionPlan.nameBn,
          nameEn: subscriptionPlan.nameEn,
          monthlyPricePoisha: subscriptionPlanVersion.monthlyPricePoisha,
        })
        .from(subscriptionPlan)
        .innerJoin(
          subscriptionPlanVersion,
          eq(subscriptionPlanVersion.planVersionId, subscriptionPlan.currentVersionId),
        )
        .where(and(eq(subscriptionPlan.goalId, goalId), eq(subscriptionPlan.status, 'published')))
        .orderBy(
          sql`${subscriptionPlan.pinRank} ASC NULLS LAST`,
          sql`${subscriptionPlan.firstPublishedAt} DESC`,
          asc(subscriptionPlan.planId),
        )
        .limit(PLAN_CARD_LIMIT);
      return rows;
    },

    /** BR11.8: the published Practice Packs of a course; the caller has checked the course. */
    async listPublishedPacks(exec: Executor, courseId: string) {
      return exec
        .select({
          practicePackId: practicePack.practicePackId,
          titleBn: practicePack.titleBn,
          titleEn: practicePack.titleEn,
          listPricePoisha: practicePack.listPricePoisha,
        })
        .from(practicePack)
        .where(and(eq(practicePack.courseId, courseId), eq(practicePack.status, 'published')))
        .orderBy(asc(practicePack.firstPublishedAt), asc(practicePack.practicePackId))
        .limit(CATALOG_PAGE_SIZE);
    },

    /** One S3 page of a Goal's published courses, plus one row to detect the next page (PD-203). */
    async listCourseCards(
      exec: Executor,
      goalId: string,
      after: CardPosition | null,
    ): Promise<CardRow[]> {
      const rows = await exec
        .select(cardColumns)
        .from(course)
        .where(
          and(eq(course.goalId, goalId), browseVisible(), after ? afterPosition(after) : undefined),
        )
        .orderBy(
          sql`${course.pinRank} ASC NULLS LAST`,
          sql`${course.firstPublishedAt} DESC`,
          asc(course.courseId),
        )
        .limit(CATALOG_PAGE_SIZE + 1);
      return rows as CardRow[];
    },

    /**
     * The catalog course finder: one numbered page of a Goal's published courses, optionally
     * filtered by a title search in either language, with the total for the page links. Same
     * visibility and order as the S3 list; the search text is matched literally (LIKE wildcards
     * escaped) and the page is bounded by the caller's limit.
     */
    async searchCourseCards(
      exec: Executor,
      input: { goalId: string; query: string | null; limit: number; offset: number },
    ): Promise<{ rows: CardRow[]; total: number }> {
      const pattern = input.query ? `%${input.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const where = and(
        eq(course.goalId, input.goalId),
        browseVisible(),
        pattern ? or(ilike(course.titleBn, pattern), ilike(course.titleEn, pattern)) : undefined,
      );
      const [rows, counted] = await Promise.all([
        exec
          .select(cardColumns)
          .from(course)
          .where(where)
          .orderBy(
            sql`${course.pinRank} ASC NULLS LAST`,
            sql`${course.firstPublishedAt} DESC`,
            asc(course.courseId),
          )
          .limit(input.limit)
          .offset(input.offset),
        exec.select({ total: sql<number>`count(*)::int` }).from(course).where(where),
      ]);
      return { rows: rows as CardRow[], total: counted[0]?.total ?? 0 };
    },

    /**
     * One live lesson of a published course, for an enrolled Student's player: the lesson must sit
     * in a live, not-removed, not-taken-down section of that course, under the section's live
     * version, and be live itself. Any other lesson answers "no row" (same path as missing).
     */
    async liveLesson(
      exec: Executor,
      courseId: string,
      lessonId: string,
    ): Promise<LiveLessonRow | null> {
      const rows = await exec
        .select({
          lessonId: lesson.lessonId,
          lessonVersionId: lessonVersion.lessonVersionId,
          sectionId: section.sectionId,
          kind: lesson.kind,
          titleBn: lessonVersion.titleBn,
          titleEn: lessonVersion.titleEn,
          bodyBn: lessonVersion.bodyBn,
          bodyEn: lessonVersion.bodyEn,
          youtubeVideoId: lessonVersion.youtubeVideoId,
          streakBonusDays: lessonVersion.streakBonusDays,
        })
        .from(lesson)
        .innerJoin(section, eq(section.sectionId, lesson.sectionId))
        .innerJoin(course, eq(course.courseId, section.courseId))
        .innerJoin(
          lessonVersion,
          and(
            eq(lessonVersion.lessonId, lesson.lessonId),
            eq(lessonVersion.sectionVersionId, section.liveVersionId),
          ),
        )
        .where(
          and(
            eq(lesson.lessonId, lessonId),
            eq(section.courseId, courseId),
            browseVisible(),
            eq(lesson.liveState, 'live'),
            isNull(lesson.hiddenByTakedownNoticeId),
            ne(section.structureState, 'removed'),
            isNull(section.hiddenByTakedownNoticeId),
          ),
        )
        .limit(1);
      return (rows[0] as LiveLessonRow | undefined) ?? null;
    },

    /** The available-tab probe (BR11.6): does the Goal have any published course? */
    async hasCourses(exec: Executor, goalId: string): Promise<boolean> {
      const rows = await exec
        .select({ courseId: course.courseId })
        .from(course)
        .where(and(eq(course.goalId, goalId), browseVisible()))
        .limit(1);
      return rows.length > 0;
    },

    /** S4 header: the course with its Goal, only while visible (SD-204: one path for missing). */
    async getVisibleCourse(
      exec: Executor,
      courseId: string,
    ): Promise<VisibleCourseRow | undefined> {
      const [row] = await exec
        .select({
          courseId: course.courseId,
          goalId: course.goalId,
          goalSegmentId: goal.segmentId,
          goalNameBn: goal.nameBn,
          goalNameEn: goal.nameEn,
          titleBn: course.titleBn,
          titleEn: course.titleEn,
          descriptionBn: course.descriptionBn,
          descriptionEn: course.descriptionEn,
          coverImageKey: course.coverImageKey,
          listPricePoisha: course.listPricePoisha,
          accessDurationMonths: course.accessDurationMonths,
          leadInstructorId: course.leadInstructorId,
        })
        .from(course)
        .innerJoin(goal, eq(goal.goalId, course.goalId))
        .where(and(eq(course.courseId, courseId), browseVisible()))
        .limit(1);
      return row as VisibleCourseRow | undefined;
    },

    /**
     * The S4 outline as one query (PD-204): live, not-removed, not-hidden sections in order, with the
     * live titles of their live, not-hidden lessons (BR7.5: titles and kinds only, never content).
     */
    async outline(exec: Executor, courseId: string): Promise<OutlineRow[]> {
      const rows = await exec
        .select({
          sectionId: section.sectionId,
          sectionPosition: section.position,
          sectionTitleBn: sectionVersion.titleBn,
          sectionTitleEn: sectionVersion.titleEn,
          lessonId: lesson.lessonId,
          lessonKind: lesson.kind,
          lessonPosition: lessonVersion.position,
          lessonTitleBn: lessonVersion.titleBn,
          lessonTitleEn: lessonVersion.titleEn,
          lessonStreakBonusDays: lessonVersion.streakBonusDays,
        })
        .from(section)
        .innerJoin(sectionVersion, eq(sectionVersion.sectionVersionId, section.liveVersionId))
        .leftJoin(lessonVersion, eq(lessonVersion.sectionVersionId, section.liveVersionId))
        .leftJoin(
          lesson,
          and(
            eq(lesson.lessonId, lessonVersion.lessonId),
            eq(lesson.liveState, 'live'),
            isNull(lesson.hiddenByTakedownNoticeId),
          ),
        )
        .where(
          and(
            eq(section.courseId, courseId),
            ne(section.structureState, 'removed'),
            isNull(section.hiddenByTakedownNoticeId),
          ),
        )
        .orderBy(asc(section.position), asc(lessonVersion.position))
        .limit(OUTLINE_ROW_LIMIT);
      return rows as OutlineRow[];
    },
  };
}

export type BrowseRepository = ReturnType<typeof createBrowseRepository>;
