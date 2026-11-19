// Step 46: image visibility after a takedown (NFR6.218; SD-220, RD-211, RD-212; LC-207, LC-208).
// - The relay consumer `catalog.imageVisibility` only marks each image's desired state, recomputed
//   from the database (never from the event's action), and asks for the apply job (SC-210).
// - `catalog.image.applyVisibility` moves the objects of one course between the public and the
//   quarantine bucket (copy, then delete the source; each step checks the current location first)
//   and then records the actual state. It is idempotent and level-triggered.
// - `catalog.image.reconcile` runs every minute and re-applies any image whose desired and actual
//   states have differed for more than 60 s.
// - `catalog.image.orphanSweep` deletes objects older than 24 h that have no catalog_image row.
// Until the buckets exist (Step 47, needs the human's approval) they run only against the local
// storage stub. Logs and metrics carry IDs, enums and numbers only (OD-204, OD-205).
import type { Logger } from 'pino';
import type { z } from 'zod';
import { type AppError, appError } from '#src/lib/errors.ts';
import type { Envelope } from '#src/lib/events/envelope.ts';
import { Id } from '#src/lib/ids.ts';
import type { Json } from '#src/lib/json.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Database, type Executor, unwrapTx } from '#src/server/db.ts';
import { createImageRepository, type ImageRow } from '../data/image.repository.ts';
import {
  CONTENT_VISIBILITY_CHANGED,
  ContentVisibilityChangedV1,
} from '../domain/catalog-events.schema.ts';
import {
  desiredImageState,
  type ImageVisibility,
  isReconcileDue,
  type MoveStep,
  planImageMove,
  RECONCILE_GRACE_MS,
  variantKey,
} from '../domain/image.ts';
import type { ImageStorage } from './image-ports.server.ts';

export const IMAGE_VISIBILITY_CONSUMER = 'catalog.imageVisibility';
export const IMAGE_JOBS = {
  applyVisibility: 'catalog.image.applyVisibility',
  reconcile: 'catalog.image.reconcile',
  orphanSweep: 'catalog.image.orphanSweep',
} as const;
/** RD-212: an object older than this with no row is an orphan. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const IMAGE_PREFIX = 'img/';

export type ImageVisibilityDeps = {
  db: Database;
  clock: Clock;
  storage: ImageStorage;
  log: Logger;
  metrics: Metrics;
  /** Asks the jobs lane to run the apply job for a course; keyed by the event, so a redelivery is one job. */
  scheduleApply(courseId: string, eventId: string): Promise<void>;
};

type JobResult = Promise<Result<Json, AppError>>;

/** The shape of a contract 2 outbox consumer (structural, so Catalog imports no Platform internals). */
export type CatalogConsumer<P> = {
  consumerName: string;
  type: string;
  version: number;
  schema: z.ZodType<P>;
  handle: (tx: TxHandle, event: Envelope<P>) => Promise<Result<void, AppError>>;
};

export function createImageVisibility(deps: ImageVisibilityDeps) {
  const images = createImageRepository();
  const now = () => new Date(deps.clock.now());

  /** SD-220: records the recomputed desired state of every image of the course; returns the count changed. */
  async function markDesired(exec: Executor, courseId: string): Promise<number> {
    let changed = 0;
    for (const image of await images.listWithReferences(exec, courseId)) {
      const desired = desiredImageState(image);
      if (await images.setDesired(exec, image.imageId, desired, now())) changed += 1;
    }
    return changed;
  }

  function consumer(): CatalogConsumer<ContentVisibilityChangedV1> {
    return {
      consumerName: IMAGE_VISIBILITY_CONSUMER,
      type: CONTENT_VISIBILITY_CHANGED.type,
      version: CONTENT_VISIBILITY_CHANGED.version,
      schema: ContentVisibilityChangedV1,
      handle: async (tx, event) => {
        await markDesired(unwrapTx(tx), event.payload.courseId);
        await deps.scheduleApply(event.payload.courseId, event.id);
        return ok(undefined);
      },
    };
  }

  async function runStep(step: MoveStep, objectKey: string): Promise<void> {
    if (step === 'copyToQuarantine') await deps.storage.copy('public', 'quarantine', objectKey);
    if (step === 'copyToPublic') await deps.storage.copy('quarantine', 'public', objectKey);
    if (step === 'deleteFromPublic') await deps.storage.delete('public', objectKey);
    if (step === 'deleteFromQuarantine') await deps.storage.delete('quarantine', objectKey);
  }

  /** Moves one image's variants to where its desired state says, then records the actual state. */
  async function applyImage(image: ImageRow): Promise<boolean> {
    const target = image.desiredState as ImageVisibility;
    for (const width of image.variantWidths) {
      const objectKey = variantKey(image.storageKey, width);
      const location = {
        inPublic: await deps.storage.exists('public', objectKey),
        inQuarantine: await deps.storage.exists('quarantine', objectKey),
      };
      for (const step of planImageMove(location, target)) await runStep(step, objectKey);
    }
    const isRecorded = await images.setActual(deps.db, image.imageId, target);
    if (isRecorded) {
      const lagSeconds = Math.max(0, (now().getTime() - image.desiredSince.getTime()) / 1000);
      deps.metrics.observe('catalog_image_visibility_lag_seconds', lagSeconds);
      deps.log.info(
        {
          event: 'catalog.image.visibilityApplied',
          imageId: image.imageId,
          from: image.actualState,
          to: target,
          lagSeconds,
        },
        'image visibility applied',
      );
    }
    return isRecorded;
  }

  /** The apply job: recompute (level-triggered), then move every pending image of the course. */
  async function applyForCourse(courseId: string): Promise<number> {
    await markDesired(deps.db, courseId);
    let applied = 0;
    for (const image of await images.listPendingForCourse(deps.db, courseId)) {
      if (await applyImage(image)) applied += 1;
    }
    return applied;
  }

  /** RD-211: re-applies every image whose states have differed for more than 60 s. */
  async function reconcile(): Promise<number> {
    const at = now();
    const due = await images.listDue(deps.db, new Date(at.getTime() - RECONCILE_GRACE_MS));
    let applied = 0;
    for (const image of due) {
      if (isReconcileDue(image, at) && (await applyImage(image))) applied += 1;
    }
    return applied;
  }

  /** RD-212: objects under img/ older than 24 h whose key has no row are deleted from both buckets. */
  async function orphanSweep(): Promise<number> {
    const cutoff = now().getTime() - ORPHAN_AGE_MS;
    const objects = [
      ...(await deps.storage.list('public', IMAGE_PREFIX)).map((o) => ({
        ...o,
        bucket: 'public' as const,
      })),
      ...(await deps.storage.list('quarantine', IMAGE_PREFIX)).map((o) => ({
        ...o,
        bucket: 'quarantine' as const,
      })),
    ].filter((o) => o.createdAt.getTime() < cutoff);
    const keyOf = (objectKey: string) => objectKey.split('/').slice(0, 2).join('/');
    const known = await images.existingKeys(deps.db, [
      ...new Set(objects.map((o) => keyOf(o.objectKey))),
    ]);
    let deleted = 0;
    for (const object of objects) {
      if (known.has(keyOf(object.objectKey))) continue;
      await deps.storage.delete(object.bucket, object.objectKey);
      deleted += 1;
    }
    if (deleted > 0)
      deps.log.info({ event: 'catalog.image.orphansDeleted', deleted }, 'orphans deleted');
    return deleted;
  }

  function jobHandlers(): Record<string, (ctx: { payload: unknown }) => JobResult> {
    return {
      [IMAGE_JOBS.applyVisibility]: async ({ payload }) => {
        const courseId = (payload as { courseId?: unknown } | null)?.courseId;
        if (!Id.safeParse(courseId).success) return err(appError('VALIDATION_FAILED'));
        return ok({ applied: await applyForCourse(courseId as string) });
      },
      [IMAGE_JOBS.reconcile]: async () => ok({ applied: await reconcile() }),
      [IMAGE_JOBS.orphanSweep]: async () => ok({ deleted: await orphanSweep() }),
    };
  }

  return { consumer, markDesired, applyForCourse, reconcile, orphanSweep, jobHandlers };
}

export type ImageVisibilityService = ReturnType<typeof createImageVisibility>;
