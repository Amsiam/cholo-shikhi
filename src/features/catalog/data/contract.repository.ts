// Point reads behind the contract 5 functions (BR13.1–BR13.4, BR13.8, BR6.7; PD-206): each is one
// indexed query (two at most), with no transaction, lock or cache, so a takedown is visible on the
// very next call (NFR6.218). Every read is bounded (SC-209).
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { course, lesson, ownershipPeriod, section } from '#src/server/schema/index.ts';

/** Upper bound on the pieces one listPiecesPublished call returns (SC-209). */
export const MAX_PIECES = 5000;
/** Upper bound on the sections of one ownership snapshot (SC-209). */
export const MAX_SNAPSHOT_SECTIONS = 500;

export type PlacementRow = {
  lessonId: string;
  sectionId: string;
  courseId: string;
  liveState: 'never_published' | 'live' | 'withdrawn';
  isLessonHidden: boolean;
  isSectionHidden: boolean;
  courseStatus: string;
};

export type InstructorCourseRow = {
  courseId: string;
  createdAt: string;
  role: 'lead' | 'co_instructor';
};

export function createContractRepository() {
  return {
    async courseTerms(exec: Executor, courseId: string) {
      const [row] = await exec
        .select({
          courseId: course.courseId,
          goalId: course.goalId,
          listPricePoisha: course.listPricePoisha,
          accessDurationMonths: course.accessDurationMonths,
          status: course.status,
        })
        .from(course)
        .where(eq(course.courseId, courseId))
        .limit(1);
      return row;
    },

    /** One query: the lesson with its section and course markers (PD-206). */
    async placement(exec: Executor, lessonId: string): Promise<PlacementRow | undefined> {
      const [row] = await exec
        .select({
          lessonId: lesson.lessonId,
          sectionId: section.sectionId,
          courseId: course.courseId,
          liveState: lesson.liveState,
          isLessonHidden: sql<boolean>`${lesson.hiddenByTakedownNoticeId} IS NOT NULL`,
          isSectionHidden: sql<boolean>`${section.hiddenByTakedownNoticeId} IS NOT NULL`,
          courseStatus: course.status,
        })
        .from(lesson)
        .innerJoin(section, eq(section.sectionId, lesson.sectionId))
        .innerJoin(course, eq(course.courseId, section.courseId))
        .where(eq(lesson.lessonId, lessonId))
        .limit(1);
      return row as PlacementRow | undefined;
    },

    /** BR13.3: first publications in [start, end) of sections the instructor owned at that instant. */
    async piecesPublished(exec: Executor, instructorId: string, start: Date, end: Date) {
      return exec
        .select({ lessonId: lesson.lessonId, firstPublishedAt: lesson.firstPublishedAt })
        .from(lesson)
        .innerJoin(
          ownershipPeriod,
          and(
            eq(ownershipPeriod.sectionId, lesson.sectionId),
            lte(ownershipPeriod.validFrom, lesson.firstPublishedAt),
            or(
              isNull(ownershipPeriod.validTo),
              sql`${lesson.firstPublishedAt} < ${ownershipPeriod.validTo}`,
            ),
          ),
        )
        .where(
          and(
            eq(ownershipPeriod.instructorId, instructorId),
            gte(lesson.firstPublishedAt, start),
            lt(lesson.firstPublishedAt, end),
          ),
        )
        .orderBy(asc(lesson.firstPublishedAt), asc(lesson.lessonId))
        .limit(MAX_PIECES);
    },

    async courseExists(exec: Executor, courseId: string): Promise<boolean> {
      const rows = await exec
        .select({ courseId: course.courseId })
        .from(course)
        .where(eq(course.courseId, courseId))
        .limit(1);
      return rows.length > 0;
    },

    /** Titles and status of some courses (statistics and finance views). */
    async courseTitles(exec: Executor, courseIds: readonly string[]) {
      if (courseIds.length === 0) return [];
      return exec
        .select({
          courseId: course.courseId,
          titleBn: course.titleBn,
          titleEn: course.titleEn,
          status: course.status,
          leadInstructorId: course.leadInstructorId,
        })
        .from(course)
        .where(inArray(course.courseId, [...courseIds]));
    },

    /** US7.13: the sections existing and not removed at `at`, owned or not. */
    async sectionIdsAt(exec: Executor, courseId: string, at: Date): Promise<string[]> {
      const rows = await exec
        .select({ sectionId: section.sectionId })
        .from(section)
        .where(
          and(
            eq(section.courseId, courseId),
            lte(section.createdAt, at),
            or(isNull(section.removedAt), sql`${at} < ${section.removedAt}`),
          ),
        )
        .orderBy(asc(section.position), asc(section.sectionId))
        .limit(MAX_SNAPSHOT_SECTIONS);
      return rows.map((r) => r.sectionId);
    },

    /** BR6.7: for each section existing and not removed at `at`, the owner whose period holds it. */
    async ownershipAt(exec: Executor, courseId: string, at: Date) {
      return exec
        .select({ sectionId: section.sectionId, instructorId: ownershipPeriod.instructorId })
        .from(section)
        .innerJoin(
          ownershipPeriod,
          and(
            eq(ownershipPeriod.sectionId, section.sectionId),
            lte(ownershipPeriod.validFrom, at),
            or(isNull(ownershipPeriod.validTo), sql`${at} < ${ownershipPeriod.validTo}`),
          ),
        )
        .where(
          and(
            eq(section.courseId, courseId),
            lte(section.createdAt, at),
            or(isNull(section.removedAt), sql`${at} < ${section.removedAt}`),
          ),
        )
        .orderBy(asc(section.position), asc(section.sectionId))
        .limit(MAX_SNAPSHOT_SECTIONS);
    },

    /**
     * BR13.4: courses where the instructor is the Lead or holds an open period on a section that is
     * not removed, any status, newest created first; keyset after (createdAt text, courseId).
     */
    async instructorCourses(
      exec: Executor,
      instructorId: string,
      after: { createdAt: string; courseId: string } | null,
      limit: number,
    ): Promise<InstructorCourseRow[]> {
      const isCo = sql`EXISTS (SELECT 1 FROM ${section} JOIN ${ownershipPeriod}
          ON ${ownershipPeriod.sectionId} = ${section.sectionId}
        WHERE ${section.courseId} = ${course.courseId}
          AND ${section.structureState} <> 'removed'
          AND ${ownershipPeriod.validTo} IS NULL
          AND ${ownershipPeriod.instructorId} = ${instructorId})`;
      const rows = await exec
        .select({
          courseId: course.courseId,
          createdAt: sql<string>`${course.createdAt}::text`,
          isLead: sql<boolean>`${course.leadInstructorId} IS NOT DISTINCT FROM ${instructorId}::uuid`,
        })
        .from(course)
        .where(
          and(
            or(eq(course.leadInstructorId, instructorId), isCo),
            after
              ? sql`(${course.createdAt} < ${after.createdAt}::timestamptz OR (${course.createdAt} = ${after.createdAt}::timestamptz AND ${course.courseId} > ${after.courseId}))`
              : undefined,
          ),
        )
        .orderBy(desc(course.createdAt), asc(course.courseId))
        .limit(limit + 1);
      return rows.map((r) => ({
        courseId: r.courseId,
        createdAt: r.createdAt,
        role: r.isLead ? ('lead' as const) : ('co_instructor' as const),
      }));
    },

    /** The section with its course's Lead and status, and the section's open owner. */
    async sectionWithOwner(exec: Executor, sectionId: string) {
      const [row] = await exec
        .select({
          sectionId: section.sectionId,
          courseId: section.courseId,
          leadInstructorId: course.leadInstructorId,
          ownerId: ownershipPeriod.instructorId,
        })
        .from(section)
        .innerJoin(course, eq(course.courseId, section.courseId))
        .leftJoin(
          ownershipPeriod,
          and(eq(ownershipPeriod.sectionId, section.sectionId), isNull(ownershipPeriod.validTo)),
        )
        .where(eq(section.sectionId, sectionId))
        .limit(1);
      return row;
    },
  };
}

export type ContractRepository = ReturnType<typeof createContractRepository>;
