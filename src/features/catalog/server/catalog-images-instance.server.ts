// The process-wide image upload route service (Steps 44 and 45), wired to the app's ports. The
// helper is the socket client to the image-helper process (IMAGE_HELPER_SOCKET_PATH); storage stays
// the in-memory local stub until the deferred image infrastructure (Step 47) exists, and
// catalog.imageUploads stays off (turning it on is the human's decision, INF §3.4).
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { createAudit, flags } from '#src/features/platform/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { HELPER_ENV_ALLOWLIST } from '../domain/image-isolation.ts';
import { createImageUploads, type ImageUploads } from './catalog-images.server.ts';
import { getCatalog } from './catalog-instance.server.ts';
import { createImageAdmission } from './image-admission.ts';
import { createSocketHelperClient } from './image-helper-client.server.ts';
import {
  createMemoryImageStorage,
  type HelperClient,
  type ImageStorage,
} from './image-ports.server.ts';
import { IMAGE_PROCESSING_SLOTS, IMAGE_WAITING_SLOTS } from './limits.ts';

let storage: ImageStorage | undefined;
let shared: ImageUploads | undefined;

/** The local image storage stub of this process (SD-217 buckets need Step 47). */
export function getImageStorage(): ImageStorage {
  storage ??= createMemoryImageStorage(systemClock);
  return storage;
}

/** INF-203 probe address that must be unreachable from the helper (one public address). */
const PUBLIC_PROBE_HOST = '1.1.1.1';

function socketHelper(): HelperClient {
  const env = getEnv();
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  return createSocketHelperClient({
    socketPath: env.IMAGE_HELPER_SOCKET_PATH,
    targets: {
      privateHost: new URL(env.DATABASE_URL).hostname,
      publicHost: PUBLIC_PROBE_HOST,
      webEnvFilePath: resolve(process.cwd(), '.env'),
    },
    webUid: process.getuid?.() ?? -1,
    // Hashes only, computed here and never sent: the helper's hashes are compared against them.
    webSecretValueHashes: Object.entries(process.env)
      .filter(([key, value]) => !HELPER_ENV_ALLOWLIST.includes(key) && typeof value === 'string')
      .map(([, value]) => sha256(value as string)),
    socketOwnerUid: (path) =>
      stat(path).then(
        (s) => s.uid,
        () => null,
      ),
    metrics,
    log: getLogger().child({ component: 'catalog' }),
  });
}

export function getImageUploads(): ImageUploads {
  if (!shared) {
    const catalog = getCatalog();
    shared = createImageUploads({
      db: getDb(),
      clock: systemClock,
      audit: createAudit({ clock: systemClock }),
      log: getLogger().child({ component: 'catalog' }),
      metrics,
      getActor: (request) => getIdentity().getActor(request),
      isFlagEnabled: (flagKey, ctx) => flags().isEnabled(flagKey, ctx),
      trustedOrigins: () => getEnv().TRUSTED_ORIGINS,
      owners: {
        assertSectionOwner: (actor, sectionId) => catalog.assertSectionOwner(actor, sectionId),
        assertCourseLead: (actor, courseId) => catalog.assertCourseLead(actor, courseId),
        admitAuthoring: (actor) => catalog.admitAuthoring(actor),
      },
      helper: socketHelper(),
      storage: getImageStorage(),
      admission: createImageAdmission({
        processing: IMAGE_PROCESSING_SLOTS,
        waiting: IMAGE_WAITING_SLOTS,
      }),
    });
  }
  return shared;
}
