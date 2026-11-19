// Stored monthly earnings statements (US7.8 monthly; FR7.4). Once an Asia/Dhaka month has ended, the
// first view of an instructor's statement stores it (CSV in Bangla and English) as version 1. If the
// ledger later changes for that month (a late or back-dated posting), the next view stores a new
// version; earlier versions are never changed. Kept until `retain_until` (at least 10 years).
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const earningsStatement = pgTable(
  'earnings_statement',
  {
    statementId: uuid('statement_id').primaryKey().defaultRandom(), // C2
    instructorId: uuid('instructor_id').notNull(), // C3
    month: text('month').notNull(), // C2
    version: integer('version').notNull(), // C2
    locale: text('locale', { enum: ['bn', 'en'] }).notNull(), // C2
    objectKey: text('object_key').notNull(), // C3
    /** SHA-256 of the statement's content in its language; a new version is stored when it changes. */
    sha256: text('sha256').notNull(), // C2
    createdAt: ts('created_at').notNull(), // C2
    retainUntil: ts('retain_until').notNull(), // C2
  },
  (t) => [
    unique('earnings_statement_version_uq').on(t.instructorId, t.month, t.version, t.locale),
    check('earnings_statement_month_ck', sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check('earnings_statement_version_ck', sql`${t.version} >= 1`),
    check('earnings_statement_retention_ck', sql`${t.retainUntil} > ${t.createdAt}`),
    index('earnings_statement_instructor_idx').on(t.instructorId, t.month),
  ],
);
