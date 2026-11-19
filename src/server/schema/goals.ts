// U2 Goals tables (entities.md: GoalSegment, Goal, StudentGoalSelection). Data class per column
// (NFR5.201): C1 public, C2 internal, C3 personal. The same classes are written as SQL column
// comments by migration 0004_u2_goals. Cross-unit IDs (user_id) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const goalSegment = pgTable(
  'goal_segment',
  {
    segmentId: uuid('segment_id').primaryKey().defaultRandom(), // C1
    nameBn: text('name_bn').notNull(), // C1
    nameEn: text('name_en').notNull(), // C1
    segmentType: text('segment_type', { enum: ['academic', 'job_aspirant'] }).notNull(), // C1
    battleBand: text('battle_band').notNull(), // C1
    sortOrder: integer('sort_order').notNull().default(0), // C1
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    // BR1.2: names unique across segments, case-insensitively after trimming.
    uniqueIndex('goal_segment_name_bn_uq').on(sql`lower(btrim(${t.nameBn}))`),
    uniqueIndex('goal_segment_name_en_uq').on(sql`lower(btrim(${t.nameEn}))`),
    check('goal_segment_type_ck', sql`${t.segmentType} in ('academic', 'job_aspirant')`),
    check('goal_segment_battle_band_ck', sql`${t.battleBand} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('goal_segment_sort_order_ck', sql`${t.sortOrder} >= 0`),
    check('goal_segment_version_ck', sql`${t.version} >= 1`),
  ],
);

export const goal = pgTable(
  'goal',
  {
    goalId: uuid('goal_id').primaryKey().defaultRandom(), // C1
    segmentId: uuid('segment_id') // C1
      .notNull()
      .references(() => goalSegment.segmentId, { onDelete: 'restrict' }),
    nameBn: text('name_bn').notNull(), // C1
    nameEn: text('name_en').notNull(), // C1
    status: text('status', { enum: ['inactive', 'active', 'retired'] }) // C1
      .notNull()
      .default('inactive'),
    sortOrder: integer('sort_order').notNull().default(0), // C1
    retiredAt: ts('retired_at'), // C2
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    // BR1.3: names unique within a segment, case-insensitively.
    uniqueIndex('goal_name_bn_uq').on(t.segmentId, sql`lower(btrim(${t.nameBn}))`),
    uniqueIndex('goal_name_en_uq').on(t.segmentId, sql`lower(btrim(${t.nameEn}))`),
    index('goal_status_idx').on(t.status, t.sortOrder),
    check('goal_status_ck', sql`${t.status} in ('inactive', 'active', 'retired')`),
    // BR1.4: retiredAt is set exactly when the Goal is retired.
    check('goal_retired_at_ck', sql`(${t.status} = 'retired') = (${t.retiredAt} is not null)`),
    check('goal_sort_order_ck', sql`${t.sortOrder} >= 0`),
    check('goal_version_ck', sql`${t.version} >= 1`),
  ],
);

export const studentGoalSelection = pgTable(
  'student_goal_selection',
  {
    goalSelectionId: uuid('goal_selection_id').primaryKey().defaultRandom(), // C3
    // U1 IdentityAccess user ID: opaque, deliberately not a foreign key (ADR-020).
    userId: uuid('user_id').notNull(), // C3
    goalId: uuid('goal_id') // C3
      .notNull()
      .references(() => goal.goalId, { onDelete: 'restrict' }),
    // Copied from the Goal at selection time (entities.md).
    segmentId: uuid('segment_id') // C3
      .notNull()
      .references(() => goalSegment.segmentId, { onDelete: 'restrict' }),
    selectedAt: ts('selected_at').notNull(), // C3
    endedAt: ts('ended_at'), // C3
    endReason: text('end_reason', { enum: ['changed'] }), // C3
  },
  (t) => [
    // BR2.4: at most one open selection (the current Goal) per student.
    uniqueIndex('student_goal_selection_open_uq').on(t.userId).where(sql`${t.endedAt} is null`),
    index('student_goal_selection_user_idx').on(t.userId, t.selectedAt),
    index('student_goal_selection_goal_idx').on(t.goalId),
    check('student_goal_selection_end_ck', sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    check(
      'student_goal_selection_end_reason_ck',
      sql`${t.endReason} is null or ${t.endReason} = 'changed'`,
    ),
  ],
);
