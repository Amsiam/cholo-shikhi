// Sections and their versions (entities.md Section, SectionVersion, LessonVersion). Row locks follow
// the fixed order course → section (by ID) → section_version (by ID) → lesson_version (PD-209,
// RD-206): the caller holds the course lock before calling the *ForUpdate reads here.
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  lessonVersion,
  quizQuestion,
  section,
  sectionReview,
  sectionVersion,
} from '#src/server/schema/index.ts';

export type SectionRow = typeof section.$inferSelect;
export type SectionVersionRow = typeof sectionVersion.$inferSelect;

/** A course has at most this many sections in any read (SC-209); far above any real course. */
export const MAX_SECTIONS_READ = 500;

export function createSectionRepository() {
  return {
    /** Every section of the course, locked in ID order, returned in position order. */
    async listForCourse(
      exec: Executor,
      courseId: string,
      options: { forUpdate?: boolean } = {},
    ): Promise<SectionRow[]> {
      const query = exec
        .select()
        .from(section)
        .where(eq(section.courseId, courseId))
        .orderBy(asc(section.sectionId))
        .limit(MAX_SECTIONS_READ);
      const rows = options.forUpdate ? await query.for('update') : await query;
      return [...rows].sort((a, b) => a.position - b.position);
    },
    async getForUpdate(
      exec: Executor,
      courseId: string,
      sectionId: string,
    ): Promise<SectionRow | undefined> {
      const [row] = await exec
        .select()
        .from(section)
        .where(and(eq(section.sectionId, sectionId), eq(section.courseId, courseId)))
        .limit(1)
        .for('update');
      return row;
    },
    /** The course a section belongs to (a takedown arrives with the section ID only). */
    async courseIdOf(exec: Executor, sectionId: string): Promise<string | undefined> {
      const [row] = await exec
        .select({ courseId: section.courseId })
        .from(section)
        .where(eq(section.sectionId, sectionId))
        .limit(1);
      return row?.courseId;
    },
    async insert(exec: Executor, values: typeof section.$inferInsert): Promise<SectionRow> {
      const [row] = await exec.insert(section).values(values).returning();
      return row as SectionRow;
    },
    async update(
      exec: Executor,
      sectionId: string,
      patch: Partial<
        Pick<
          SectionRow,
          | 'position'
          | 'pendingPosition'
          | 'structureState'
          | 'removalRequestedAt'
          | 'removedAt'
          | 'workingVersionId'
          | 'liveVersionId'
          | 'firstPublishedAt'
          | 'hiddenByTakedownNoticeId'
        >
      >,
    ): Promise<void> {
      await exec
        .update(section)
        .set({ ...patch, version: sql`${section.version} + 1` })
        .where(eq(section.sectionId, sectionId));
    },
    /** The versions the I1 editor shows: the working copy and the live version of each section. */
    async versionsByIds(exec: Executor, ids: readonly string[]): Promise<SectionVersionRow[]> {
      if (ids.length === 0) return [];
      return exec
        .select()
        .from(sectionVersion)
        .where(inArray(sectionVersion.sectionVersionId, [...new Set(ids)]))
        .limit(MAX_SECTIONS_READ * 2);
    },
    async versionForUpdate(
      exec: Executor,
      sectionVersionId: string,
    ): Promise<SectionVersionRow | undefined> {
      const [row] = await exec
        .select()
        .from(sectionVersion)
        .where(eq(sectionVersion.sectionVersionId, sectionVersionId))
        .limit(1)
        .for('update');
      return row;
    },
    async insertVersion(
      exec: Executor,
      values: typeof sectionVersion.$inferInsert,
    ): Promise<SectionVersionRow> {
      const [row] = await exec.insert(sectionVersion).values(values).returning();
      return row as SectionVersionRow;
    },
    async nextVersionNumber(exec: Executor, sectionId: string): Promise<number> {
      const [row] = await exec
        .select({ n: max(sectionVersion.versionNumber) })
        .from(sectionVersion)
        .where(eq(sectionVersion.sectionId, sectionId));
      return (row?.n ?? 0) + 1;
    },
    /** Version-checked change of a working copy; returns the row or undefined when stale. */
    async updateVersion(
      exec: Executor,
      sectionVersionId: string,
      expectedVersion: number,
      patch: Partial<
        Pick<
          SectionVersionRow,
          | 'titleBn'
          | 'titleEn'
          | 'reviewState'
          | 'submittedAt'
          | 'approvedAt'
          | 'publishedAt'
          | 'supersededAt'
        >
      >,
    ): Promise<SectionVersionRow | undefined> {
      const [row] = await exec
        .update(sectionVersion)
        .set({ ...patch, version: sql`${sectionVersion.version} + 1` })
        .where(
          and(
            eq(sectionVersion.sectionVersionId, sectionVersionId),
            eq(sectionVersion.version, expectedVersion),
          ),
        )
        .returning();
      return row;
    },
    /**
     * BR8.1: copies the live version's lesson list into a new working copy. Each copy keeps its
     * LessonVersion.version, so a lesson edit sent against the live lesson's token still matches
     * the copy it lands on (BR12.1).
     */
    async copyLessonVersions(exec: Executor, fromVersionId: string, toVersionId: string) {
      await exec.execute(sql`
        INSERT INTO ${lessonVersion} (lesson_id, section_version_id, position, title_bn, title_en,
          body_bn, body_en, video_asset_id, youtube_video_id, media_status, caption_languages,
          quiz_question_count, streak_bonus_days, link_domain_candidates, version)
        SELECT lesson_id, ${toVersionId}, position, title_bn, title_en, body_bn, body_en,
          video_asset_id, youtube_video_id, media_status, caption_languages, quiz_question_count,
          streak_bonus_days, link_domain_candidates, version
        FROM ${lessonVersion} WHERE section_version_id = ${fromVersionId}
        ORDER BY lesson_version_id`);
      // The working copy also gets its own copy of every quiz lesson's questions.
      await exec.execute(sql`
        INSERT INTO ${quizQuestion} (lesson_id, lesson_version_id, position, prompt_bn, prompt_en,
          options_bn, options_en, correct_index, explanation_bn, explanation_en)
        SELECT q.lesson_id, nlv.lesson_version_id, q.position, q.prompt_bn, q.prompt_en,
          q.options_bn, q.options_en, q.correct_index, q.explanation_bn, q.explanation_en
        FROM ${quizQuestion} q
        JOIN ${lessonVersion} olv ON olv.lesson_version_id = q.lesson_version_id
          AND olv.section_version_id = ${fromVersionId}
        JOIN ${lessonVersion} nlv ON nlv.lesson_id = olv.lesson_id
          AND nlv.section_version_id = ${toVersionId}
        ORDER BY q.lesson_id, q.position`);
    },
    /** BR8.5: the latest return comment of a section, which the owner reads in I1. */
    async latestReturnComment(exec: Executor, sectionId: string): Promise<string | null> {
      const [row] = await exec
        .select({ comment: sectionReview.comment, action: sectionReview.action })
        .from(sectionReview)
        .where(eq(sectionReview.sectionId, sectionId))
        .orderBy(desc(sectionReview.decidedAt), desc(sectionReview.sectionReviewId))
        .limit(1);
      return row?.action === 'returned' ? (row.comment ?? null) : null;
    },
  };
}

export type SectionRepository = ReturnType<typeof createSectionRepository>;
