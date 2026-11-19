// audit_log_entry: created by drizzle/0001_platform_custom.sql (yearly range partitions and an
// append-only trigger, BR7.3). Declared here for typed inserts and reads; drizzle-kit does not scan
// this file, so it never tries to (re)create the partitioned table.
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const auditLogEntry = pgTable('audit_log_entry', {
  auditEntryId: uuid('audit_entry_id').notNull().defaultRandom(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  correlationId: text('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
});
