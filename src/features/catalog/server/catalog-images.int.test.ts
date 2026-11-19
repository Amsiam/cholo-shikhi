// [LT] Steps 44 and 45 (approved 2026-11-17): POST /api/catalog/images on real PostgreSQL with real
// Better Auth sessions and the real U1 flags, audit and rate-limit store.
// - Guard order: every refusal happens before a single byte of the body is pulled (NFR6.212, SD-214).
// - The NFR6.202 negative matrix: anonymous, wrong user, wrong role, Admin without step-up.
// - Flag off: unreachable (FEATURE_DISABLED). Flag on with a helper that is not ready (INF-203
//   failed or no helper): fails closed with imageUnreadable before reading the body.
// - Size (Step 45: Content-Length required, 5 MB cap), type from content (NFR6.213), admission.
// - The store path (output check, random key, objects then row + audit; RD-212) with a fake decoder;
//   image-helper.int.test.ts runs the same route against the real helper process and sharp.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { createAudit, flags } from '#src/features/platform/index.ts';
import { createLogger } from '#src/lib/logger.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { TEST_ORIGIN } from '#src/test/browser.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { value } from '../test-fixtures/publish-helper.ts';
import {
  createImageUploads,
  type ImageUploadDeps,
  isTrustedOrigin,
} from './catalog-images.server.ts';
import { getCatalog } from './catalog-instance.server.ts';
import { createImageAdmission, type ImageAdmission } from './image-admission.ts';
import {
  createMemoryImageStorage,
  type HelperClient,
  type ImageStorage,
  unavailableHelperClient,
} from './image-ports.server.ts';

const NO_STEP_UP = 'x-test-admin-without-step-up';
/** A helper that passed its self-test but refuses every image (reads the body, stores nothing). */
const readyUnavailable: HelperClient = { ...unavailableHelperClient, isReady: async () => true };
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, ...ascii('IHDR')];
const pngBytes = (size = 64) => new Uint8Array([...PNG_HEAD, ...new Array(size).fill(7)]);
const webp = (chunk: string) => {
  const body = [...ascii('WEBP'), ...ascii(chunk), ...le32(2), 1, 2];
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
};

let s: ServerFnHarness;
let lead: Caller;
let coInstructor: Caller;
let courseId: string;
let sectionId: string;

/** A body whose bytes are only produced when the route pulls them; `pulls` counts every pull. */
function trackedBody(bytes: Uint8Array) {
  const tracker = { pulls: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        tracker.pulls += 1;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, tracker };
}

function uploadRequest(
  caller: Caller | null,
  query: Record<string, string>,
  body: ReadableStream<Uint8Array> | Uint8Array,
  extra: Record<string, string> = {},
): Request {
  const headers = new Headers(caller?.request.headers);
  headers.set('origin', TEST_ORIGIN);
  // Step 45: Content-Length is required; a test that needs it absent passes an empty value.
  headers.set(
    'content-length',
    String(body instanceof Uint8Array ? body.byteLength : PNG_HEAD.length + 64),
  );
  for (const [k, v] of Object.entries(extra)) {
    if (v === '') headers.delete(k);
    else headers.set(k, v);
  }
  const url = `${TEST_ORIGIN}/api/catalog/images?${new URLSearchParams(query)}`;
  return new Request(url, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

function uploads(overrides: Partial<ImageUploadDeps> = {}) {
  const storage = overrides.storage ?? createMemoryImageStorage(systemClock);
  const metrics = createMetrics();
  const catalog = getCatalog();
  const service = createImageUploads({
    db: getDb(),
    clock: systemClock,
    audit: createAudit({ clock: systemClock }),
    log: createLogger({ level: 'silent' }),
    metrics,
    getActor: async (request) => {
      const actor = await getIdentity().getActor(request);
      return request.headers.get(NO_STEP_UP) && actor.ok
        ? ok({ ...actor.value, hasStepUp: false })
        : actor;
    },
    isFlagEnabled: (flagKey, ctx) => flags().isEnabled(flagKey, ctx),
    trustedOrigins: () => [TEST_ORIGIN],
    owners: {
      assertSectionOwner: (actor, id) => catalog.assertSectionOwner(actor, id),
      assertCourseLead: (actor, id) => catalog.assertCourseLead(actor, id),
      admitAuthoring: (actor) => catalog.admitAuthoring(actor),
    },
    helper: unavailableHelperClient,
    storage,
    admission: createImageAdmission({ processing: 2, waiting: 10 }),
    ...overrides,
  });
  return { service, storage, metrics };
}

async function json(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    value?: { imageId: string; variantWidths: number[] };
    error?: { code: string; i18nKey: string };
  };
}

async function imageCount(): Promise<number> {
  const { rows } = await s.t.pool.query<{ n: string }>('SELECT count(*) AS n FROM catalog_image');
  return Number(rows[0]?.n);
}

async function setUploadsFlag(state: 'on' | 'off') {
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'catalog.imageUploads',
      description: `LT: image uploads ${state}`,
      state,
    }),
  );
}

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  lead = await s.newInstructor();
  coInstructor = await s.newInstructor();
  courseId = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: [buildTitle()],
    }),
  ).courseId;
  const view = value<{ sections: Array<{ sectionId: string }> }>(
    await s.call('getCourseForEditing', lead.request, { courseId }),
  );
  sectionId = view.sections[0]?.sectionId as string;
});
afterAll(async () => {
  await s?.close();
});

describe('isTrustedOrigin (the server-function CSRF rule on this route)', () => {
  const at = (headers: Record<string, string>) =>
    isTrustedOrigin(new Request(`${TEST_ORIGIN}/api/catalog/images`, { headers }), [TEST_ORIGIN]);
  it('trusts same-origin fetches and listed origins, refuses cross-site and silent requests', () => {
    expect(at({ 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(at({ 'sec-fetch-site': 'cross-site', origin: TEST_ORIGIN })).toBe(false);
    expect(at({ origin: TEST_ORIGIN })).toBe(true);
    expect(at({ origin: 'https://evil.example' })).toBe(false);
    expect(at({ referer: `${TEST_ORIGIN}/instructor/courses` })).toBe(true);
    expect(at({ referer: 'not a url' })).toBe(false);
    expect(at({})).toBe(false);
  });
});

describe('POST /api/catalog/images with catalog.imageUploads off (the default)', () => {
  it('is unreachable for the Lead: FEATURE_DISABLED, no body byte read, nothing stored', async () => {
    const { service } = uploads();
    const { stream, tracker } = trackedBody(pngBytes());
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, stream),
    );
    expect(response.status).toBe(404);
    expect((await json(response)).error?.code).toBe('FEATURE_DISABLED');
    expect(tracker.pulls).toBe(0);
    expect(await imageCount()).toBe(0);
  });
});

describe('POST /api/catalog/images with the flag on', () => {
  const refusedCases: Array<
    [string, () => Caller | null, Record<string, string>, number, string, Record<string, string>?]
  > = [
    ['anonymous', () => null, {}, 401, 'UNAUTHENTICATED'],
    ['a student (wrong role)', () => studentRef.current, {}, 403, 'FORBIDDEN'],
    ['Finance (wrong role)', () => financeRef.current, {}, 403, 'FORBIDDEN'],
    [
      'another instructor (wrong user; SD-202 hides the course)',
      () => coInstructor,
      {},
      404,
      'NOT_FOUND',
    ],
    ['an Admin without step-up', () => s.admin, {}, 403, 'STEP_UP_REQUIRED', { [NO_STEP_UP]: '1' }],
    ['a malformed query', () => lead, { kind: 'svg' }, 422, 'VALIDATION_FAILED'],
    ['an unknown section', () => lead, { targetId: randomUUID() }, 404, 'NOT_FOUND'],
  ];
  const studentRef: { current: Caller | null } = { current: null };
  const financeRef: { current: Caller | null } = { current: null };

  beforeAll(async () => {
    await setUploadsFlag('on');
    studentRef.current = await s.newStudent();
    financeRef.current = await s.newFinance();
  });

  it.each(refusedCases)(
    'refuses %s before reading any byte of the body',
    async (_label, caller, query, status, code, extra) => {
      const { service } = uploads();
      const { stream, tracker } = trackedBody(pngBytes());
      const response = await service.handle(
        uploadRequest(caller(), { kind: 'inline', targetId: sectionId, ...query }, stream, extra),
      );
      expect(response.status).toBe(status);
      expect((await json(response)).error?.code).toBe(code);
      expect(tracker.pulls).toBe(0);
      expect(await imageCount()).toBe(0);
    },
  );

  it('refuses a cross-site request (origin check) before the session is even read', async () => {
    const { service } = uploads();
    const { stream, tracker } = trackedBody(pngBytes());
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, stream, {
        origin: 'https://evil.example',
      }),
    );
    expect(response.status).toBe(403);
    expect(tracker.pulls).toBe(0);
  });

  it('refuses a cover upload by a non-Lead and accepts the check for the Lead', async () => {
    const { service } = uploads();
    const refused = await service.handle(
      uploadRequest(coInstructor, { kind: 'cover', targetId: courseId }, pngBytes()),
    );
    expect(refused.status).toBe(404);
    const failedClosed = await service.handle(
      uploadRequest(lead, { kind: 'cover', targetId: courseId }, pngBytes()),
    );
    expect((await json(failedClosed)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
  });

  it('fails closed for the section owner: imageUnreadable, nothing stored (helper not ready)', async () => {
    const { service, storage, metrics } = uploads();
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, pngBytes()),
    );
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await json(response)).error).toEqual({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.catalog.imageUnreadable',
    });
    expect(await imageCount()).toBe(0);
    expect(await storage.list('public', 'img/')).toEqual([]);
    expect(
      metrics.counterValue('catalog_image_uploads_total', {
        outcome: 'refused',
        reason: 'imageUnreadable',
      }),
    ).toBe(1);
  });

  it('answers 413 imageTooLarge past 5 MB, declared or streamed (Step 45)', async () => {
    const { service } = uploads({ helper: readyUnavailable });
    const declared = trackedBody(pngBytes());
    const byHeader = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, declared.stream, {
        'content-length': String(5 * 1024 * 1024 + 1),
      }),
    );
    expect(byHeader.status).toBe(413);
    expect(declared.tracker.pulls).toBe(0);
    // A body longer than its declared length is cut at 5 MB + 1 byte.
    const streamed = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, pngBytes(5 * 1024 * 1024), {
        'content-length': '1000',
      }),
    );
    expect(streamed.status).toBe(413);
    expect((await json(streamed)).error?.i18nKey).toBe('errors.catalog.imageTooLarge');
  });

  it('accepts a body above the old 100 KB fallback and up to 5 MB (Step 45)', async () => {
    const { service } = uploads({ helper: readyUnavailable });
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, pngBytes(200 * 1024)),
    );
    // Read in full and handed to the helper, which refuses it: not a size refusal.
    expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
  });

  it('answers 411 without a Content-Length, before reading the body (Step 45)', async () => {
    const { service } = uploads({ helper: readyUnavailable });
    const { stream, tracker } = trackedBody(pngBytes());
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, stream, {
        'content-length': '',
      }),
    );
    expect(response.status).toBe(411);
    expect((await json(response)).error).toEqual({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.catalog.imageLengthRequired',
    });
    expect(tracker.pulls).toBe(0);
  });

  it('fails closed before reading the body when the helper is not ready (INF-203)', async () => {
    const { service } = uploads();
    const { stream, tracker } = trackedBody(pngBytes());
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, stream),
    );
    expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
    expect(tracker.pulls).toBe(0);
  });

  it('refuses a non-image or an SVG by its content, whatever its declared type (NFR6.213)', async () => {
    const { service } = uploads({ helper: readyUnavailable });
    for (const body of [
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      new Uint8Array(),
    ]) {
      const response = await service.handle(
        uploadRequest(lead, { kind: 'inline', targetId: sectionId }, body, {
          'content-type': 'image/png',
        }),
      );
      expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageType');
    }
  });

  it('answers RATE_LIMITED imageBusy with Retry-After 5 when no admission slot is free (SC-204)', async () => {
    const admission: ImageAdmission = createImageAdmission({ processing: 1, waiting: 0 });
    const held = await admission.enter();
    const { service } = uploads({ admission });
    const { stream, tracker } = trackedBody(pngBytes());
    const response = await service.handle(
      uploadRequest(lead, { kind: 'inline', targetId: sectionId }, stream),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('5');
    expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageBusy');
    expect(tracker.pulls).toBe(0);
    held?.();
  });

  describe('the approved store path, with a fake decoder standing in for the helper', () => {
    const decoder = (chunk: string): HelperClient => ({
      isReady: async () => true,
      async process() {
        return ok({
          width: 800,
          height: 450,
          variants: [
            { width: 400, bytes: webp(chunk) },
            { width: 800, bytes: webp(chunk) },
          ],
        });
      },
    });

    it('stores the variants under one random key, then the row and its audit entry (RD-212)', async () => {
      const storage: ImageStorage = createMemoryImageStorage(systemClock);
      const { service } = uploads({ helper: decoder('VP8 '), storage });
      const response = await service.handle(
        uploadRequest(lead, { kind: 'inline', targetId: sectionId }, pngBytes()),
      );
      expect(response.status).toBe(201);
      const body = await json(response);
      expect(body.value?.variantWidths).toEqual([400, 800]);
      const objects = (await storage.list('public', 'img/')).map((o) => o.objectKey).sort();
      expect(objects).toHaveLength(2);
      expect(objects[0]).toMatch(/^img\/[A-Za-z0-9_-]{22}\/400\.webp$/);
      const { rows } = await s.t.pool.query(
        'SELECT course_id, kind, uploaded_by FROM catalog_image WHERE image_id = $1',
        [body.value?.imageId],
      );
      expect(rows[0]).toEqual({ course_id: courseId, kind: 'inline', uploaded_by: lead.userId });
      const audit = await s.t.pool.query(
        `SELECT action FROM audit_log_entry WHERE subject_id = $1`,
        [body.value?.imageId],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['catalog.image.uploaded']);
    });

    it('stores nothing when a variant still carries EXIF metadata (SD-216 output check)', async () => {
      const storage = createMemoryImageStorage(systemClock);
      const before = await imageCount();
      const { service } = uploads({ helper: decoder('EXIF'), storage });
      const response = await service.handle(
        uploadRequest(lead, { kind: 'inline', targetId: sectionId }, pngBytes()),
      );
      expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
      expect(await storage.list('public', 'img/')).toEqual([]);
      expect(await imageCount()).toBe(before);
    });
  });
});
