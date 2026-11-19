// The process-wide Goals service, wired to the app's database and the U1 ports.
import { and, eq, isNull } from 'drizzle-orm';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit, outbox } from '#src/features/platform/index.ts';
import { getLogger } from '#src/lib/logger.ts';
import { systemClock } from '#src/lib/time.ts';
import { type Database, getDb } from '#src/server/db.ts';
import { staffRoleAssignment } from '#src/server/schema/index.ts';
import { createGoals, type Goals } from './goals.server.ts';

/**
 * BR2.3 recipients: every user with an active Admin role. Contract 3 has no "list Admins" read, so
 * this narrow, read-only query of U1's role table stands in for it (flagged at the Bolt 1 gate as a
 * candidate contract 3 addition).
 */
export function adminUserIdsFrom(db: Database) {
  return async (): Promise<string[]> => {
    const rows = await db
      .select({ userId: staffRoleAssignment.userId })
      .from(staffRoleAssignment)
      .where(and(eq(staffRoleAssignment.role, 'admin'), isNull(staffRoleAssignment.revokedAt)))
      .limit(100);
    return rows.map((r) => r.userId);
  };
}

let shared: Goals | undefined;

export function getGoals(): Goals {
  if (!shared) {
    const db = getDb();
    const notifications = getNotifications();
    shared = createGoals({
      db,
      clock: systemClock,
      audit: createAudit({ clock: systemClock }),
      outbox,
      notify: (tx, request, correlationId) => notifications.notify(tx, request, correlationId),
      listAdminUserIds: adminUserIdsFrom(db),
      log: getLogger().child({ component: 'goals' }),
    });
  }
  return shared;
}
