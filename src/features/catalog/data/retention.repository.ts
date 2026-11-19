// SD-227 retention (NFR10.201, NFR10.202). Selection is read-only and runs as any role; the purge
// statements must run as the dedicated `catalog_retention` role (migration 0009), the only role the
// immutability triggers let through (SD-207). Every read is bounded (SC-209).
import { sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';

const BATCH = 200;

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

export function createRetentionRepository() {
  return {
    /**
     * NFR10.201: retired courses whose retirement is at or before `cutoff`, that no live plan
     * version and no unretired Practice Pack refers to. Payout references are checked by the caller.
     */
    async retiredCoursesBefore(exec: Executor, cutoff: Date): Promise<string[]> {
      const result = await exec.execute<{ id: string }>(sql`
        SELECT c.course_id AS id FROM course c
        WHERE c.status = 'retired' AND c.retired_at <= ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM subscription_plan p
            JOIN subscription_plan_version_item i ON i.plan_version_id = p.current_version_id
            WHERE p.status = 'published' AND i.course_id = c.course_id)
          AND NOT EXISTS (
            SELECT 1 FROM practice_pack pp WHERE pp.course_id = c.course_id AND pp.status <> 'retired')
        ORDER BY c.retired_at, c.course_id LIMIT ${BATCH}`);
      return ids(result.rows);
    },

    /** NFR10.202: never-published section versions discarded at or before `cutoff`. */
    async discardedDraftsBefore(exec: Executor, cutoff: Date): Promise<string[]> {
      const result = await exec.execute<{ id: string }>(sql`
        SELECT sv.section_version_id AS id FROM section_version sv
        WHERE sv.review_state = 'discarded' AND sv.published_at IS NULL
          AND (SELECT max(r.decided_at) FROM section_review r
               WHERE r.section_version_id = sv.section_version_id AND r.to_state = 'discarded') <= ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM section s
               WHERE s.live_version_id = sv.section_version_id OR s.working_version_id = sv.section_version_id)
        ORDER BY sv.section_version_id LIMIT ${BATCH}`);
      return ids(result.rows);
    },

    /** Inline images uploaded at or before `cutoff` that no lesson version refers to (SD-227 [Q10]). */
    async unreferencedImagesBefore(
      exec: Executor,
      cutoff: Date,
    ): Promise<Array<{ imageId: string; storageKey: string; variantWidths: number[] }>> {
      const result = await exec.execute<{
        id: string;
        storage_key: string;
        variant_widths: number[];
      }>(sql`
        SELECT ci.image_id AS id, ci.storage_key, ci.variant_widths FROM catalog_image ci
        WHERE ci.kind = 'inline' AND ci.created_at <= ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM lesson_version_image l WHERE l.image_id = ci.image_id)
        ORDER BY ci.created_at LIMIT ${BATCH}`);
      return result.rows.map((r) => ({
        imageId: r.id,
        storageKey: r.storage_key,
        variantWidths: r.variant_widths.map(Number),
      }));
    },

    /** Deletes the published history of one course (as catalog_retention). Returns rows deleted. */
    async purgeCourseHistory(exec: Executor, courseId: string): Promise<number> {
      const versions = sql`SELECT sv.section_version_id FROM section_version sv
        JOIN section s ON s.section_id = sv.section_id WHERE s.course_id = ${courseId}`;
      let deleted = 0;
      const run = async (statement: ReturnType<typeof sql>) => {
        const result = await exec.execute(statement);
        deleted += result.rowCount ?? 0;
      };
      await run(sql`DELETE FROM lesson_version_image WHERE lesson_version_id IN (
        SELECT lesson_version_id FROM lesson_version WHERE section_version_id IN (${versions}))`);
      await run(sql`DELETE FROM section_review WHERE section_version_id IN (${versions})`);
      await exec.execute(sql`UPDATE section SET live_version_id = NULL, working_version_id = NULL
        WHERE course_id = ${courseId}`);
      await run(sql`DELETE FROM lesson_version WHERE section_version_id IN (${versions})`);
      await run(sql`DELETE FROM section_version WHERE section_version_id IN (${versions})`);
      await run(sql`DELETE FROM ownership_period WHERE section_id IN (
        SELECT section_id FROM section WHERE course_id = ${courseId})`);
      return deleted;
    },

    /** Deletes one discarded draft with its lessons' versions and review comments (as catalog_retention). */
    async purgeDiscardedDraft(exec: Executor, sectionVersionId: string): Promise<number> {
      let deleted = 0;
      const run = async (statement: ReturnType<typeof sql>) => {
        const result = await exec.execute(statement);
        deleted += result.rowCount ?? 0;
      };
      await run(sql`DELETE FROM lesson_version_image WHERE lesson_version_id IN (
        SELECT lesson_version_id FROM lesson_version WHERE section_version_id = ${sectionVersionId})`);
      await run(sql`DELETE FROM section_review WHERE section_version_id = ${sectionVersionId}`);
      await run(sql`DELETE FROM lesson_version WHERE section_version_id = ${sectionVersionId}`);
      await run(sql`DELETE FROM section_version WHERE section_version_id = ${sectionVersionId}`);
      return deleted;
    },

    async deleteImageRow(exec: Executor, imageId: string): Promise<void> {
      await exec.execute(sql`DELETE FROM catalog_image WHERE image_id = ${imageId}`);
    },
  };
}
