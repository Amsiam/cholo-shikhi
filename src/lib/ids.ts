// Contract 1 identifiers. Loaded by browser code too (shared Zod schemas), so no Node-only import:
// Web Crypto's randomUUID exists in browsers and in Node 24 alike.
import { z } from 'zod';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO 8601 in UTC with a Z suffix; shown in Asia/Dhaka by the UI. */
export const UtcInstant = z.iso.datetime();
export type UtcInstant = z.infer<typeof UtcInstant>;

export const IdempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:._-]+$/);
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}
