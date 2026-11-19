// Courses (entities.md Course). Writes are version-checked in the UPDATE itself (BR12.1) and run
// under the course row lock taken first in every multi-row write (fixed lock order course →
// section → section_version → lesson_version; PD-209, RD-206). Every read is bounded (SC-209).
import { and, count, desc, eq, exists, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { course, goal, ownershipPeriod, section } from '#src/server/schema/index.ts';

export type CourseRow = typeof course.$inferSelect;

/** A version-checked write either applies, finds the row gone, or finds a newer version. */
export type VersionedWrite<T> =
  | { kind: 'applied'; row: T }
  | { kind: 'missing' }
  | { kind: 'stale'; currentVersion: number };

/** Upper bound for an instructor's course list page (SC-209). */
export const MAX_PAGE_SIZE = 100;

export function createCourseRepository() {
  async function get(exec: Executor, courseId: string): Promise<CourseRow | undefined> {
    const [row] = await exec.select().from(course).where(eq(course.courseId, courseId)).limit(1);
    return row;
  }

  return {
    get,
    /** The first lock of every catalog write on a course (PD-209). */
    async getForUpdate(exec: Executor, courseId: string): Promise<CourseRow | undefined> {
      const [row] = await exec
        .select()
        .from(course)
        .where(eq(course.courseId, courseId))
        .limit(1)
        .for('update');
      return row;
    },
    /** A shared lock: section content edits may run side by side, a course write waits for them. */
    async getForShare(exec: Executor, courseId: string): Promise<CourseRow | undefined> {
      const [row] = await exec
        .select()
        .from(course)
        .where(eq(course.courseId, courseId))
        .limit(1)
        .for('share');
      return row;
    },
    async insert(exec: Executor, values: typeof course.$inferInsert): Promise<CourseRow> {
      const [row] = await exec.insert(course).values(values).returning();
      return row as CourseRow;
    },
    /** Applies a patch only when the stored version is the expected one, and bumps the version. */
    async update(
      exec: Executor,
      courseId: string,
      expectedVersion: number,
      patch: Partial<
        Pick<
          CourseRow,
          | 'leadInstructorId'
          | 'listPricePoisha'
          | 'accessDurationMonths'
          | 'durationLockedAt'
          | 'descriptionBn'
          | 'descriptionEn'
          | 'status'
          | 'statusBeforeHidden'
          | 'activeTakedownNoticeId'
          | 'firstPublishedAt'
          | 'lastPublishedAt'
          | 'unpublishedAt'
          | 'retiredAt'
          | 'pinRank'
        >
      >,
      at: Date,
    ): Promise<VersionedWrite<CourseRow>> {
      const [row] = await exec
        .update(course)
        .set({ ...patch, version: sql`${course.version} + 1`, updatedAt: at })
        .where(and(eq(course.courseId, courseId), eq(course.version, expectedVersion)))
        .returning();
      if (row) return { kind: 'applied', row };
      const current = await get(exec, courseId);
      return current ? { kind: 'stale', currentVersion: current.version } : { kind: 'missing' };
    },
    /** BR4.9: the status of a course, for the published-course reference validator. */
    async status(exec: Executor, courseId: string) {
      const [row] = await exec
        .select({ status: course.status })
        .from(course)
        .where(eq(course.courseId, courseId))
        .limit(1);
      return row?.status;
    },
    /** The goal a course is filed under, for BR1.9 / BR4.2 (Goals is the same unit, U2). */
    async goalStatus(exec: Executor, goalId: string) {
      const [row] = await exec
        .select({ status: goal.status })
        .from(goal)
        .where(eq(goal.goalId, goalId))
        .limit(1);
      return row;
    },
    /**
     * BR6.1, BR13.4: courses where the instructor is the Lead or owns a section that is not
     * removed now. Newest first, then by ID; offset-paged and bounded.
     */
    async listForInstructor(
      exec: Executor,
      instructorId: string,
      page: { limit: number; offset: number },
    ) {
      const ownsSection = exists(
        exec
          .select({ one: sql`1` })
          .from(ownershipPeriod)
          .innerJoin(section, eq(section.sectionId, ownershipPeriod.sectionId))
          .where(
            and(
              eq(section.courseId, course.courseId),
              eq(ownershipPeriod.instructorId, instructorId),
              isNull(ownershipPeriod.validTo),
              ne(section.structureState, 'removed'),
            ),
          ),
      );
      const where = or(eq(course.leadInstructorId, instructorId), ownsSection);
      const rows = await exec
        .select()
        .from(course)
        .where(where)
        .orderBy(desc(course.createdAt), course.courseId)
        .limit(Math.min(page.limit, MAX_PAGE_SIZE))
        .offset(page.offset);
      const [total] = await exec.select({ n: count() }).from(course).where(where);
      return { rows, total: total?.n ?? 0 };
    },
  };
}

export type CourseRepository = ReturnType<typeof createCourseRepository>;
