// Object storage port. Production uses Bangladesh-hosted S3-compatible storage (TS-15, product chosen
// at Infrastructure Design); locally files go to .rendered/ (gitignored).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ObjectStore = {
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or null when there is none. */
  get(objectKey: string): Promise<Buffer | null>;
  delete(objectKey: string): Promise<void>;
};

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;

export function createFileObjectStore(
  root: URL = new URL('../../../../.rendered/', import.meta.url),
): ObjectStore {
  const pathOf = (objectKey: string) => {
    if (!SAFE_KEY.test(objectKey) || objectKey.includes('..'))
      throw new Error('invalid object key');
    return fileURLToPath(new URL(objectKey, root));
  };
  return {
    async put(objectKey, body) {
      const path = pathOf(objectKey);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    },
    async get(objectKey) {
      const path = pathOf(objectKey);
      return existsSync(path) ? readFileSync(path) : null;
    },
    async delete(objectKey) {
      rmSync(pathOf(objectKey), { force: true });
    },
  };
}
