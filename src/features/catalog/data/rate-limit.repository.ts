// Authoring rate limits in U1's PostgreSQL fixed-window store `rate_limit_bucket` (SD-218, NFR6.216),
// on the exact synchronous upsert path (foundation PD-5): one statement either counts the attempt
// or, when the window is full, changes nothing and returns no row. Keys are an action plus a keyed
// hash of the instructor ID; no raw identifier is stored.
import { sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { rateLimitBucket } from '#src/server/schema/index.ts';

export type WindowSpec = {
  bucketKey: string;
  action: string;
  limit: number;
  /** The start recorded for a fresh window. */
  windowStart: Date;
  /** A stored window that started at or before this instant has expired. */
  expiredAtOrBefore: Date;
};

export function createRateLimitRepository() {
  return {
    /** Counts one attempt; returns false (and writes nothing) when the window is already full. */
    async consume(exec: Executor, spec: WindowSpec): Promise<boolean> {
      const t = rateLimitBucket;
      const result = await exec.execute(sql`
        INSERT INTO ${t} (bucket_key, action, window_started_at, failure_count)
        VALUES (${spec.bucketKey}, ${spec.action}, ${spec.windowStart}, 1)
        ON CONFLICT (bucket_key) DO UPDATE SET
          window_started_at = CASE WHEN ${t}.window_started_at <= ${spec.expiredAtOrBefore}
            THEN EXCLUDED.window_started_at ELSE ${t}.window_started_at END,
          failure_count = CASE WHEN ${t}.window_started_at <= ${spec.expiredAtOrBefore}
            THEN 1 ELSE ${t}.failure_count + 1 END
        WHERE ${t}.window_started_at <= ${spec.expiredAtOrBefore} OR ${t}.failure_count < ${spec.limit}
        RETURNING failure_count`);
      return result.rows.length === 1;
    },
    /** When the current window of a full bucket started (for the retry-after time). */
    async windowStartedAt(exec: Executor, bucketKey: string): Promise<Date | undefined> {
      const result = await exec.execute<{ window_started_at: string | Date }>(
        sql`SELECT window_started_at FROM ${rateLimitBucket} WHERE bucket_key = ${bucketKey}`,
      );
      const value = result.rows[0]?.window_started_at;
      return value === undefined ? undefined : new Date(value);
    },
  };
}

export type RateLimitRepository = ReturnType<typeof createRateLimitRepository>;
