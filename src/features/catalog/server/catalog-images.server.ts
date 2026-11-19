// POST /api/catalog/images (Steps 44 and 45, approved by the human on 2026-11-17; NFR6.212–NFR6.215,
// SD-214–SD-217, RD-212). Every check runs before any byte of the body is read, in this order:
//   origin (same rule as the server-function CSRF check) → the shared builder guard (session,
//   instructor or Admin role, step-up, the catalog.imageUploads flag, the Zod query) → Content-Length
//   required (411) and at most 5 MB (413) → ownership (inline: section owner or Admin; cover: Lead
//   or Admin) → the authoring rate limit → an admission slot (SC-204) → this instance's helper
//   isolation gate (INF-203; a failed or unreachable helper answers imageUnreadable).
// The body is then read into memory with a byte counter (never to disk) and refused past 5 MB, the
// type is sniffed from the leading bytes, and the bytes go to the decoder helper process over its
// socket. The helper's output is checked (WebP only, no EXIF/XMP chunk), stored under a random key,
// objects first, then the row and its audit entry.
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { Audit } from '#src/features/platform/index.ts';
import { type AppError, type ClientError, toClientError } from '#src/lib/errors.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { guard, type ServerFnResult } from '#src/server/fn-core.ts';
import { createContractRepository } from '../data/contract.repository.ts';
import { createImageRepository } from '../data/image.repository.ts';
import { CATALOG_FLAGS } from '../domain/catalog-flags.ts';
import { notFound } from '../domain/course.ts';
import {
  IMAGE_SIGNATURE_BYTES,
  type ImageKind,
  imageBusy,
  imageRefusal,
  imageStorageKey,
  isCleanWebp,
  sniffImageFormat,
  variantKey,
} from '../domain/image.ts';
import { ImageUploadQuery } from './catalog-images.schema.ts';
import type { ImageAdmission } from './image-admission.ts';
import type { HelperClient, ImageStorage } from './image-ports.server.ts';
import { IMAGE_BUSY_RETRY_AFTER_SECONDS, IMAGE_UPLOAD_BODY_LIMIT_BYTES } from './limits.ts';

export type StoredImage = {
  imageId: string;
  kind: ImageKind;
  width: number;
  height: number;
  variantWidths: number[];
};

export type ImageUploadDeps = {
  db: Database;
  clock: Clock;
  audit: Audit;
  log: Logger;
  metrics: Metrics;
  getActor(request: Request): Promise<Result<Actor, AppError>>;
  isFlagEnabled(flagKey: string, ctx: { userId?: string }): Promise<boolean>;
  trustedOrigins(): readonly string[];
  owners: {
    assertSectionOwner(actor: Actor, sectionId: string): Promise<Result<void, AppError>>;
    assertCourseLead(actor: Actor, courseId: string): Promise<Result<void, AppError>>;
    admitAuthoring(actor: Actor): Promise<Result<void, AppError>>;
  };
  helper: HelperClient;
  storage: ImageStorage;
  admission: ImageAdmission;
  /** 16 random bytes per image key (SD-217); injectable for tests. */
  randomKeyBytes?: () => Uint8Array;
  /** Defaults to IMAGE_UPLOAD_BODY_LIMIT_BYTES (5 MB, Step 45). */
  bodyLimitBytes?: number;
};

const STATUS: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  STEP_UP_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  FEATURE_DISABLED: 404,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
};

/**
 * The server-function CSRF rule (src/server/csrf.ts) applied to this one route, which is not a
 * server function: Sec-Fetch-Site must be same-origin, else Origin, else Referer's origin, must be
 * in TRUSTED_ORIGINS. A request carrying none of them is refused (fail closed).
 */
export function isTrustedOrigin(request: Request, trustedOrigins: readonly string[]): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (origin) return trustedOrigins.includes(origin);
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return trustedOrigins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

type Capped = { isTooLarge: true } | { isTooLarge: false; bytes: Uint8Array };

/** Reads the body into memory and stops at limit + 1 byte; nothing is written to disk (SD-214). */
async function readCapped(request: Request, limit: number): Promise<Capped> {
  const reader = request.body?.getReader();
  if (!reader) return { isTooLarge: false, bytes: new Uint8Array() };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { isTooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { isTooLarge: false, bytes };
}

function reasonOf(error: AppError | ClientError): string {
  const tail = error.i18nKey.split('.').pop() ?? error.code;
  return tail.startsWith('image') ? tail : error.code;
}

export function createImageUploads(deps: ImageUploadDeps) {
  const images = createImageRepository();
  const contract = createContractRepository();
  const limit = deps.bodyLimitBytes ?? IMAGE_UPLOAD_BODY_LIMIT_BYTES;
  const randomKeyBytes = deps.randomKeyBytes ?? (() => new Uint8Array(randomBytes(16)));

  /** Ownership by kind (NFR6.212): returns the course the image belongs to. */
  async function authorise(actor: Actor, query: ImageUploadQuery) {
    if (query.kind === 'cover') {
      const lead = await deps.owners.assertCourseLead(actor, query.targetId);
      return lead.ok ? ok(query.targetId) : lead;
    }
    const owner = await deps.owners.assertSectionOwner(actor, query.targetId);
    if (!owner.ok) return owner;
    const row = await contract.sectionWithOwner(deps.db, query.targetId);
    return row ? ok(row.courseId) : err(notFound());
  }

  /** RD-212: the objects first, then the row and its audit entry in one transaction. */
  async function store(
    actor: Actor,
    courseId: string,
    kind: ImageKind,
    processed: {
      width: number;
      height: number;
      variants: ReadonlyArray<{ width: number; bytes: Uint8Array }>;
    },
    correlationId: string,
  ): Promise<Result<StoredImage, AppError>> {
    if (processed.variants.length === 0 || !processed.variants.every((v) => isCleanWebp(v.bytes))) {
      return err(imageRefusal('imageUnreadable'));
    }
    const storageKey = imageStorageKey(randomKeyBytes());
    for (const variant of processed.variants) {
      await deps.storage.put('public', variantKey(storageKey, variant.width), variant.bytes);
    }
    const variantWidths = processed.variants.map((v) => v.width);
    const imageId = await withTransaction(deps.db, async (tx) => {
      const id = await images.insert(unwrapTx(tx), {
        courseId,
        kind,
        storageKey,
        variantWidths,
        width: processed.width,
        height: processed.height,
        uploadedBy: actor.userId,
      });
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.image.uploaded',
        subjectType: 'catalog_image',
        subjectId: id,
        after: { imageId: id, courseId, kind },
        correlationId,
      });
      return id;
    });
    return ok({ imageId, kind, width: processed.width, height: processed.height, variantWidths });
  }

  async function upload(
    actor: Actor,
    query: ImageUploadQuery,
    request: Request,
    correlationId: string,
    context: { courseId?: string },
  ): Promise<Result<StoredImage, AppError>> {
    const header = request.headers.get('content-length');
    const declared = header === null || !/^\d+$/.test(header) ? Number.NaN : Number(header);
    if (!Number.isFinite(declared)) return err(imageRefusal('imageLengthRequired'));
    if (declared > limit) return err(imageRefusal('imageTooLarge'));
    const course = await authorise(actor, query);
    if (!course.ok) return course;
    context.courseId = course.value;
    const admitted = await deps.owners.admitAuthoring(actor);
    if (!admitted.ok) return admitted;
    const release = await deps.admission.enter();
    if (!release) return err(imageBusy(IMAGE_BUSY_RETRY_AFTER_SECONDS));
    try {
      // INF-203: this instance's helper must have passed its isolation self-test (fail closed).
      if (!(await deps.helper.isReady())) return err(imageRefusal('imageUnreadable'));
      const body = await readCapped(request, limit);
      if (body.isTooLarge) return err(imageRefusal('imageTooLarge'));
      const format = sniffImageFormat(body.bytes.slice(0, IMAGE_SIGNATURE_BYTES));
      if (!format) return err(imageRefusal('imageType'));
      const processed = await deps.helper.process({
        jobId: correlationId,
        bytes: body.bytes,
        sniffedFormat: format,
      });
      if (!processed.ok) return processed;
      return await store(actor, course.value, query.kind, processed.value, correlationId);
    } finally {
      release();
    }
  }

  function respond(
    status: number,
    body: ServerFnResult<StoredImage>,
    retryAfterSeconds?: number,
  ): Response {
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    if (retryAfterSeconds !== undefined) headers.set('retry-after', String(retryAfterSeconds));
    return new Response(JSON.stringify(body), { status, headers });
  }

  /** The route handler. */
  async function handle(request: Request): Promise<Response> {
    const startedAt = Date.parse(deps.clock.now());
    const context: { courseId?: string } = {};
    let refusal: AppError | undefined;
    const outcome: ServerFnResult<StoredImage> = isTrustedOrigin(request, deps.trustedOrigins())
      ? await guard(
          {
            access: { kind: 'role', roles: ['instructor', 'admin'] },
            schema: ImageUploadQuery,
            flag: CATALOG_FLAGS.imageUploads,
            handler: async ({ actor, input, correlationId }) => {
              const result = await upload(actor, input, request, correlationId, context);
              if (!result.ok) refusal = result.error;
              return result;
            },
          },
          {
            request,
            rawInput: Object.fromEntries(new URL(request.url).searchParams),
            getActor: deps.getActor,
            isFlagEnabled: deps.isFlagEnabled,
          },
        )
      : {
          ok: false,
          error: toClientError({ code: 'FORBIDDEN', i18nKey: 'errors.common.FORBIDDEN' }),
        };
    const durationMs = Date.parse(deps.clock.now()) - startedAt;
    if (outcome.ok) {
      deps.metrics.increment('catalog_image_uploads_total', { outcome: 'stored', reason: 'none' });
      deps.log.info(
        {
          event: 'catalog.image.stored',
          imageId: outcome.value.imageId,
          courseId: context.courseId,
          durationMs,
        },
        'image stored',
      );
      return respond(201, outcome);
    }
    const reason = reasonOf(refusal ?? outcome.error);
    deps.metrics.increment('catalog_image_uploads_total', { outcome: 'refused', reason });
    // OD-204: one line per refusal, IDs and the reason only (never bytes, names or dimensions).
    deps.log.info(
      { event: 'catalog.image.refused', reason, courseId: context.courseId, durationMs },
      'image refused',
    );
    const status =
      outcome.error.i18nKey === 'errors.catalog.imageTooLarge'
        ? 413
        : outcome.error.i18nKey === 'errors.catalog.imageLengthRequired'
          ? 411
          : (STATUS[outcome.error.code] ?? 500);
    const retryAfter = refusal?.details?.retryAfterSeconds;
    return respond(status, outcome, typeof retryAfter === 'number' ? retryAfter : undefined);
  }

  return { handle };
}

export type ImageUploads = ReturnType<typeof createImageUploads>;
