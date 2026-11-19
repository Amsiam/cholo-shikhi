// Assessment (U4): the question bank. Subjects are linked to Goals; topics have one optional level of
// sub-topics; every question sits on a topic or sub-topic with a difficulty and an optional source
// note ("BCS 41 Preliminary"). Instructors and Admins write questions; an Instructor's question is
// reviewed by an Admin before Students see it; an Admin's own question publishes directly.
// Data class per column (NFR5.201). Cross-unit IDs (goal, user) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const BANK_QUESTION_STATUSES = [
  'draft',
  'in_review',
  'published',
  'rejected',
  'retired',
] as const;

export const subject = pgTable(
  'subject',
  {
    subjectId: uuid('subject_id').primaryKey().defaultRandom(), // C1
    nameBn: text('name_bn').notNull(), // C1
    nameEn: text('name_en').notNull(), // C1
    sortOrder: integer('sort_order').notNull().default(0), // C1
    isActive: boolean('is_active').notNull().default(true), // C1
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check(
      'subject_name_ck',
      sql`char_length(${t.nameBn}) between 1 and 80 and char_length(${t.nameEn}) between 1 and 80`,
    ),
  ],
);

/** Which Goals a subject belongs to (a BCS student sees BCS subjects). */
export const subjectGoal = pgTable(
  'subject_goal',
  {
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subject.subjectId, { onDelete: 'cascade' }), // C1
    goalId: uuid('goal_id').notNull(), // C1
  },
  (t) => [
    primaryKey({ columns: [t.subjectId, t.goalId] }),
    index('subject_goal_goal_idx').on(t.goalId),
  ],
);

export const topic = pgTable(
  'topic',
  {
    topicId: uuid('topic_id').primaryKey().defaultRandom(), // C1
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subject.subjectId, { onDelete: 'restrict' }), // C1
    /** Set for a sub-topic: its parent topic (one level only). */
    parentTopicId: uuid('parent_topic_id').references((): AnyPgColumn => topic.topicId, {
      onDelete: 'restrict',
    }), // C1
    nameBn: text('name_bn').notNull(), // C1
    nameEn: text('name_en').notNull(), // C1
    sortOrder: integer('sort_order').notNull().default(0), // C1
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check(
      'topic_name_ck',
      sql`char_length(${t.nameBn}) between 1 and 120 and char_length(${t.nameEn}) between 1 and 120`,
    ),
    check(
      'topic_not_own_parent_ck',
      sql`${t.parentTopicId} is null or ${t.parentTopicId} <> ${t.topicId}`,
    ),
    index('topic_subject_idx').on(t.subjectId, t.parentTopicId, t.sortOrder),
  ],
);

export const bankQuestion = pgTable(
  'bank_question',
  {
    questionId: uuid('question_id').primaryKey().defaultRandom(), // C1 published / C2 otherwise
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topic.topicId, { onDelete: 'restrict' }), // C1
    /** The teacher's difficulty: the prior for the measured one. */
    difficulty: text('difficulty', { enum: DIFFICULTIES }).notNull(), // C1
    /** Difficulty measured from Students' first attempts, blended with the teacher's (practice uses this). */
    effectiveDifficulty: text('effective_difficulty', { enum: DIFFICULTIES })
      .notNull()
      .default('medium'), // C1
    firstAttempts: integer('first_attempts').notNull().default(0), // C2
    firstCorrect: integer('first_correct').notNull().default(0), // C2
    promptBn: text('prompt_bn').notNull(), // C1
    promptEn: text('prompt_en').notNull(), // C1
    optionsBn: text('options_bn').array().notNull(), // C1
    optionsEn: text('options_en').array().notNull(), // C1
    correctIndex: integer('correct_index').notNull(), // C2, never sent before answering
    explanationBn: text('explanation_bn'), // C1
    explanationEn: text('explanation_en'), // C1
    sourceNote: text('source_note'), // C1
    /** US4.7: imported from a past paper (Students see "from past papers"), with its rights basis. */
    isPastPaper: boolean('is_past_paper').notNull().default(false), // C1
    rightsStatus: text('rights_status', { enum: ['public_domain', 'rights_cleared'] }), // C2
    /** US4.7: fingerprint of an imported question, so re-importing a file creates no duplicates. */
    importKey: text('import_key').unique(), // C2
    status: text('status', { enum: BANK_QUESTION_STATUSES }).notNull().default('draft'), // C2
    authorId: uuid('author_id').notNull(), // C3
    reviewedBy: uuid('reviewed_by'), // C3
    reviewedAt: ts('reviewed_at'), // C2
    reviewNote: text('review_note'), // C2
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check(
      'bank_question_options_ck',
      sql`cardinality(${t.optionsBn}) = 4 and cardinality(${t.optionsEn}) = 4`,
    ),
    check('bank_question_correct_ck', sql`${t.correctIndex} between 0 and 3`),
    check(
      'bank_question_past_paper_ck',
      sql`${t.isPastPaper} = (${t.rightsStatus} is not null) and (${t.rightsStatus} is null or ${t.rightsStatus} in ('public_domain', 'rights_cleared'))`,
    ),
    check(
      'bank_question_len_ck',
      sql`char_length(${t.promptBn}) <= 1000 and char_length(${t.promptEn}) <= 1000`,
    ),
    check(
      'bank_question_source_ck',
      sql`${t.sourceNote} is null or char_length(${t.sourceNote}) <= 120`,
    ),
    check(
      'bank_question_status_ck',
      sql`${t.status} in ('draft', 'in_review', 'published', 'rejected', 'retired')`,
    ),
    check('bank_question_difficulty_ck', sql`${t.difficulty} in ('easy', 'medium', 'hard')`),
    check('bank_question_attempts_ck', sql`${t.firstCorrect} between 0 and ${t.firstAttempts}`),
    check(
      'bank_question_effective_ck',
      sql`${t.effectiveDifficulty} in ('easy', 'medium', 'hard')`,
    ),
    index('bank_question_topic_idx').on(t.topicId, t.status, t.effectiveDifficulty),
    index('bank_question_author_idx').on(t.authorId, t.updatedAt),
    index('bank_question_review_idx').on(t.status, t.updatedAt),
  ],
);

/** Topic-wise practice answers (the Student's own history; wrong ones enter the Mistake Vault). */
export const bankAnswer = pgTable(
  'bank_answer',
  {
    bankAnswerId: uuid('bank_answer_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    questionId: uuid('question_id')
      .notNull()
      .references(() => bankQuestion.questionId, { onDelete: 'cascade' }), // C2
    chosenIndex: integer('chosen_index').notNull(), // C3
    isCorrect: boolean('is_correct').notNull(), // C3
    answeredAt: ts('answered_at').notNull().defaultNow(), // C3
  },
  (t) => [
    check('bank_answer_choice_ck', sql`${t.chosenIndex} between 0 and 3`),
    index('bank_answer_user_idx').on(t.userId, t.answeredAt),
    index('bank_answer_user_question_idx').on(t.userId, t.questionId),
    unique('bank_answer_once_uq').on(t.bankAnswerId),
  ],
);

// ------------------------------------------------------------------ exams
// A mock test (staff, retakes allowed), a scheduled live exam (staff, one attempt, merit list after
// the window) or a Student's own custom practice exam. Questions are chosen by the blueprint and
// frozen in question_ids when the exam is published.

export const EXAM_KINDS = ['mock', 'live', 'custom'] as const;
export const EXAM_STATUSES = ['draft', 'published', 'retired'] as const;

export const exam = pgTable(
  'exam',
  {
    examId: uuid('exam_id').primaryKey().defaultRandom(), // C1
    kind: text('kind', { enum: EXAM_KINDS }).notNull(), // C1
    status: text('status', { enum: EXAM_STATUSES }).notNull().default('draft'), // C2
    titleBn: text('title_bn').notNull(), // C1
    titleEn: text('title_en').notNull(), // C1
    /** Whose Students see it (null for a custom exam). */
    goalId: uuid('goal_id'), // C1
    /** Built from a published exam package version: only its buyers may take it. */
    packageVersionId: uuid('package_version_id'), // C2
    /** Attached to a course: only Students enrolled in it (or on its trial) may take it. */
    courseId: uuid('course_id'), // C1
    durationMinutes: integer('duration_minutes').notNull(), // C1
    /** Marks lost per wrong answer, in basis points of a mark (5000 = 0.5). */
    negativeBps: integer('negative_bps').notNull().default(0), // C1
    /** Live exams: when the window opens. */
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }), // C1
    blueprint: jsonb('blueprint')
      .$type<
        Array<{ topicId: string; difficulty: 'easy' | 'medium' | 'hard' | null; count: number }>
      >()
      .notNull()
      .default([]), // C2
    questionIds: uuid('question_ids').array().notNull().default(sql`'{}'::uuid[]`), // C2
    createdBy: uuid('created_by').notNull(), // C3
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }), // C1
    version: integer('version').notNull().default(1), // C2
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), // C2
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), // C2
  },
  (t) => [
    check('exam_kind_ck', sql`${t.kind} in ('mock', 'live', 'custom')`),
    check('exam_status_ck', sql`${t.status} in ('draft', 'published', 'retired')`),
    check(
      'exam_title_ck',
      sql`char_length(${t.titleBn}) between 1 and 150 and char_length(${t.titleEn}) between 1 and 150`,
    ),
    check('exam_duration_ck', sql`${t.durationMinutes} between 1 and 300`),
    check('exam_negative_ck', sql`${t.negativeBps} between 0 and 10000`),
    check('exam_questions_ck', sql`cardinality(${t.questionIds}) <= 200`),
    check('exam_live_start_ck', sql`${t.kind} <> 'live' or ${t.startsAt} is not null`),
    check('exam_goal_ck', sql`${t.kind} = 'custom' or ${t.goalId} is not null`),
    check('exam_published_ck', sql`${t.status} = 'draft' or cardinality(${t.questionIds}) >= 1`),
    index('exam_goal_idx').on(t.goalId, t.status, t.kind),
    index('exam_creator_idx').on(t.createdBy, t.updatedAt),
    index('exam_course_idx').on(t.courseId, t.status),
    uniqueIndex('exam_package_version_uq')
      .on(t.packageVersionId)
      .where(sql`${t.packageVersionId} is not null`),
    check('exam_course_kind_ck', sql`${t.courseId} is null or ${t.kind} <> 'custom'`),
  ],
);

export const examAttempt = pgTable(
  'exam_attempt',
  {
    attemptId: uuid('attempt_id').primaryKey().defaultRandom(), // C3
    examId: uuid('exam_id')
      .notNull()
      .references(() => exam.examId, { onDelete: 'cascade' }), // C2
    userId: uuid('user_id').notNull(), // C3
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(), // C3
    deadlineAt: timestamp('deadline_at', { withTimezone: true, mode: 'date' }).notNull(), // C3
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }), // C3
    /** questionId -> chosen option index. */
    answers: jsonb('answers').$type<Record<string, number>>().notNull().default({}), // C3
    correctCount: integer('correct_count'), // C3
    wrongCount: integer('wrong_count'), // C3
    skippedCount: integer('skipped_count'), // C3
    scoreX100: integer('score_x100'), // C3
    maxX100: integer('max_x100'), // C3
    /** When answers were recorded for difficulty and the Mistake Vault (live: after the window). */
    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }), // C2
  },
  (t) => [
    check('exam_attempt_deadline_ck', sql`${t.deadlineAt} > ${t.startedAt}`),
    index('exam_attempt_user_idx').on(t.userId, t.startedAt),
    index('exam_attempt_exam_idx').on(t.examId, t.scoreX100),
  ],
);
