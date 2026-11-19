// Live classes (U8): a course's scheduled YouTube Live class, who attended and for how long, and
// pop-quizzes fired during the class. Cross-unit IDs (course, user, question) are not foreign keys.
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
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const liveClass = pgTable(
  'live_class',
  {
    liveClassId: uuid('live_class_id').primaryKey().defaultRandom(), // C1
    courseId: uuid('course_id').notNull(), // C1
    titleBn: text('title_bn').notNull(), // C1
    titleEn: text('title_en').notNull(), // C1
    youtubeVideoId: text('youtube_video_id').notNull(), // C1
    startsAt: ts('starts_at').notNull(), // C1
    durationMinutes: integer('duration_minutes').notNull(), // C1
    isCancelled: boolean('is_cancelled').notNull().default(false), // C1
    /** After the class, keep the YouTube video on the page as a recording (FR-LIVE-1: opt-in). */
    keepsRecording: boolean('keeps_recording').notNull().default(false), // C1
    createdBy: uuid('created_by').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check(
      'live_class_title_ck',
      sql`char_length(${t.titleBn}) between 1 and 150 and char_length(${t.titleEn}) between 1 and 150`,
    ),
    check('live_class_video_ck', sql`${t.youtubeVideoId} ~ '^[A-Za-z0-9_-]{11}$'`),
    check('live_class_duration_ck', sql`${t.durationMinutes} between 10 and 300`),
    index('live_class_course_idx').on(t.courseId, t.startsAt),
    index('live_class_starts_idx').on(t.startsAt),
  ],
);

export const liveAttendance = pgTable(
  'live_attendance',
  {
    liveClassId: uuid('live_class_id')
      .notNull()
      .references(() => liveClass.liveClassId, { onDelete: 'cascade' }), // C2
    userId: uuid('user_id').notNull(), // C3
    firstJoinAt: ts('first_join_at').notNull(), // C3
    lastSeenAt: ts('last_seen_at').notNull(), // C3
    /** Seconds with the class tab visible (attentiveness proxy, FR-LIVE-1). */
    activeSeconds: integer('active_seconds').notNull().default(0), // C3
  },
  (t) => [
    primaryKey({ columns: [t.liveClassId, t.userId] }),
    check('live_attendance_active_ck', sql`${t.activeSeconds} >= 0`),
  ],
);

export const liveQuiz = pgTable(
  'live_quiz',
  {
    quizId: uuid('quiz_id').primaryKey().defaultRandom(), // C2
    liveClassId: uuid('live_class_id')
      .notNull()
      .references(() => liveClass.liveClassId, { onDelete: 'cascade' }), // C2
    questionIds: uuid('question_ids').array().notNull(), // C2
    startedAt: ts('started_at').notNull(), // C2
    startedBy: uuid('started_by').notNull(), // C3
    /** When the top-N streak-shields were handed out, once the quiz was over (US5.6). */
    shieldsAwardedAt: ts('shields_awarded_at'), // C2
  },
  (t) => [
    check('live_quiz_count_ck', sql`cardinality(${t.questionIds}) between 1 and 10`),
    index('live_quiz_class_idx').on(t.liveClassId, t.startedAt),
  ],
);

export const liveQuizAnswer = pgTable(
  'live_quiz_answer',
  {
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => liveQuiz.quizId, { onDelete: 'cascade' }), // C2
    userId: uuid('user_id').notNull(), // C3
    questionId: uuid('question_id').notNull(), // C2
    chosenIndex: integer('chosen_index').notNull(), // C3
    isCorrect: boolean('is_correct').notNull(), // C3
    answeredAt: ts('answered_at').notNull().defaultNow(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.quizId, t.userId, t.questionId] }),
    check('live_quiz_answer_choice_ck', sql`${t.chosenIndex} between 0 and 3`),
  ],
);
