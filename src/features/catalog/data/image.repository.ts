// catalog_image and lesson_version_image (SD-217, SD-220, RD-211, RD-212). Every read is bounded
// (SC-209). The desired state is always recomputed from these rows (level-triggered), so a write
// here never trusts an event's action.
import { inArray, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { catalogImage, course, lessonVersionImage } from '#src/server/schema/index.ts';
import type { ImageKind } from '../domain/image.ts';

/** SC-209 bounds. A course holds at most a few hundred images (20 per lesson body). */
const COURSE_IMAGES_LIMIT = 2000;
const DUE_LIMIT = 200;
const KEY_LOOKUP_LIMIT = 1000;

export type ImageState = 'active' | 'quarantined' | 'deleted';

export type ImageRow = {
  imageId: string;
  courseId: string;
  kind: ImageKind;
  storageKey: string;
  variantWidths: number[];
  desiredState: ImageState;
  actualState: ImageState;
  desiredSince: Date;
};

export type ImageWithReferences = ImageRow & {
  isCourseHidden: boolean;
  references: Array<{ isHidden: boolean }>;
};

type RawImage = {
  image_id: string;
  course_id: string;
  kind: ImageKind;
  storage_key: string;
  variant_widths: number[];
  desired_state: ImageState;
  actual_state: ImageState;
  desired_since: string | Date;
};

const toRow = (r: RawImage): ImageRow => ({
  imageId: r.image_id,
  courseId: r.course_id,
  kind: r.kind,
  storageKey: r.storage_key,
  variantWidths: r.variant_widths.map(Number),
  desiredState: r.desired_state,
  actualState: r.actual_state,
  desiredSince: new Date(r.desired_since),
});

const COLUMNS = sql.raw(
  'ci.image_id, ci.course_id, ci.kind, ci.storage_key, ci.variant_widths, ci.desired_state, ci.actual_state, ci.desired_since',
);

export function createImageRepository() {
  return {
    async insert(
      exec: Executor,
      row: {
        courseId: string;
        kind: ImageKind;
        storageKey: string;
        variantWidths: number[];
        width: number;
        height: number;
        uploadedBy: string;
      },
    ): Promise<string> {
      const [inserted] = await exec
        .insert(catalogImage)
        .values(row)
        .returning({ imageId: catalogImage.imageId });
      if (!inserted) throw new Error('catalog_image insert returned no row');
      return inserted.imageId;
    },

    /** Test and retention helper: one reference row (SD-217 writes these at lesson save). */
    async addReference(exec: Executor, lessonVersionId: string, imageId: string): Promise<void> {
      await exec
        .insert(lessonVersionImage)
        .values({ lessonVersionId, imageId })
        .onConflictDoNothing();
    },

    async get(exec: Executor, imageId: string): Promise<ImageRow | undefined> {
      const result = await exec.execute<RawImage>(
        sql`SELECT ${COLUMNS} FROM ${catalogImage} ci WHERE ci.image_id = ${imageId}`,
      );
      const raw = result.rows[0];
      return raw ? toRow(raw) : undefined;
    },

    /**
     * SD-220: every live image of a course with the hidden flag of each current reference. A
     * reference counts while its lesson version is live or in a working copy; superseded and
     * discarded versions are history and never keep an image visible.
     */
    async listWithReferences(exec: Executor, courseId: string): Promise<ImageWithReferences[]> {
      const result = await exec.execute<
        RawImage & { is_course_hidden: boolean; references: Array<{ isHidden: boolean }> }
      >(sql`
        SELECT ${COLUMNS}, (c.status = 'hidden') AS is_course_hidden,
          coalesce(json_agg(json_build_object('isHidden',
              (s.hidden_by_takedown_notice_id IS NOT NULL OR l.hidden_by_takedown_notice_id IS NOT NULL)))
            FILTER (WHERE sv.section_version_id IS NOT NULL), '[]'::json) AS "references"
        FROM ${catalogImage} ci
        JOIN ${course} c ON c.course_id = ci.course_id
        LEFT JOIN lesson_version_image lvi ON lvi.image_id = ci.image_id
        LEFT JOIN lesson_version lv ON lv.lesson_version_id = lvi.lesson_version_id
        LEFT JOIN section_version sv ON sv.section_version_id = lv.section_version_id
          AND sv.review_state IN ('draft', 'in_review', 'approved', 'published')
        LEFT JOIN lesson l ON l.lesson_id = lv.lesson_id
        LEFT JOIN section s ON s.section_id = l.section_id
        WHERE ci.course_id = ${courseId} AND ci.desired_state <> 'deleted'
        GROUP BY ci.image_id, c.status
        ORDER BY ci.image_id
        LIMIT ${COURSE_IMAGES_LIMIT}`);
      return result.rows.map((r) => ({
        ...toRow(r),
        isCourseHidden: r.is_course_hidden,
        references: r.references,
      }));
    },

    /** Records a new desired state (and when it began); a no-op when it is already that state. */
    async setDesired(
      exec: Executor,
      imageId: string,
      desired: 'active' | 'quarantined',
      at: Date,
    ): Promise<boolean> {
      const result = await exec.execute(sql`
        UPDATE ${catalogImage} SET desired_state = ${desired}, desired_since = ${at}, version = version + 1
        WHERE image_id = ${imageId} AND desired_state <> ${desired} AND desired_state <> 'deleted'
        RETURNING image_id`);
      return result.rows.length === 1;
    },

    /** Records where the objects now are, only if the image still wants that state. */
    async setActual(exec: Executor, imageId: string, actual: 'active' | 'quarantined') {
      const result = await exec.execute(sql`
        UPDATE ${catalogImage} SET actual_state = ${actual}, version = version + 1
        WHERE image_id = ${imageId} AND actual_state <> ${actual} AND desired_state = ${actual}
        RETURNING image_id`);
      return result.rows.length === 1;
    },

    /** Images of one course whose desired and actual states differ (the job's work list). */
    async listPendingForCourse(exec: Executor, courseId: string): Promise<ImageRow[]> {
      const result = await exec.execute<RawImage>(sql`
        SELECT ${COLUMNS} FROM ${catalogImage} ci
        WHERE ci.course_id = ${courseId} AND ci.desired_state <> ci.actual_state
          AND ci.desired_state <> 'deleted'
        ORDER BY ci.desired_since LIMIT ${DUE_LIMIT}`);
      return result.rows.map(toRow);
    },

    /** RD-211: images whose states have differed since before `before`, oldest first. */
    async listDue(exec: Executor, before: Date): Promise<ImageRow[]> {
      const result = await exec.execute<RawImage>(sql`
        SELECT ${COLUMNS} FROM ${catalogImage} ci
        WHERE ci.desired_state <> ci.actual_state AND ci.desired_state <> 'deleted'
          AND ci.desired_since < ${before}
        ORDER BY ci.desired_since LIMIT ${DUE_LIMIT}`);
      return result.rows.map(toRow);
    },

    /** RD-212: which of these storage keys have a row (any state). */
    async existingKeys(exec: Executor, storageKeys: readonly string[]): Promise<Set<string>> {
      if (storageKeys.length === 0) return new Set();
      const bounded = storageKeys.slice(0, KEY_LOOKUP_LIMIT);
      const rows = await exec
        .select({ storageKey: catalogImage.storageKey })
        .from(catalogImage)
        .where(inArray(catalogImage.storageKey, bounded));
      return new Set(rows.map((r) => r.storageKey));
    },
  };
}

export type ImageRepository = ReturnType<typeof createImageRepository>;
