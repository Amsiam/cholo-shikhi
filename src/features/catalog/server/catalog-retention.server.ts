// SD-227 retention jobs (NFR10.201, NFR10.202), plan Step 50, approved by the human on 2026-11-17.
// The purge runs as the dedicated `catalog_retention` database role (migration 0009: least-privilege
// grants, and the only role the immutability triggers and the section_review append-only trigger let
// delete, SD-207). Both jobs are registered with the worker and run daily (catalog-worker.server.ts).
// - catalog.retention.publishedHistory: retired at least max(10, audit.retentionYears) years ago, no
//   live plan or Practice Pack refers to the course, and no payout period does (the payout port is
//   owned by U9; until it exists the default answers "referenced", so nothing is deleted).
// - catalog.retention.discardedDrafts: never-published drafts 1 year after their discard, and inline
//   images that no lesson version refers to 1 year after upload (objects from both buckets first).
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { AppError } from '#src/lib/errors.ts';
import type { Json } from '#src/lib/json.ts';
import { ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, type Executor, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createRetentionRepository } from '../data/retention.repository.ts';
import { variantKey } from '../domain/image.ts';
import { discardedDraftCutoff, publishedHistoryCutoff } from '../domain/retention.ts';
import type { ImageStorage } from './image-ports.server.ts';

export const RETENTION_ROLE = 'catalog_retention';
export const RETENTION_JOBS = {
  publishedHistory: 'catalog.retention.publishedHistory',
  discardedDrafts: 'catalog.retention.discardedDrafts',
} as const;

export type RetentionDeps = {
  clock: Clock;
  storage: ImageStorage;
  log: Logger;
  /** Contract 2 setting audit.retentionYears (default 10, never below 10). */
  auditRetentionYears(): Promise<number>;
  /** U9: is any payout period tied to this course? Fail closed: unknown answers true (keep). */
  isReferencedByPayouts?(courseId: string): Promise<boolean>;
};

/**
 * Runs `fn` in a transaction as catalog_retention (SET LOCAL ROLE, so the role ends with the
 * transaction). The connecting role must be a member of catalog_retention; one that is not (the
 * production runtime role app_rw, INF-216) fails loudly and nothing is deleted.
 */
export async function withRetentionRole<T>(
  db: Database,
  fn: (exec: Executor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (tx) => {
    const exec = unwrapTx(tx);
    await exec.execute(sql.raw(`SET LOCAL ROLE ${RETENTION_ROLE}`));
    return fn(exec);
  });
}

export function createCatalogRetention(deps: RetentionDeps) {
  const repo = createRetentionRepository();
  const now = () => new Date(deps.clock.now());
  const isReferencedByPayouts = deps.isReferencedByPayouts ?? (async () => true);

  /** The courses whose published history is due (read-only; any role). */
  async function dueCourses(exec: Executor): Promise<string[]> {
    const cutoff = publishedHistoryCutoff(now(), await deps.auditRetentionYears());
    const candidates = await repo.retiredCoursesBefore(exec, cutoff);
    const due: string[] = [];
    for (const courseId of candidates) {
      if (!(await isReferencedByPayouts(courseId))) due.push(courseId);
    }
    return due;
  }

  /** The discarded drafts that are due (read-only; any role). */
  async function dueDrafts(exec: Executor): Promise<string[]> {
    return repo.discardedDraftsBefore(exec, discardedDraftCutoff(now()));
  }

  /** NFR10.201 purge; `exec` must run as catalog_retention. */
  async function purgePublishedHistory(exec: Executor): Promise<{ courses: number; rows: number }> {
    const courses = await dueCourses(exec);
    let rows = 0;
    for (const courseId of courses) rows += await repo.purgeCourseHistory(exec, courseId);
    deps.log.info(
      { event: 'catalog.retention.publishedHistory', courses: courses.length, rows },
      'published history purged',
    );
    return { courses: courses.length, rows };
  }

  /** NFR10.202 purge; `exec` must run as catalog_retention. */
  async function purgeDiscardedDrafts(
    exec: Executor,
  ): Promise<{ drafts: number; rows: number; images: number }> {
    const drafts = await dueDrafts(exec);
    let rows = 0;
    for (const sectionVersionId of drafts)
      rows += await repo.purgeDiscardedDraft(exec, sectionVersionId);
    const images = await repo.unreferencedImagesBefore(exec, discardedDraftCutoff(now()));
    for (const image of images) {
      for (const width of image.variantWidths) {
        const objectKey = variantKey(image.storageKey, width);
        await deps.storage.delete('public', objectKey);
        await deps.storage.delete('quarantine', objectKey);
      }
      await repo.deleteImageRow(exec, image.imageId);
    }
    deps.log.info(
      {
        event: 'catalog.retention.discardedDrafts',
        drafts: drafts.length,
        rows,
        images: images.length,
      },
      'discarded drafts purged',
    );
    return { drafts: drafts.length, rows, images: images.length };
  }

  /** The worker's handlers: each purge in its own catalog_retention transaction. */
  function jobHandlers(
    db: Database,
  ): Record<
    string,
    (ctx: { payload: unknown; correlationId: string }) => Promise<Result<Json, AppError>>
  > {
    return {
      [RETENTION_JOBS.publishedHistory]: async () =>
        ok(await withRetentionRole(db, (exec) => purgePublishedHistory(exec))),
      [RETENTION_JOBS.discardedDrafts]: async () =>
        ok(await withRetentionRole(db, (exec) => purgeDiscardedDrafts(exec))),
    };
  }

  return { dueCourses, dueDrafts, purgePublishedHistory, purgeDiscardedDrafts, jobHandlers };
}
