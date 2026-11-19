// Retention rewards (U5): streak-tokens, streak-shields and extra qualifying activity.
// - token_account holds each Student's balance; it can never go below 0 (US5.16).
// - token_entry is the append-only token ledger: one row per credit or debit, unique per
//   (user, reason, ref), so a daily credit, a battle entry or its refund happens at most once.
// - streak_shield: one row per shield earned (a live pop-quiz top-N finish). A used shield records
//   the Asia/Dhaka day it forgave; one shield per day, and each shield is used at most once.
// - streak_activity: qualifying activity that has no table of its own in Learning (live-class
//   attendance), one row per Student, course, kind and day.
// - buddy_invite, buddy_pair, buddy_member: study buddies (FR5.6).
// Cross-unit IDs (users, courses, quizzes, battles) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const TOKEN_REASONS = [
  'daily',
  'battle_entry',
  'battle_refund',
  'buddy_bonus',
  'admin',
] as const;
export type TokenReason = (typeof TOKEN_REASONS)[number];

export const tokenAccount = pgTable(
  'token_account',
  {
    userId: uuid('user_id').primaryKey(), // C3
    balance: integer('balance').notNull().default(0), // C3
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [check('token_account_balance_ck', sql`${t.balance} >= 0`)],
);

export const tokenEntry = pgTable(
  'token_entry',
  {
    entryId: uuid('entry_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    delta: integer('delta').notNull(), // C3
    reason: text('reason', { enum: TOKEN_REASONS }).notNull(), // C2
    /** What the entry is for: a YYYY-MM-DD day for daily credits, a battle ID for entries. */
    ref: text('ref').notNull(), // C2
    balanceAfter: integer('balance_after').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C3
  },
  (t) => [
    check('token_entry_delta_ck', sql`${t.delta} <> 0`),
    check(
      'token_entry_reason_ck',
      sql`${t.reason} in ('daily', 'battle_entry', 'battle_refund', 'buddy_bonus', 'admin')`,
    ),
    check('token_entry_balance_ck', sql`${t.balanceAfter} >= 0`),
    unique('token_entry_once_uq').on(t.userId, t.reason, t.ref),
    index('token_entry_user_idx').on(t.userId, t.createdAt),
  ],
);

export const streakShield = pgTable(
  'streak_shield',
  {
    shieldId: uuid('shield_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    source: text('source', { enum: ['live_quiz', 'admin'] }).notNull(), // C2
    /** The live quiz ID the shield was won in. */
    sourceRef: text('source_ref').notNull(), // C2
    earnedAt: ts('earned_at').notNull(), // C3
    /** The Asia/Dhaka day (YYYY-MM-DD) this shield forgave; null while it is available. */
    usedForDay: text('used_for_day'), // C3
    usedAt: ts('used_at'), // C3
  },
  (t) => [
    check('streak_shield_source_ck', sql`${t.source} in ('live_quiz', 'admin')`),
    check(
      'streak_shield_day_ck',
      sql`${t.usedForDay} is null or ${t.usedForDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    unique('streak_shield_once_uq').on(t.userId, t.source, t.sourceRef),
    uniqueIndex('streak_shield_day_uq')
      .on(t.userId, t.usedForDay)
      .where(sql`${t.usedForDay} is not null`),
    index('streak_shield_user_idx').on(t.userId, t.earnedAt),
  ],
);

export const streakActivity = pgTable(
  'streak_activity',
  {
    userId: uuid('user_id').notNull(), // C3
    courseId: uuid('course_id').notNull(), // C2
    kind: text('kind', { enum: ['live'] }).notNull(), // C2
    /** The Asia/Dhaka day (YYYY-MM-DD). */
    day: text('day').notNull(), // C3
    at: ts('at').notNull(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.courseId, t.kind, t.day] }),
    check('streak_activity_kind_ck', sql`${t.kind} in ('live')`),
    check('streak_activity_day_ck', sql`${t.day} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

/**
 * Study buddy invites (US5.12): a Student shares a six-character code; a friend in the same
 * Goal-segment enters it and accepts. An invite is used once and expires after a week.
 */
export const buddyInvite = pgTable(
  'buddy_invite',
  {
    inviteId: uuid('invite_id').primaryKey().defaultRandom(), // C2
    inviterId: uuid('inviter_id').notNull(), // C3
    code: text('code').notNull(), // C2
    segmentId: uuid('segment_id').notNull(), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    expiresAt: ts('expires_at').notNull(), // C2
    acceptedBy: uuid('accepted_by'), // C3
    closedAt: ts('closed_at'), // C2
  },
  (t) => [
    check('buddy_invite_code_ck', sql`${t.code} ~ '^[A-Z0-9]{6}$'`),
    uniqueIndex('buddy_invite_open_code_uq').on(t.code).where(sql`${t.closedAt} is null`),
    index('buddy_invite_inviter_idx').on(t.inviterId, t.createdAt),
  ],
);

/**
 * A study buddy pair (FR5.6). Active on Asia/Dhaka days from `starts_day` up to, not including,
 * `ends_day`; ending a pair sets `ends_day` to tomorrow, so today's bonus still counts (US5.14).
 */
export const buddyPair = pgTable(
  'buddy_pair',
  {
    pairId: uuid('pair_id').primaryKey().defaultRandom(), // C2
    segmentId: uuid('segment_id').notNull(), // C2
    startsDay: text('starts_day').notNull(), // C3
    endsDay: text('ends_day'), // C3
    endedBy: uuid('ended_by'), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [check('buddy_pair_days_ck', sql`${t.endsDay} is null or ${t.endsDay} > ${t.startsDay}`)],
);

/** The two members of a pair. A Student is in at most one pair that has not been ended. */
export const buddyMember = pgTable(
  'buddy_member',
  {
    pairId: uuid('pair_id')
      .notNull()
      .references(() => buddyPair.pairId, { onDelete: 'cascade' }), // C2
    userId: uuid('user_id').notNull(), // C3
    isOpen: boolean('is_open').notNull().default(true), // C2
  },
  (t) => [
    primaryKey({ columns: [t.pairId, t.userId] }),
    uniqueIndex('buddy_member_open_uq').on(t.userId).where(sql`${t.isOpen}`),
    index('buddy_member_user_idx').on(t.userId),
  ],
);
