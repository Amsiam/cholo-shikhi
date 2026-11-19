// Audit log reads and partition maintenance. Rows are never updated or deleted (BR7.3).
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/index.ts';

export type AuditFilter = {
  page: number;
  pageSize: number;
  subjectType?: string;
  subjectId?: string;
  action?: string;
};

export function createAuditRepository() {
  return {
    async list(db: Executor, filter: AuditFilter) {
      const where = and(
        filter.subjectType ? eq(auditLogEntry.subjectType, filter.subjectType) : undefined,
        filter.subjectId ? eq(auditLogEntry.subjectId, filter.subjectId) : undefined,
        filter.action ? eq(auditLogEntry.action, filter.action) : undefined,
      );
      const rows = await db
        .select()
        .from(auditLogEntry)
        .where(where)
        .orderBy(desc(auditLogEntry.occurredAt))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize);
      const [total] = await db.select({ n: count() }).from(auditLogEntry).where(where);
      return { rows, total: total?.n ?? 0 };
    },

    /** Child partitions of audit_log_entry in the current schema. */
    async listPartitions(db: Executor): Promise<string[]> {
      const result = await db.execute<{ name: string }>(sql`
        SELECT c.relname AS name FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_log_entry' AND p.relnamespace = to_regnamespace(current_schema())::oid`);
      return result.rows.map((r) => r.name);
    },

    async dropPartition(db: Executor, name: string): Promise<void> {
      if (!/^audit_log_entry_y\d{4}$/.test(name)) throw new Error(`refusing to drop ${name}`);
      await db.execute(sql.raw(`DROP TABLE "${name}"`));
    },

    async ensurePartition(db: Executor, year: number): Promise<void> {
      if (!Number.isInteger(year) || year < 2000 || year > 2999)
        throw new Error(`bad partition year ${year}`);
      await db.execute(
        sql.raw(
          `CREATE TABLE IF NOT EXISTS "audit_log_entry_y${year}" PARTITION OF "audit_log_entry" FOR VALUES FROM ('${year}-01-01T00:00:00Z') TO ('${year + 1}-01-01T00:00:00Z')`,
        ),
      );
    },
  };
}
