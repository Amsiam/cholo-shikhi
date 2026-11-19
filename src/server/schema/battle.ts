// Battle (U7): quick matches, friend rooms and staff-hosted battles. Matching stays inside one battle
// band. Every player gets the same questions and time. Cross-unit IDs (goal, user, topic, question)
// are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const battle = pgTable(
  'battle',
  {
    battleId: uuid('battle_id').primaryKey().defaultRandom(), // C2
    mode: text('mode', { enum: ['quick', 'friend', 'hosted'] }).notNull(), // C2
    status: text('status', { enum: ['waiting', 'running', 'finished', 'cancelled'] })
      .notNull()
      .default('waiting'), // C2
    /** The tier: the battle band of the goal's segment. */
    band: text('band').notNull(), // C1
    goalId: uuid('goal_id').notNull(), // C1
    hostId: uuid('host_id').notNull(), // C3
    /** Friend rooms: the code friends type to join. */
    code: text('code'), // C2
    titleBn: text('title_bn'), // C1
    titleEn: text('title_en'), // C1
    topicId: uuid('topic_id'), // C1
    source: text('source', { enum: ['bank', 'vault'] })
      .notNull()
      .default('bank'), // C2
    questionCount: integer('question_count').notNull(), // C1
    durationSeconds: integer('duration_seconds').notNull(), // C1
    maxPlayers: integer('max_players').notNull(), // C2
    questionIds: uuid('question_ids').array().notNull().default(sql`'{}'::uuid[]`), // C2
    startsAt: ts('starts_at'), // C1
    endsAt: ts('ends_at'), // C1
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('battle_mode_ck', sql`${t.mode} in ('quick', 'friend', 'hosted')`),
    check('battle_status_ck', sql`${t.status} in ('waiting', 'running', 'finished', 'cancelled')`),
    check('battle_source_ck', sql`${t.source} in ('bank', 'vault')`),
    check('battle_count_ck', sql`${t.questionCount} between 1 and 50`),
    check('battle_duration_ck', sql`${t.durationSeconds} between 30 and 3600`),
    check('battle_players_ck', sql`${t.maxPlayers} between 2 and 500`),
    check(
      'battle_hosted_ck',
      sql`${t.mode} <> 'hosted' or (${t.startsAt} is not null and ${t.titleEn} is not null)`,
    ),
    check('battle_friend_code_ck', sql`${t.mode} <> 'friend' or ${t.code} is not null`),
    uniqueIndex('battle_open_code_uq')
      .on(t.code)
      .where(sql`${t.code} is not null and ${t.status} = 'waiting'`),
    index('battle_queue_idx').on(t.mode, t.status, t.band, t.createdAt),
    index('battle_hosted_idx').on(t.band, t.status, t.startsAt),
  ],
);

export const battlePlayer = pgTable(
  'battle_player',
  {
    battleId: uuid('battle_id')
      .notNull()
      .references(() => battle.battleId, { onDelete: 'cascade' }), // C2
    userId: uuid('user_id').notNull(), // C3
    joinedAt: ts('joined_at').notNull().defaultNow(), // C3
    answers: jsonb('answers').$type<Record<string, number>>().notNull().default({}), // C3
    correctCount: integer('correct_count'), // C3
    finishedAt: ts('finished_at'), // C3
    settledAt: ts('settled_at'), // C2
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.userId] }),
    index('battle_player_user_idx').on(t.userId, t.joinedAt),
  ],
);
