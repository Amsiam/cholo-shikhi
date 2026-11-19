// OD-207 counters. Publishes are counted from U1's audit log by actor (bounded); link refusals use a
// rate_limit_bucket-style hourly counter keyed by a keyed hash of the instructor ID, with no limit
// applied (it counts, it never refuses).
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/audit.ts';
import { rateLimitBucket, staffRoleAssignment } from '#src/server/schema/index.ts';

const MAX_ACTORS = 500;
const MAX_ADMINS = 100;

export function createModerationRepository() {
  return {
    /** The current Admins (U1 staff role assignments that are not revoked), as Goals reads them. */
    async adminUserIds(exec: Executor): Promise<string[]> {
      const rows = await exec
        .select({ userId: staffRoleAssignment.userId })
        .from(staffRoleAssignment)
        .where(and(eq(staffRoleAssignment.role, 'admin'), isNull(staffRoleAssignment.revokedAt)))
        .limit(MAX_ADMINS);
      return rows.map((r) => r.userId);
    },

    /** Publishes and republishes of courses per actor since `since` (the Dhaka day start). */
    async publishCountsSince(
      exec: Executor,
      since: Date,
    ): Promise<Array<{ actorId: string; publishes: number }>> {
      const rows = await exec
        .select({ actorId: auditLogEntry.actorId, publishes: sql<number>`count(*)::int` })
        .from(auditLogEntry)
        .where(
          sql`${auditLogEntry.action} = 'catalog.course.published' AND ${auditLogEntry.occurredAt} >= ${since}`,
        )
        .groupBy(auditLogEntry.actorId)
        .limit(MAX_ACTORS);
      return rows.map((r) => ({ actorId: r.actorId, publishes: Number(r.publishes) }));
    },

    /** Counts one link refusal in the hour window that starts at `windowStart`; returns the count. */
    async countLinkRefusal(exec: Executor, bucketKey: string, windowStart: Date): Promise<number> {
      const t = rateLimitBucket;
      const result = await exec.execute<{ failure_count: number | string }>(sql`
        INSERT INTO ${t} (bucket_key, action, window_started_at, failure_count)
        VALUES (${bucketKey}, 'catalog_link_refusals', ${windowStart}, 1)
        ON CONFLICT (bucket_key) DO UPDATE SET
          window_started_at = EXCLUDED.window_started_at,
          failure_count = CASE WHEN ${t}.window_started_at < EXCLUDED.window_started_at
            THEN 1 ELSE ${t}.failure_count + 1 END
        RETURNING failure_count`);
      return Number(result.rows[0]?.failure_count ?? 0);
    },
  };
}
