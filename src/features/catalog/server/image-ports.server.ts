// Ports of the image pipeline (Steps 44 and 46).
// - HelperClient: the decoder sandbox (SD-216). The app's adapter is the socket client to the
//   image-helper process (image-helper-client.server.ts); `unavailableHelperClient` remains for tests
//   and as the explicit fail-closed adapter. Neither path uses `--permission` (INF-201 §3.1).
// - ImageStorage: the public and quarantine buckets (SD-217, SD-220). The buckets need the deferred
//   image infrastructure (Step 47); until then the only adapter is this in-memory local stub.
import type { AppError } from '#src/lib/errors.ts';
import { err, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type ImageFormat, imageRefusal } from '../domain/image.ts';

export type ProcessedImage = {
  width: number;
  height: number;
  variants: ReadonlyArray<{ width: number; bytes: Uint8Array }>;
};

export type HelperJob = { jobId: string; bytes: Uint8Array; sniffedFormat: ImageFormat };

export type HelperClient = {
  /** INF-203: the instance's isolation gate; false means fail closed before reading the body. */
  isReady(): Promise<boolean>;
  process(job: HelperJob): Promise<Result<ProcessedImage, AppError<'VALIDATION_FAILED'>>>;
};

/** The explicit fail-closed adapter: never ready, never stores (RD-210 wording). */
export const unavailableHelperClient: HelperClient = {
  async isReady() {
    return false;
  },
  async process() {
    return err(imageRefusal('imageUnreadable'));
  },
};

export type ImageBucket = 'public' | 'quarantine';

export type ImageStorage = {
  put(bucket: ImageBucket, objectKey: string, body: Uint8Array): Promise<void>;
  exists(bucket: ImageBucket, objectKey: string): Promise<boolean>;
  /** Copies an object to the other bucket under the same key (a restore keeps cached URLs, SD-220). */
  copy(from: ImageBucket, to: ImageBucket, objectKey: string): Promise<void>;
  delete(bucket: ImageBucket, objectKey: string): Promise<void>;
  list(
    bucket: ImageBucket,
    prefix: string,
  ): Promise<ReadonlyArray<{ objectKey: string; createdAt: Date }>>;
};

/** Local stub of the two buckets (no network, no disk). One per process; tests build their own. */
export function createMemoryImageStorage(clock: Clock): ImageStorage {
  const buckets: Record<ImageBucket, Map<string, { body: Uint8Array; createdAt: Date }>> = {
    public: new Map(),
    quarantine: new Map(),
  };
  return {
    async put(bucket, objectKey, body) {
      buckets[bucket].set(objectKey, { body: body.slice(), createdAt: new Date(clock.now()) });
    },
    async exists(bucket, objectKey) {
      return buckets[bucket].has(objectKey);
    },
    async copy(from, to, objectKey) {
      const source = buckets[from].get(objectKey);
      if (!source) throw new Error(`image object missing from the ${from} bucket`);
      buckets[to].set(objectKey, { body: source.body.slice(), createdAt: source.createdAt });
    },
    async delete(bucket, objectKey) {
      buckets[bucket].delete(objectKey);
    },
    async list(bucket, prefix) {
      return [...buckets[bucket].entries()]
        .filter(([objectKey]) => objectKey.startsWith(prefix))
        .map(([objectKey, value]) => ({ objectKey, createdAt: value.createdAt }));
    },
  };
}
