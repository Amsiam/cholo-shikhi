// [LT] Step 44 end to end: POST /api/catalog/images → the web-side socket client → a real helper
// server on a Unix socket → the real decode workers and sharp → storage and the catalog_image row.
// The helper's INF-203 probes cannot pass on a developer machine (no hardened sidecar, Step 47 is
// deferred), so the helper here gets a self-test stub: one that passes, to prove the store path, and
// one that fails, to prove the fail-closed gate. Everything else is real.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { createAudit, flags } from '#src/features/platform/index.ts';
import { createLogger } from '#src/lib/logger.ts';
import { createMetrics, type Metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { TEST_ORIGIN } from '#src/test/browser.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { isCleanWebp } from '../domain/image.ts';
import type { HelperSelfReport } from '../domain/image-isolation.ts';
import { value } from '../test-fixtures/publish-helper.ts';
import { createImageUploads } from './catalog-images.server.ts';
import { getCatalog } from './catalog-instance.server.ts';
import { createImageAdmission } from './image-admission.ts';
import { createDecodePool, type DecodePool } from './image-decode-pool.server.ts';
import { createHelperServer } from './image-helper.server.ts';
import { createSocketHelperClient } from './image-helper-client.server.ts';
import { createMemoryImageStorage, type ImageStorage } from './image-ports.server.ts';
import { encodeFrame } from './image-protocol.ts';

const WORKER = new URL('./image-decode-worker.server.ts', import.meta.url);
const corpus = (file: string) =>
  new Uint8Array(readFileSync(new URL(`../test-fixtures/images/${file}`, import.meta.url)));
const WEB_UID = 4242;
const passing: HelperSelfReport = {
  checks: {
    envAllowlisted: true,
    workerEnvExact: true,
    noForeignProcesses: true,
    noSecretPaths: true,
    networkUnreachable: true,
    rootReadOnly: true,
    noCapabilities: true,
    memoryLimit: true,
    roundTrip: true,
  },
  envValueHashes: [],
};
const targets = { privateHost: '10.0.0.5', publicHost: '1.1.1.1', webEnvFilePath: '/srv/app/.env' };

let s: ServerFnHarness;
let lead: Caller;
let sectionId: string;
let pool: DecodePool;
const servers: Array<{ close(): Promise<void> }> = [];
const socketPath = () => `/tmp/cs-it-${randomBytes(6).toString('hex')}.sock`;

async function startHelper(report: HelperSelfReport) {
  const path = socketPath();
  const server = createHelperServer({ pool, selfTest: async () => report });
  await server.listen(path);
  servers.push(server);
  return path;
}

function route(path: string, opts: { metrics?: Metrics; storage?: ImageStorage } = {}) {
  const catalog = getCatalog();
  const metrics = opts.metrics ?? createMetrics();
  const storage = opts.storage ?? createMemoryImageStorage(systemClock);
  const helper = createSocketHelperClient({
    socketPath: path,
    targets,
    webUid: WEB_UID,
    webSecretValueHashes: ['not-a-helper-hash'],
    socketOwnerUid: async () => WEB_UID + 1,
    metrics,
    log: createLogger({ level: 'silent' }),
  });
  const service = createImageUploads({
    db: getDb(),
    clock: systemClock,
    audit: createAudit({ clock: systemClock }),
    log: createLogger({ level: 'silent' }),
    metrics,
    getActor: (request) => getIdentity().getActor(request),
    isFlagEnabled: (flagKey, ctx) => flags().isEnabled(flagKey, ctx),
    trustedOrigins: () => [TEST_ORIGIN],
    owners: {
      assertSectionOwner: (actor, id) => catalog.assertSectionOwner(actor, id),
      assertCourseLead: (actor, id) => catalog.assertCourseLead(actor, id),
      admitAuthoring: (actor) => catalog.admitAuthoring(actor),
    },
    helper,
    storage,
    admission: createImageAdmission({ processing: 2, waiting: 10 }),
  });
  return { service, storage, metrics };
}

function upload(body: Uint8Array) {
  const headers = new Headers(lead.request.headers);
  headers.set('origin', TEST_ORIGIN);
  headers.set('content-length', String(body.byteLength));
  const url = `${TEST_ORIGIN}/api/catalog/images?${new URLSearchParams({ kind: 'inline', targetId: sectionId })}`;
  return new Request(url, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

const json = async (response: Response) =>
  (await response.json()) as {
    ok: boolean;
    value?: { imageId: string; width: number; variantWidths: number[] };
    error?: { code: string; i18nKey: string };
  };

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  lead = await s.newInstructor();
  const { courseId } = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: [buildTitle()],
    }),
  );
  sectionId = value<{ sections: Array<{ sectionId: string }> }>(
    await s.call('getCourseForEditing', lead.request, { courseId }),
  ).sections[0]?.sectionId as string;
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'catalog.imageUploads',
      description: 'LT: image helper end to end',
      state: 'on',
    }),
  );
  pool = createDecodePool({ workerPath: WORKER });
  await pool.start();
});
afterAll(async () => {
  for (const server of servers) await server.close();
  await pool?.stop();
  await s?.close();
});

describe('upload through the real helper process (self-test passed)', () => {
  it('stores a JPEG as three clean WebP variants, the row and its audit entry', async () => {
    const { service, storage, metrics } = route(await startHelper(passing));
    const response = await service.handle(upload(corpus('jpeg-large.jpg')));
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.value).toMatchObject({ width: 1600, variantWidths: [400, 800, 1600] });
    const objects = (await storage.list('public', 'img/')).map((o) => o.objectKey).sort();
    expect(objects).toHaveLength(3);
    expect(objects.map((key) => key.split('/').pop())).toEqual([
      '1600.webp',
      '400.webp',
      '800.webp',
    ]);
    expect(metrics.gaugeValue('catalog_image_helper_isolation_ok')).toBe(1);
    const { rows } = await s.t.pool.query('SELECT width FROM catalog_image WHERE image_id = $1', [
      body.value?.imageId,
    ]);
    expect(rows[0]).toEqual({ width: 1600 });
  });

  it('strips EXIF and GPS: the stored variants of a geotagged photo are clean WebP', async () => {
    const storage = createMemoryImageStorage(systemClock);
    const captured: Uint8Array[] = [];
    const recording: ImageStorage = {
      ...storage,
      async put(bucket, key, bytes) {
        captured.push(bytes);
        await storage.put(bucket, key, bytes);
      },
    };
    const { service } = route(await startHelper(passing), { storage: recording });
    const response = await service.handle(upload(corpus('jpeg-exif-gps-orient6.jpg')));
    expect(response.status).toBe(201);
    expect(captured.length).toBeGreaterThan(0);
    for (const bytes of captured) {
      expect(isCleanWebp(bytes)).toBe(true);
      const meta = await sharp(bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect([meta.width, meta.height]).toEqual([32, 64]);
    }
  });

  it('refuses an animated WebP with imageType and a decompression bomb with imageUnreadable', async () => {
    const before = (await s.t.pool.query('SELECT count(*)::int AS n FROM catalog_image')).rows[0]
      ?.n;
    const { service, storage } = route(await startHelper(passing));
    expect(
      (await json(await service.handle(upload(corpus('webp-animated.webp'))))).error?.i18nKey,
    ).toBe('errors.catalog.imageType');
    expect((await json(await service.handle(upload(corpus('png-bomb.png'))))).error?.i18nKey).toBe(
      'errors.catalog.imageUnreadable',
    );
    expect(await storage.list('public', 'img/')).toEqual([]);
    const after = (await s.t.pool.query('SELECT count(*)::int AS n FROM catalog_image')).rows[0]?.n;
    expect(after).toBe(before);
  });
});

describe('the INF-203 gate', () => {
  it('fails closed when a helper check failed: imageUnreadable, gauge 0, nothing stored', async () => {
    const failing = { ...passing, checks: { ...passing.checks, networkUnreachable: false } };
    const { service, storage, metrics } = route(await startHelper(failing));
    const response = await service.handle(upload(corpus('jpeg-small.jpg')));
    expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
    expect(metrics.gaugeValue('catalog_image_helper_isolation_ok')).toBe(0);
    expect(await storage.list('public', 'img/')).toEqual([]);
  });

  it('fails closed when no helper listens on the socket', async () => {
    const { service, metrics } = route(socketPath());
    const response = await service.handle(upload(corpus('jpeg-small.jpg')));
    expect((await json(response)).error?.i18nKey).toBe('errors.catalog.imageUnreadable');
    expect(metrics.gaugeValue('catalog_image_helper_isolation_ok')).toBe(0);
  });

  it('the helper itself refuses a job before its self-test ran, and closes on an oversized frame', async () => {
    const path = await startHelper(passing);
    const send = (frame: Uint8Array) =>
      new Promise<string>((resolve) => {
        const socket = createConnection(path);
        let reply = '';
        socket.once('connect', () => socket.write(frame));
        socket.on('data', (chunk) => {
          reply += chunk.toString('latin1');
          socket.destroy();
          resolve(reply);
        });
        socket.once('close', () => resolve(reply === '' ? 'closed' : reply));
      });
    const job = await send(
      encodeFrame({ type: 'job', jobId: 'early', sniffedFormat: 'jpeg' }, corpus('jpeg-small.jpg')),
    );
    expect(job).toContain('"ok":false');
    expect(job).toContain('imageUnreadable');
    const oversized = new Uint8Array(4);
    new DataView(oversized.buffer).setUint32(0, 6_000_000);
    expect(await send(oversized)).toBe('closed');
  });
});
