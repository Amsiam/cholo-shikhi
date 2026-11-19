// U2 Catalog core tables (entities.md: Course, Section, SectionVersion, Lesson, LessonVersion,
// SectionOwnership, SectionReview; security-design SD-211 BlockedDomain). Data class per column
// (NFR5.201): C1 public once published (C2 while a draft or working copy), C2 internal, C3 personal.
// The same classes are written as SQL column comments by migration 0005_u2_catalog_core, which also
// adds the immutability triggers (NFR6.206, SD-207) and the ownership no-overlap constraint trigger
// (RD-215). Migration 0008 adds the btree_gist exclusion constraint (Step 49, approved 2026-11-17),
// and the trigger stays as a second layer; 0009 adds the catalog_retention role and grants (Step 50).
// Cross-unit IDs (instructors, actors, U4 assets, U11 notices) are not foreign keys (ADR-020).
// Money is integer poisha in bigint columns, never numeric or real (project.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
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
import { goal } from './goals.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const COURSE_STATUSES = ['draft', 'published', 'unpublished', 'hidden', 'retired'] as const;
export const STRUCTURE_STATES = ['active', 'removal_pending', 'removed'] as const;
export const REVIEW_STATES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
  'discarded',
] as const;
export const OWNERSHIP_REASONS = [
  'default_lead',
  'assigned',
  'reassigned',
  'co_instructor_removed',
  'lead_changed',
] as const;
export const REVIEW_ACTIONS = [
  'submitted',
  'approved',
  'returned',
  'self_approved',
  'admin_approved',
  'reopened',
  'reset_by_reassignment',
  'published',
  'discarded',
] as const;

const inList = (values: readonly (string | number)[]) =>
  sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', '));

export const course = pgTable(
  'course',
  {
    courseId: uuid('course_id').primaryKey().defaultRandom(), // C1
    goalId: uuid('goal_id') // C1
      .notNull()
      .references(() => goal.goalId, { onDelete: 'restrict' }),
    titleBn: text('title_bn').notNull(), // C1 published / C2 draft
    titleEn: text('title_en').notNull(), // C1 published / C2 draft
    descriptionBn: text('description_bn'), // C1 published / C2 draft
    descriptionEn: text('description_en'), // C1 published / C2 draft
    coverImageKey: text('cover_image_key'), // C1
    leadInstructorId: uuid('lead_instructor_id'), // C3 (instructor identity on drafts)
    listPricePoisha: bigint('list_price_poisha', { mode: 'number' }), // C1
    accessDurationMonths: integer('access_duration_months'), // C1
    durationLockedAt: ts('duration_locked_at'), // C2
    status: text('status', { enum: COURSE_STATUSES }).notNull().default('draft'), // C2
    statusBeforeHidden: text('status_before_hidden', {
      enum: ['published', 'unpublished', 'retired'],
    }), // C2
    activeTakedownNoticeId: uuid('active_takedown_notice_id'), // C2
    firstPublishedAt: ts('first_published_at'), // C1
    lastPublishedAt: ts('last_published_at'), // C1
    unpublishedAt: ts('unpublished_at'), // C2
    retiredAt: ts('retired_at'), // C2
    pinRank: integer('pin_rank'), // C1
    createdBy: uuid('created_by').notNull(), // C3
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('course_status_ck', sql`${t.status} in (${inList(COURSE_STATUSES)})`),
    check(
      'course_status_before_hidden_ck',
      sql`(${t.status} = 'hidden') = (${t.statusBeforeHidden} is not null)`,
    ),
    check('course_price_ck', sql`${t.listPricePoisha} is null or ${t.listPricePoisha} >= 1`),
    check(
      'course_duration_ck',
      sql`${t.accessDurationMonths} is null or ${t.accessDurationMonths} in (4, 6, 12)`,
    ),
    check(
      'course_duration_lock_ck',
      sql`${t.durationLockedAt} is null or ${t.accessDurationMonths} is not null`,
    ),
    check(
      'course_title_len_ck',
      sql`char_length(${t.titleBn}) <= 150 and char_length(${t.titleEn}) <= 150`,
    ),
    check('course_pin_rank_ck', sql`${t.pinRank} is null or ${t.pinRank} >= 1`),
    check('course_version_ck', sql`${t.version} >= 1`),
    // PD-202: the S3 keyset read over published courses of a Goal (a takedown leaves the index).
    index('course_published_goal_idx')
      .on(t.goalId, t.pinRank, t.firstPublishedAt.desc(), t.courseId)
      .where(sql`${t.status} = 'published'`),
    // PD-202: listInstructorCourses and the I1 list.
    index('course_lead_idx').on(t.leadInstructorId, t.updatedAt.desc(), t.courseId),
    index('course_created_idx').on(t.createdAt.desc(), t.courseId),
  ],
);

export const section = pgTable(
  'section',
  {
    sectionId: uuid('section_id').primaryKey().defaultRandom(), // C1
    courseId: uuid('course_id') // C1
      .notNull()
      .references(() => course.courseId, { onDelete: 'restrict' }),
    position: integer('position').notNull(), // C1
    pendingPosition: integer('pending_position'), // C2
    structureState: text('structure_state', { enum: STRUCTURE_STATES }).notNull().default('active'), // C2
    removalRequestedAt: ts('removal_requested_at'), // C2
    removedAt: ts('removed_at'), // C2
    liveVersionId: uuid('live_version_id').references(
      (): AnyPgColumn => sectionVersion.sectionVersionId,
      {
        onDelete: 'restrict',
      },
    ), // C1
    workingVersionId: uuid('working_version_id').references(
      (): AnyPgColumn => sectionVersion.sectionVersionId,
      { onDelete: 'restrict' },
    ), // C2
    firstPublishedAt: ts('first_published_at'), // C1
    hiddenByTakedownNoticeId: uuid('hidden_by_takedown_notice_id'), // C2
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('section_position_ck', sql`${t.position} >= 1`),
    check(
      'section_pending_position_ck',
      sql`${t.pendingPosition} is null or ${t.pendingPosition} >= 1`,
    ),
    check('section_structure_state_ck', sql`${t.structureState} in (${inList(STRUCTURE_STATES)})`),
    check(
      'section_removed_at_ck',
      sql`(${t.structureState} = 'removed') = (${t.removedAt} is not null)`,
    ),
    check(
      'section_removal_requested_ck',
      sql`${t.structureState} <> 'removal_pending' or ${t.removalRequestedAt} is not null`,
    ),
    check('section_version_ck', sql`${t.version} >= 1`),
    index('section_course_position_idx').on(t.courseId, t.position),
  ],
);

export const sectionVersion = pgTable(
  'section_version',
  {
    sectionVersionId: uuid('section_version_id').primaryKey().defaultRandom(), // C1 / C2
    sectionId: uuid('section_id') // C1 / C2
      .notNull()
      .references(() => section.sectionId, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(), // C2
    titleBn: text('title_bn').notNull(), // C1 published / C2 working copy
    titleEn: text('title_en').notNull(), // C1 published / C2 working copy
    reviewState: text('review_state', { enum: REVIEW_STATES }).notNull().default('draft'), // C2
    basedOnVersionId: uuid('based_on_version_id'), // C2
    submittedAt: ts('submitted_at'), // C2
    approvedAt: ts('approved_at'), // C2
    publishedAt: ts('published_at'), // C1
    supersededAt: ts('superseded_at'), // C2
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('section_version_review_state_ck', sql`${t.reviewState} in (${inList(REVIEW_STATES)})`),
    check('section_version_number_ck', sql`${t.versionNumber} >= 1`),
    check(
      'section_version_title_len_ck',
      sql`char_length(${t.titleBn}) <= 150 and char_length(${t.titleEn}) <= 150`,
    ),
    check('section_version_version_ck', sql`${t.version} >= 1`),
    unique('section_version_number_uq').on(t.sectionId, t.versionNumber),
    // BR8.1: at most one live version and at most one working copy per section (PD-202).
    uniqueIndex('section_version_live_uq')
      .on(t.sectionId)
      .where(sql`${t.reviewState} = 'published'`),
    uniqueIndex('section_version_working_uq')
      .on(t.sectionId)
      .where(sql`${t.reviewState} in ('draft', 'in_review', 'approved')`),
    index('section_version_recent_idx').on(t.sectionId, t.createdAt.desc()),
  ],
);

export const lesson = pgTable(
  'lesson',
  {
    lessonId: uuid('lesson_id').primaryKey().defaultRandom(), // C1
    sectionId: uuid('section_id') // C1
      .notNull()
      .references(() => section.sectionId, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['video', 'text', 'quiz'] }).notNull(), // C1
    liveState: text('live_state', { enum: ['never_published', 'live', 'withdrawn'] })
      .notNull()
      .default('never_published'), // C2
    firstPublishedAt: ts('first_published_at'), // C1
    withdrawnAt: ts('withdrawn_at'), // C2
    hiddenByTakedownNoticeId: uuid('hidden_by_takedown_notice_id'), // C2
    createdBy: uuid('created_by').notNull(), // C3
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('lesson_kind_ck', sql`${t.kind} in ('video', 'text', 'quiz')`),
    check('lesson_live_state_ck', sql`${t.liveState} in ('never_published', 'live', 'withdrawn')`),
    check(
      'lesson_withdrawn_ck',
      sql`(${t.liveState} = 'withdrawn') = (${t.withdrawnAt} is not null)`,
    ),
    check('lesson_version_ck', sql`${t.version} >= 1`),
    index('lesson_section_idx').on(t.sectionId, t.createdAt),
    // PD-207: listPiecesPublished ranges over first_published_at.
    index('lesson_first_published_idx').on(t.firstPublishedAt),
  ],
);

export const lessonVersion = pgTable(
  'lesson_version',
  {
    lessonVersionId: uuid('lesson_version_id').primaryKey().defaultRandom(), // C1 / C2
    lessonId: uuid('lesson_id') // C1 / C2
      .notNull()
      .references(() => lesson.lessonId, { onDelete: 'restrict' }),
    sectionVersionId: uuid('section_version_id') // C1 / C2
      .notNull()
      .references(() => sectionVersion.sectionVersionId, { onDelete: 'restrict' }),
    position: integer('position').notNull(), // C1 / C2
    titleBn: text('title_bn'), // C1 published / C2 working copy
    titleEn: text('title_en'), // C1 published / C2 working copy
    bodyBn: jsonb('body_bn'), // C1 published / C2 working copy
    bodyEn: jsonb('body_en'), // C1 published / C2 working copy
    videoAssetId: uuid('video_asset_id'), // C1
    // A YouTube (unlisted) video ID for a video lesson, played through youtube-nocookie.com.
    youtubeVideoId: text('youtube_video_id'), // C1
    mediaStatus: text('media_status', { enum: ['none', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('none'), // C2
    captionLanguages: text('caption_languages').array().notNull().default(sql`'{}'::text[]`), // C1
    quizQuestionCount: integer('quiz_question_count').notNull().default(0), // C2
    // FR4.5 / US4.13: a streak-only bonus quiz opens only while the Student's streak is at least
    // this many days; null for an ordinary quiz.
    streakBonusDays: integer('streak_bonus_days'), // C1
    // SD-211: the ASCII-normalised link domains written at save, joined to blocked_domain.
    linkDomainCandidates: text('link_domain_candidates')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // C2
    version: integer('version').notNull().default(1), // C2
  },
  (t) => [
    check('lesson_version_position_ck', sql`${t.position} >= 1`),
    check(
      'lesson_version_media_status_ck',
      sql`${t.mediaStatus} in ('none', 'processing', 'ready', 'failed')`,
    ),
    check('lesson_version_quiz_count_ck', sql`${t.quizQuestionCount} >= 0`),
    check(
      'lesson_version_streak_bonus_ck',
      sql`${t.streakBonusDays} is null or ${t.streakBonusDays} between 1 and 365`,
    ),
    check(
      'lesson_version_youtube_id_ck',
      sql`${t.youtubeVideoId} is null or ${t.youtubeVideoId} ~ '^[A-Za-z0-9_-]{11}$'`,
    ),
    check(
      'lesson_version_title_len_ck',
      sql`coalesce(char_length(${t.titleBn}), 0) <= 150 and coalesce(char_length(${t.titleEn}), 0) <= 150`,
    ),
    check('lesson_version_version_ck', sql`${t.version} >= 1`),
    unique('lesson_version_lesson_uq').on(t.sectionVersionId, t.lessonId),
    index('lesson_version_lesson_idx').on(t.lessonId),
  ],
);

export const ownershipPeriod = pgTable(
  'ownership_period',
  {
    sectionOwnershipId: uuid('section_ownership_id').primaryKey().defaultRandom(), // C2
    sectionId: uuid('section_id') // C2
      .notNull()
      .references(() => section.sectionId, { onDelete: 'restrict' }),
    // entities.md effectiveFrom / effectiveTo; named valid_from / valid_to as in RD-215 and PD-202.
    instructorId: uuid('instructor_id').notNull(), // C3
    validFrom: ts('valid_from').notNull(), // C2
    validTo: ts('valid_to'), // C2
    assignedBy: uuid('assigned_by').notNull(), // C3
    reason: text('reason', { enum: OWNERSHIP_REASONS }).notNull(), // C2
    version: integer('version').notNull().default(1), // C2
  },
  (t) => [
    check('ownership_period_reason_ck', sql`${t.reason} in (${inList(OWNERSHIP_REASONS)})`),
    check('ownership_period_range_ck', sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check('ownership_period_version_ck', sql`${t.version} >= 1`),
    // BR6.4: at most one open period per section.
    uniqueIndex('ownership_period_open_uq').on(t.sectionId).where(sql`${t.validTo} is null`),
    index('ownership_period_section_idx').on(t.sectionId, t.validFrom),
    index('ownership_period_instructor_idx').on(t.instructorId, t.validFrom),
  ],
);

export const sectionReview = pgTable(
  'section_review',
  {
    sectionReviewId: uuid('section_review_id').primaryKey().defaultRandom(), // C2
    sectionId: uuid('section_id') // C2
      .notNull()
      .references(() => section.sectionId, { onDelete: 'restrict' }),
    sectionVersionId: uuid('section_version_id') // C2
      .notNull()
      .references(() => sectionVersion.sectionVersionId, { onDelete: 'restrict' }),
    action: text('action', { enum: REVIEW_ACTIONS }).notNull(), // C2
    fromState: text('from_state', { enum: ['draft', 'in_review', 'approved'] }).notNull(), // C2
    toState: text('to_state', {
      enum: ['draft', 'in_review', 'approved', 'published', 'discarded'],
    }).notNull(), // C2
    actorId: uuid('actor_id').notNull(), // C3
    comment: text('comment'), // C3
    decidedAt: ts('decided_at').notNull(), // C2
  },
  (t) => [
    check('section_review_action_ck', sql`${t.action} in (${inList(REVIEW_ACTIONS)})`),
    check(
      'section_review_comment_ck',
      sql`${t.comment} is null or char_length(${t.comment}) between 1 and 2000`,
    ),
    index('section_review_section_idx').on(t.sectionId, t.decidedAt),
  ],
);

export const blockedDomain = pgTable('blocked_domain', {
  blockedDomainId: uuid('blocked_domain_id').primaryKey().defaultRandom(), // C2
  domain: text('domain').notNull().unique('blocked_domain_domain_uq'), // C2
  createdBy: uuid('created_by').notNull(), // C3
  createdAt: ts('created_at').notNull().defaultNow(), // C2
  version: integer('version').notNull().default(1), // C2
});

// ------------------------------------------------------------------ U2 products (Bolt 5)
// entities.md ExamPackage, ExamPackageVersion, SubscriptionPlan, SubscriptionPlanVersion and
// PracticePack. Migration 0006_u2_catalog_products adds the data-class comments, the immutability
// triggers on the version rows (NFR6.206, BR10.3, BR10.6) and the plan item Goal check (BR10.1).
// Question and question-set IDs belong to U4 Assessment and are not foreign keys (ADR-020).

export const PRODUCT_STATUSES = ['draft', 'published', 'unpublished', 'retired'] as const;
export const PLAN_ITEM_TYPES = ['course', 'exam_package'] as const;

const emptyIds = sql`'{}'::uuid[]`;

export const examPackage = pgTable(
  'exam_package',
  {
    examPackageId: uuid('exam_package_id').primaryKey().defaultRandom(), // C1
    goalId: uuid('goal_id') // C1
      .notNull()
      .references(() => goal.goalId, { onDelete: 'restrict' }),
    titleBn: text('title_bn').notNull(), // C1 published / C2 draft
    titleEn: text('title_en').notNull(), // C1 published / C2 draft
    descriptionBn: text('description_bn'), // C1 published / C2 draft
    descriptionEn: text('description_en'), // C1 published / C2 draft
    listPricePoisha: bigint('list_price_poisha', { mode: 'number' }).notNull(), // C1
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('draft'), // C2
    draftQuestionIds: uuid('draft_question_ids').array().notNull().default(emptyIds), // C2
    draftTimeLimitMinutes: integer('draft_time_limit_minutes'), // C2
    hasUnpublishedChanges: boolean('has_unpublished_changes').notNull().default(false), // C2
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => examPackageVersion.examPackageVersionId,
      { onDelete: 'restrict' },
    ), // C1
    firstPublishedAt: ts('first_published_at'), // C1
    unpublishedAt: ts('unpublished_at'), // C2
    retiredAt: ts('retired_at'), // C2
    pinRank: integer('pin_rank'), // C1
    createdBy: uuid('created_by').notNull(), // C3
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('exam_package_status_ck', sql`${t.status} in (${inList(PRODUCT_STATUSES)})`),
    check('exam_package_price_ck', sql`${t.listPricePoisha} >= 1`),
    check(
      'exam_package_time_limit_ck',
      sql`${t.draftTimeLimitMinutes} is null or ${t.draftTimeLimitMinutes} between 1 and 600`,
    ),
    check('exam_package_questions_ck', sql`cardinality(${t.draftQuestionIds}) <= 500`),
    check(
      'exam_package_published_version_ck',
      sql`${t.status} = 'draft' or ${t.currentVersionId} is not null`,
    ),
    check(
      'exam_package_title_len_ck',
      sql`char_length(${t.titleBn}) <= 150 and char_length(${t.titleEn}) <= 150`,
    ),
    check('exam_package_pin_rank_ck', sql`${t.pinRank} is null or ${t.pinRank} >= 1`),
    check('exam_package_version_ck', sql`${t.version} >= 1`),
    // PD-202: the S3 Exam packages tab, published packages of a Goal in browse order.
    index('exam_package_published_goal_idx')
      .on(t.goalId, t.pinRank, t.firstPublishedAt.desc(), t.examPackageId)
      .where(sql`${t.status} = 'published'`),
    index('exam_package_created_idx').on(t.createdAt.desc(), t.examPackageId),
  ],
);

export const examPackageVersion = pgTable(
  'exam_package_version',
  {
    examPackageVersionId: uuid('exam_package_version_id').primaryKey().defaultRandom(), // C1
    examPackageId: uuid('exam_package_id') // C1
      .notNull()
      .references(() => examPackage.examPackageId, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(), // C1
    questionIds: uuid('question_ids').array().notNull(), // C2
    timeLimitMinutes: integer('time_limit_minutes').notNull(), // C1
    publishedAt: ts('published_at').notNull(), // C1
    publishedBy: uuid('published_by').notNull(), // C3
  },
  (t) => [
    unique('exam_package_version_number_uq').on(t.examPackageId, t.versionNumber),
    check('exam_package_version_number_ck', sql`${t.versionNumber} >= 1`),
    check(
      'exam_package_version_questions_ck',
      sql`cardinality(${t.questionIds}) between 1 and 500`,
    ),
    check('exam_package_version_time_ck', sql`${t.timeLimitMinutes} between 1 and 600`),
  ],
);

export const subscriptionPlan = pgTable(
  'subscription_plan',
  {
    planId: uuid('plan_id').primaryKey().defaultRandom(), // C1
    goalId: uuid('goal_id') // C1
      .notNull()
      .references(() => goal.goalId, { onDelete: 'restrict' }),
    nameBn: text('name_bn').notNull(), // C1 published / C2 draft
    nameEn: text('name_en').notNull(), // C1 published / C2 draft
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('draft'), // C2
    draftMonthlyPricePoisha: bigint('draft_monthly_price_poisha', { mode: 'number' }), // C2
    draftCourseIds: uuid('draft_course_ids').array().notNull().default(emptyIds), // C2
    draftExamPackageIds: uuid('draft_exam_package_ids').array().notNull().default(emptyIds), // C2
    hasUnpublishedChanges: boolean('has_unpublished_changes').notNull().default(false), // C2
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => subscriptionPlanVersion.planVersionId,
      { onDelete: 'restrict' },
    ), // C1
    firstPublishedAt: ts('first_published_at'), // C1
    unpublishedAt: ts('unpublished_at'), // C2
    retiredAt: ts('retired_at'), // C2
    pinRank: integer('pin_rank'), // C1
    createdBy: uuid('created_by').notNull(), // C3
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('subscription_plan_status_ck', sql`${t.status} in (${inList(PRODUCT_STATUSES)})`),
    check(
      'subscription_plan_price_ck',
      sql`${t.draftMonthlyPricePoisha} is null or ${t.draftMonthlyPricePoisha} >= 1`,
    ),
    check(
      'subscription_plan_published_version_ck',
      sql`${t.status} = 'draft' or ${t.currentVersionId} is not null`,
    ),
    check(
      'subscription_plan_name_len_ck',
      sql`char_length(${t.nameBn}) <= 100 and char_length(${t.nameEn}) <= 100`,
    ),
    check(
      'subscription_plan_items_ck',
      sql`cardinality(${t.draftCourseIds}) + cardinality(${t.draftExamPackageIds}) <= 500`,
    ),
    check('subscription_plan_pin_rank_ck', sql`${t.pinRank} is null or ${t.pinRank} >= 1`),
    check('subscription_plan_version_ck', sql`${t.version} >= 1`),
    // BR11.2: published plans of a Goal, pinned first then newest.
    index('subscription_plan_published_goal_idx')
      .on(t.goalId, t.pinRank, t.firstPublishedAt.desc(), t.planId)
      .where(sql`${t.status} = 'published'`),
    index('subscription_plan_created_idx').on(t.createdAt.desc(), t.planId),
  ],
);

export const subscriptionPlanVersion = pgTable(
  'subscription_plan_version',
  {
    planVersionId: uuid('plan_version_id').primaryKey().defaultRandom(), // C1
    planId: uuid('plan_id') // C1
      .notNull()
      .references(() => subscriptionPlan.planId, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(), // C1
    monthlyPricePoisha: bigint('monthly_price_poisha', { mode: 'number' }).notNull(), // C1
    publishedAt: ts('published_at').notNull(), // C1
    publishedBy: uuid('published_by').notNull(), // C3
  },
  (t) => [
    unique('subscription_plan_version_number_uq').on(t.planId, t.versionNumber),
    check('subscription_plan_version_number_ck', sql`${t.versionNumber} >= 1`),
    check('subscription_plan_version_price_ck', sql`${t.monthlyPricePoisha} >= 1`),
  ],
);

export const subscriptionPlanVersionItem = pgTable(
  'subscription_plan_version_item',
  {
    planVersionItemId: uuid('plan_version_item_id').primaryKey().defaultRandom(), // C2
    planVersionId: uuid('plan_version_id') // C1
      .notNull()
      .references(() => subscriptionPlanVersion.planVersionId, { onDelete: 'restrict' }),
    itemType: text('item_type', { enum: PLAN_ITEM_TYPES }).notNull(), // C1
    courseId: uuid('course_id').references(() => course.courseId, { onDelete: 'restrict' }), // C1
    examPackageId: uuid('exam_package_id').references(() => examPackage.examPackageId, {
      onDelete: 'restrict',
    }), // C1
  },
  (t) => [
    check(
      'subscription_plan_version_item_ref_ck',
      sql`(${t.itemType} = 'course' and ${t.courseId} is not null and ${t.examPackageId} is null)
        or (${t.itemType} = 'exam_package' and ${t.examPackageId} is not null and ${t.courseId} is null)`,
    ),
    unique('subscription_plan_version_item_course_uq').on(t.planVersionId, t.courseId),
    unique('subscription_plan_version_item_exam_uq').on(t.planVersionId, t.examPackageId),
    // BR10.8: which current plan versions include an item.
    index('subscription_plan_version_item_course_idx').on(t.courseId),
    index('subscription_plan_version_item_exam_idx').on(t.examPackageId),
  ],
);

export const practicePack = pgTable(
  'practice_pack',
  {
    practicePackId: uuid('practice_pack_id').primaryKey().defaultRandom(), // C1
    courseId: uuid('course_id') // C1
      .notNull()
      .references(() => course.courseId, { onDelete: 'restrict' }),
    titleBn: text('title_bn').notNull(), // C1 published / C2 draft
    titleEn: text('title_en').notNull(), // C1 published / C2 draft
    listPricePoisha: bigint('list_price_poisha', { mode: 'number' }).notNull(), // C1
    questionSetIds: uuid('question_set_ids').array().notNull(), // C2
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('draft'), // C2
    firstPublishedAt: ts('first_published_at'), // C1
    unpublishedAt: ts('unpublished_at'), // C2
    retiredAt: ts('retired_at'), // C2
    createdBy: uuid('created_by').notNull(), // C3
    version: integer('version').notNull().default(1), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    updatedAt: ts('updated_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('practice_pack_status_ck', sql`${t.status} in (${inList(PRODUCT_STATUSES)})`),
    check('practice_pack_price_ck', sql`${t.listPricePoisha} >= 1`),
    check('practice_pack_sets_ck', sql`cardinality(${t.questionSetIds}) between 1 and 50`),
    check(
      'practice_pack_title_len_ck',
      sql`char_length(${t.titleBn}) <= 150 and char_length(${t.titleEn}) <= 150`,
    ),
    check('practice_pack_version_ck', sql`${t.version} >= 1`),
    index('practice_pack_course_idx').on(t.courseId, t.createdAt, t.practicePackId),
  ],
);

// ------------------------------------------------------------------ U2 images (Bolt 6)
// security-design SD-217 / SD-220 (carried into entities.md as CatalogImage and LessonVersionImage).
// Migration 0007_u2_catalog_images adds the data-class comments. Images exist only behind the
// catalog.imageUploads flag (default off); without the human's approval of `sharp` (Step 44) no
// decoder is installed and every upload fails closed, so these tables stay empty in practice.
// A lesson document refers to an image by imageId only; the reference rows drive the quarantine
// move (SD-220) and the retention purge (SD-227).

export const IMAGE_KINDS = ['cover', 'inline'] as const;
export const IMAGE_STATES = ['active', 'quarantined', 'deleted'] as const;

export const catalogImage = pgTable(
  'catalog_image',
  {
    imageId: uuid('image_id').primaryKey().defaultRandom(), // C1
    courseId: uuid('course_id') // C1
      .notNull()
      .references(() => course.courseId, { onDelete: 'restrict' }),
    kind: text('kind', { enum: IMAGE_KINDS }).notNull(), // C1
    // img/<base64url(16 random bytes)>; the variants are <storage_key>/<width>.webp (SD-217).
    storageKey: text('storage_key').notNull().unique('catalog_image_storage_key_uq'), // C1
    variantWidths: integer('variant_widths').array().notNull(), // C1
    width: integer('width').notNull(), // C1
    height: integer('height').notNull(), // C1
    desiredState: text('desired_state', { enum: IMAGE_STATES }).notNull().default('active'), // C2
    actualState: text('actual_state', { enum: IMAGE_STATES }).notNull().default('active'), // C2
    desiredSince: ts('desired_since').notNull().defaultNow(), // C2
    uploadedBy: uuid('uploaded_by').notNull(), // C3
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    version: integer('version').notNull().default(1), // C2
  },
  (t) => [
    check('catalog_image_kind_ck', sql`${t.kind} in (${inList(IMAGE_KINDS)})`),
    check('catalog_image_desired_ck', sql`${t.desiredState} in (${inList(IMAGE_STATES)})`),
    check('catalog_image_actual_ck', sql`${t.actualState} in (${inList(IMAGE_STATES)})`),
    check('catalog_image_key_ck', sql`${t.storageKey} ~ '^img/[A-Za-z0-9_-]{22}$'`),
    check('catalog_image_size_ck', sql`${t.width} between 1 and 1600 and ${t.height} >= 1`),
    check('catalog_image_widths_ck', sql`cardinality(${t.variantWidths}) between 1 and 3`),
    check('catalog_image_version_ck', sql`${t.version} >= 1`),
    index('catalog_image_course_idx').on(t.courseId, t.createdAt),
    // RD-211: the reconciler scans only images whose desired and actual states differ.
    index('catalog_image_pending_idx')
      .on(t.desiredSince)
      .where(sql`${t.desiredState} <> ${t.actualState}`),
  ],
);

export const lessonVersionImage = pgTable(
  'lesson_version_image',
  {
    lessonVersionId: uuid('lesson_version_id') // C2
      .notNull()
      .references(() => lessonVersion.lessonVersionId, { onDelete: 'restrict' }),
    imageId: uuid('image_id') // C2
      .notNull()
      .references(() => catalogImage.imageId, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ name: 'lesson_version_image_pk', columns: [t.lessonVersionId, t.imageId] }),
    index('lesson_version_image_image_idx').on(t.imageId),
  ],
);
