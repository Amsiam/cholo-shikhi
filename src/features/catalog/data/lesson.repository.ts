// Lessons and their versions (entities.md Lesson, LessonVersion). Lock order is course → section →
// section_version → lesson_version (PD-209, RD-206): callers hold the course and section locks before
// the *ForUpdate reads here. Every read is bounded (SC-209). Authored-field writes are
// version-checked in the UPDATE itself (BR12.1); the U4 technical-status writes carry no token and
// bump none (BR7.6, BR7.7), as the immutability trigger requires on published versions.
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  lesson,
  lessonVersion,
  quizQuestion,
  section,
  sectionVersion,
} from '#src/server/schema/index.ts';
import { MAX_LESSONS_PER_SECTION } from '../domain/lessons.ts';

export type LessonRow = typeof lesson.$inferSelect;
export type LessonVersionRow = typeof lessonVersion.$inferSelect;
export type QuizQuestionRow = typeof quizQuestion.$inferSelect;
export type LessonWithVersion = { lesson: LessonRow; version: LessonVersionRow };

type AuthoredPatch = Partial<
  Pick<
    LessonVersionRow,
    | 'titleBn'
    | 'titleEn'
    | 'bodyBn'
    | 'bodyEn'
    | 'linkDomainCandidates'
    | 'youtubeVideoId'
    | 'quizQuestionCount'
    | 'streakBonusDays'
  >
>;
type TechnicalPatch = Partial<
  Pick<LessonVersionRow, 'videoAssetId' | 'mediaStatus' | 'captionLanguages' | 'quizQuestionCount'>
>;

export function createLessonRepository() {
  return {
    async insertLesson(exec: Executor, values: typeof lesson.$inferInsert): Promise<LessonRow> {
      const [row] = await exec.insert(lesson).values(values).returning();
      return row as LessonRow;
    },
    async insertVersion(
      exec: Executor,
      values: typeof lessonVersion.$inferInsert,
    ): Promise<LessonVersionRow> {
      const [row] = await exec.insert(lessonVersion).values(values).returning();
      return row as LessonVersionRow;
    },
    /** The lessons of one section version in position order, with their stable Lesson rows. */
    async listForSectionVersion(
      exec: Executor,
      sectionVersionId: string,
      options: { forUpdate?: boolean } = {},
    ): Promise<LessonWithVersion[]> {
      const query = exec
        .select({ lesson, version: lessonVersion })
        .from(lessonVersion)
        .innerJoin(lesson, eq(lesson.lessonId, lessonVersion.lessonId))
        .where(eq(lessonVersion.sectionVersionId, sectionVersionId))
        .orderBy(asc(lessonVersion.lessonVersionId))
        .limit(MAX_LESSONS_PER_SECTION);
      const rows = options.forUpdate
        ? await query.for('update', { of: lessonVersion })
        : await query;
      return [...rows].sort((a, b) => a.version.position - b.version.position);
    },
    /** Lessons of many section versions at once (publish and readiness reads). */
    async listForSectionVersions(
      exec: Executor,
      sectionVersionIds: readonly string[],
    ): Promise<LessonWithVersion[]> {
      if (sectionVersionIds.length === 0) return [];
      return exec
        .select({ lesson, version: lessonVersion })
        .from(lessonVersion)
        .innerJoin(lesson, eq(lesson.lessonId, lessonVersion.lessonId))
        .where(inArray(lessonVersion.sectionVersionId, [...sectionVersionIds]))
        .orderBy(asc(lessonVersion.sectionVersionId), asc(lessonVersion.position))
        .limit(MAX_LESSONS_PER_SECTION * sectionVersionIds.length);
    },
    async getLessonForUpdate(exec: Executor, lessonId: string): Promise<LessonRow | undefined> {
      const [row] = await exec
        .select()
        .from(lesson)
        .where(eq(lesson.lessonId, lessonId))
        .limit(1)
        .for('update');
      return row;
    },
    async getLesson(exec: Executor, lessonId: string): Promise<LessonRow | undefined> {
      const [row] = await exec.select().from(lesson).where(eq(lesson.lessonId, lessonId)).limit(1);
      return row;
    },
    /** The section and course a lesson belongs to (U4 pushes arrive with the lesson ID only). */
    async placement(exec: Executor, lessonId: string) {
      const [row] = await exec
        .select({
          lessonId: lesson.lessonId,
          sectionId: section.sectionId,
          courseId: section.courseId,
        })
        .from(lesson)
        .innerJoin(section, eq(section.sectionId, lesson.sectionId))
        .where(eq(lesson.lessonId, lessonId))
        .limit(1);
      return row;
    },
    /** Version-checked authored edit; bumps LessonVersion.version. Undefined when stale. */
    async updateAuthored(
      exec: Executor,
      lessonVersionId: string,
      expectedVersion: number,
      patch: AuthoredPatch,
    ): Promise<LessonVersionRow | undefined> {
      const [row] = await exec
        .update(lessonVersion)
        .set({ ...patch, version: sql`${lessonVersion.version} + 1` })
        .where(
          and(
            eq(lessonVersion.lessonVersionId, lessonVersionId),
            eq(lessonVersion.version, expectedVersion),
          ),
        )
        .returning();
      return row;
    },
    /** BR7.6, BR7.7: technical status only; no token is checked and none is bumped. */
    /** A lesson version's quiz questions in order (the working copy's, or the live ones). */
    async questionsOfVersion(exec: Executor, lessonVersionId: string): Promise<QuizQuestionRow[]> {
      return exec
        .select()
        .from(quizQuestion)
        .where(eq(quizQuestion.lessonVersionId, lessonVersionId))
        .orderBy(asc(quizQuestion.position))
        .limit(200);
    },
    /**
     * Replaces a working copy's questions in one go. Only ever called on a draft working copy; the
     * guard trigger refuses any change to a published, superseded or discarded version's questions.
     */
    async replaceQuestions(
      exec: Executor,
      lessonId: string,
      lessonVersionId: string,
      questions: ReadonlyArray<
        Omit<typeof quizQuestion.$inferInsert, 'lessonId' | 'lessonVersionId' | 'position'>
      >,
    ): Promise<void> {
      await exec.delete(quizQuestion).where(eq(quizQuestion.lessonVersionId, lessonVersionId));
      if (questions.length === 0) return;
      await exec
        .insert(quizQuestion)
        .values(questions.map((q, i) => ({ ...q, lessonId, lessonVersionId, position: i + 1 })));
    },
    async updateTechnical(
      exec: Executor,
      lessonVersionIds: readonly string[],
      patch: TechnicalPatch,
    ): Promise<void> {
      if (lessonVersionIds.length === 0) return;
      await exec
        .update(lessonVersion)
        .set(patch)
        .where(inArray(lessonVersion.lessonVersionId, [...lessonVersionIds]));
    },
    async setPositions(
      exec: Executor,
      sectionVersionId: string,
      positions: ReadonlyArray<{ lessonId: string; position: number }>,
    ): Promise<void> {
      for (const { lessonId, position } of positions) {
        await exec
          .update(lessonVersion)
          .set({ position })
          .where(
            and(
              eq(lessonVersion.sectionVersionId, sectionVersionId),
              eq(lessonVersion.lessonId, lessonId),
            ),
          );
      }
    },
    async deleteVersion(exec: Executor, lessonVersionId: string): Promise<void> {
      await exec.delete(lessonVersion).where(eq(lessonVersion.lessonVersionId, lessonVersionId));
    },
    async deleteLesson(exec: Executor, lessonId: string): Promise<void> {
      await exec.delete(lesson).where(eq(lesson.lessonId, lessonId));
    },
    /** How many versions other than this one contain the lesson (BR7.4). */
    async otherVersionCount(
      exec: Executor,
      lessonId: string,
      exceptLessonVersionId: string,
    ): Promise<number> {
      const [row] = await exec
        .select({ n: count() })
        .from(lessonVersion)
        .where(
          and(
            eq(lessonVersion.lessonId, lessonId),
            ne(lessonVersion.lessonVersionId, exceptLessonVersionId),
          ),
        );
      return row?.n ?? 0;
    },
    async updateLesson(
      exec: Executor,
      lessonIds: readonly string[],
      patch: Partial<
        Pick<
          LessonRow,
          'liveState' | 'firstPublishedAt' | 'withdrawnAt' | 'hiddenByTakedownNoticeId'
        >
      >,
    ): Promise<void> {
      if (lessonIds.length === 0) return;
      await exec
        .update(lesson)
        .set({ ...patch, version: sql`${lesson.version} + 1` })
        .where(inArray(lesson.lessonId, [...lessonIds]));
    },
    /**
     * The working-copy and live versions of a lesson, with their section version's review state:
     * the only versions a U4 status push may touch (BR7.6, BR7.7).
     */
    async currentVersions(exec: Executor, lessonId: string, sectionId: string) {
      return exec
        .select({
          lessonVersionId: lessonVersion.lessonVersionId,
          videoAssetId: lessonVersion.videoAssetId,
          reviewState: sectionVersion.reviewState,
          isLive: sql<boolean>`${section.liveVersionId} = ${sectionVersion.sectionVersionId}`,
        })
        .from(lessonVersion)
        .innerJoin(
          sectionVersion,
          eq(sectionVersion.sectionVersionId, lessonVersion.sectionVersionId),
        )
        .innerJoin(section, eq(section.sectionId, sectionVersion.sectionId))
        .where(
          and(
            eq(lessonVersion.lessonId, lessonId),
            eq(section.sectionId, sectionId),
            inArray(sectionVersion.reviewState, ['draft', 'in_review', 'approved', 'published']),
          ),
        )
        .orderBy(asc(lessonVersion.lessonVersionId))
        .limit(2)
        .for('update', { of: lessonVersion });
    },
  };
}

export type LessonRepository = ReturnType<typeof createLessonRepository>;
