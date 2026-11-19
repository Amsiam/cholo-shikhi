// Commerce (payment, enrolment) and learning (lesson progress, quiz questions, quiz attempts) tables.
// Data class per column (NFR5.201): C1 public once published, C2 internal, C3 personal. Cross-unit IDs
// (users, courses, lessons) are not foreign keys (ADR-020); each feature checks them in its service.
// Money is integer poisha in bigint columns, never numeric or real (project.md).
//
// The payment gateway here is the development-only fake gateway: a payment is created `pending` at
// checkout and is moved to `succeeded` or `failed` exactly once. A succeeded payment creates exactly
// one enrolment (unique payment_id), and a student holds at most one active enrolment per course.
import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { lessonVersion } from './catalog.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed'] as const;
/** 'switched': ended by an approved course switch (US2.18). */
export const ENROLMENT_STATUSES = ['active', 'expired', 'revoked', 'switched'] as const;
export const PAYMENT_KINDS = ['purchase', 'renewal'] as const;

export const payment = pgTable(
  'payment',
  {
    paymentId: uuid('payment_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    courseId: uuid('course_id').notNull(), // C2
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2
    /** US8.3: the promo discount taken off the list price (amount = list price − discount). */
    discountPoisha: bigint('discount_poisha', { mode: 'number' }).notNull().default(0), // C2
    promoCodeId: uuid('promo_code_id'), // C2
    /** US8.5: a course bought as part of a bundle; its amount is the course's part of the price. */
    bundleOrderId: uuid('bundle_order_id'), // C2
    currency: text('currency').notNull().default('BDT'), // C2
    accessDurationMonths: integer('access_duration_months').notNull(), // C2, terms at purchase
    gateway: text('gateway', { enum: ['fake'] }).notNull(), // C2
    /** A first purchase, or a renewal that extends an active enrolment from its end date. */
    kind: text('kind', { enum: PAYMENT_KINDS }).notNull().default('purchase'), // C2
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'), // C2
    gatewayRef: text('gateway_ref'), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    settledAt: ts('settled_at'), // C2
  },
  (t) => [
    check('payment_amount_ck', sql`${t.amountPoisha} >= 1`),
    check(
      'payment_discount_ck',
      sql`${t.discountPoisha} >= 0 and (${t.discountPoisha} = 0) = (${t.promoCodeId} is null)`,
    ),
    check('payment_currency_ck', sql`${t.currency} = 'BDT'`),
    check('payment_months_ck', sql`${t.accessDurationMonths} in (4, 6, 12)`),
    check('payment_status_ck', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check('payment_kind_ck', sql`${t.kind} in ('purchase', 'renewal')`),
    check('payment_settled_ck', sql`(${t.status} = 'pending') = (${t.settledAt} is null)`),
    index('payment_user_idx').on(t.userId, t.createdAt),
  ],
);

export const enrolment = pgTable(
  'enrolment',
  {
    enrolmentId: uuid('enrolment_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    courseId: uuid('course_id').notNull(), // C2
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.paymentId, { onDelete: 'restrict' }), // C2
    startsAt: ts('starts_at').notNull(), // C2
    endsAt: ts('ends_at').notNull(), // C2
    status: text('status', { enum: ENROLMENT_STATUSES }).notNull().default('active'), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('enrolment_window_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check('enrolment_status_ck', sql`${t.status} in ('active', 'expired', 'revoked', 'switched')`),
    unique('enrolment_payment_uq').on(t.paymentId),
    uniqueIndex('enrolment_active_uq').on(t.userId, t.courseId).where(sql`${t.status} = 'active'`),
    index('enrolment_user_idx').on(t.userId),
  ],
);

/**
 * A Student's request to refund a purchase (US2.26), decided by an Admin (US2.27). On approval the
 * enrolment is revoked and the refund is posted to the ledger. One open or approved request per
 * payment. The fake gateway moves no money; a real gateway refund is a later step.
 */
export const REFUND_STATUSES = ['pending', 'approved', 'rejected'] as const;
/**
 * A Student's request to switch a paid course for another (US2.17-2.19). An Admin approves (with a
 * full or unused-days refund) or denies with a reason within 24 hours; after that it expires.
 * At most one pending request per Student.
 */
export const SWITCH_STATUSES = ['pending', 'approved', 'denied', 'expired'] as const;
export const courseSwitchRequest = pgTable(
  'course_switch_request',
  {
    switchId: uuid('switch_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    enrolmentId: uuid('enrolment_id').notNull(), // C2
    paymentId: uuid('payment_id').notNull(), // C2
    fromCourseId: uuid('from_course_id').notNull(), // C2
    toCourseId: uuid('to_course_id').notNull(), // C2
    status: text('status', { enum: SWITCH_STATUSES }).notNull().default('pending'), // C2
    requestedAt: ts('requested_at').notNull(), // C2
    deadlineAt: ts('deadline_at').notNull(), // C2
    policy: text('policy', { enum: ['full', 'unused'] }), // C2
    refundPoisha: integer('refund_poisha'), // C2
    reason: text('reason'), // C2
    decidedBy: uuid('decided_by'), // C3
    decidedAt: ts('decided_at'), // C2
  },
  (t) => [
    check(
      'course_switch_status_ck',
      sql`${t.status} in ('pending', 'approved', 'denied', 'expired')`,
    ),
    check('course_switch_courses_ck', sql`${t.fromCourseId} <> ${t.toCourseId}`),
    check('course_switch_deadline_ck', sql`${t.deadlineAt} > ${t.requestedAt}`),
    check(
      'course_switch_approved_ck',
      sql`(${t.status} = 'approved') = (${t.refundPoisha} is not null and ${t.policy} is not null)`,
    ),
    check('course_switch_refund_ck', sql`${t.refundPoisha} is null or ${t.refundPoisha} >= 0`),
    uniqueIndex('course_switch_one_pending_uq').on(t.userId).where(sql`${t.status} = 'pending'`),
    index('course_switch_queue_idx').on(t.status, t.deadlineAt),
  ],
);

export const REFUND_POLICIES = ['full', 'unused', 'partial'] as const;

export const refundRequest = pgTable(
  'refund_request',
  {
    refundId: uuid('refund_id').primaryKey().defaultRandom(), // C2
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payment.paymentId, { onDelete: 'restrict' }), // C2
    userId: uuid('user_id').notNull(), // C3
    reason: text('reason').notNull(), // C3
    status: text('status', { enum: REFUND_STATUSES }).notNull().default('pending'), // C2
    requestedAt: ts('requested_at').notNull().defaultNow(), // C2
    policy: text('policy', { enum: REFUND_POLICIES }), // C2
    refundPoisha: bigint('refund_poisha', { mode: 'number' }), // C2
    decisionNote: text('decision_note'), // C2
    decidedBy: uuid('decided_by'), // C3
    decidedAt: ts('decided_at'), // C2
  },
  (t) => [
    check('refund_status_ck', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check(
      'refund_policy_ck',
      sql`${t.policy} is null or ${t.policy} in ('full', 'unused', 'partial')`,
    ),
    check('refund_reason_ck', sql`char_length(${t.reason}) between 10 and 1000`),
    check(
      'refund_decision_ck',
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.status} <> 'approved' or (${t.policy} is not null and ${t.refundPoisha} >= 1))`,
    ),
    uniqueIndex('refund_payment_open_uq')
      .on(t.paymentId)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index('refund_status_idx').on(t.status, t.requestedAt),
    index('refund_user_idx').on(t.userId, t.requestedAt),
  ],
);

/**
 * Orders for products other than courses: Practice Packs, exam packages and monthly subscription
 * plans. A course is still bought through `payment`. Title and price are snapshots at checkout.
 */
export const PRODUCT_TYPES = ['practice_pack', 'exam_package', 'subscription_plan'] as const;

export const productOrder = pgTable(
  'product_order',
  {
    orderId: uuid('order_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    productType: text('product_type', { enum: PRODUCT_TYPES }).notNull(), // C2
    productId: uuid('product_id').notNull(), // C2
    /** A Practice Pack's course (its sale is split by that course's owners). */
    courseId: uuid('course_id'), // C2
    titleBn: text('title_bn').notNull(), // C2
    titleEn: text('title_en').notNull(), // C2
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2
    accessMonths: integer('access_months').notNull(), // C2
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'), // C2
    gateway: text('gateway', { enum: ['fake'] })
      .notNull()
      .default('fake'), // C2
    gatewayRef: text('gateway_ref'), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    settledAt: ts('settled_at'), // C2
  },
  (t) => [
    check(
      'product_order_type_ck',
      sql`${t.productType} in ('practice_pack', 'exam_package', 'subscription_plan')`,
    ),
    check('product_order_amount_ck', sql`${t.amountPoisha} >= 1`),
    check('product_order_months_ck', sql`${t.accessMonths} in (1, 6)`),
    check('product_order_status_ck', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check('product_order_settled_ck', sql`(${t.status} = 'pending') = (${t.settledAt} is null)`),
    check(
      'product_order_pack_course_ck',
      sql`${t.productType} <> 'practice_pack' or ${t.courseId} is not null`,
    ),
    index('product_order_user_idx').on(t.userId, t.createdAt),
  ],
);

/** What a succeeded order grants: access to one product for a period. */
export const productAccess = pgTable(
  'product_access',
  {
    accessId: uuid('access_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    productType: text('product_type', { enum: PRODUCT_TYPES }).notNull(), // C2
    productId: uuid('product_id').notNull(), // C2
    orderId: uuid('order_id')
      .notNull()
      .unique('product_access_order_uq')
      .references(() => productOrder.orderId, { onDelete: 'restrict' }), // C2
    startsAt: ts('starts_at').notNull(), // C2
    endsAt: ts('ends_at').notNull(), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('product_access_window_ck', sql`${t.endsAt} > ${t.startsAt}`),
    index('product_access_user_idx').on(t.userId, t.productType, t.productId, t.endsAt),
  ],
);

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    userId: uuid('user_id').notNull(), // C3
    lessonId: uuid('lesson_id').notNull(), // C2
    courseId: uuid('course_id').notNull(), // C2
    completedAt: ts('completed_at').notNull().defaultNow(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.lessonId] }),
    index('lesson_progress_course_idx').on(t.userId, t.courseId),
  ],
);

export const quizQuestion = pgTable(
  'quiz_question',
  {
    questionId: uuid('question_id').primaryKey().defaultRandom(), // C1
    lessonId: uuid('lesson_id').notNull(), // C1
    // Questions are versioned with the lesson, like its text: a working copy has its own questions,
    // and a published version's questions never change (guard trigger, migration 0013).
    lessonVersionId: uuid('lesson_version_id')
      .notNull()
      .references(() => lessonVersion.lessonVersionId, { onDelete: 'cascade' }), // C1
    position: integer('position').notNull(), // C1
    promptBn: text('prompt_bn').notNull(), // C1
    promptEn: text('prompt_en').notNull(), // C1
    optionsBn: text('options_bn').array().notNull(), // C1
    optionsEn: text('options_en').array().notNull(), // C1
    correctIndex: integer('correct_index').notNull(), // C2, never sent before submission
    explanationBn: text('explanation_bn'), // C1
    explanationEn: text('explanation_en'), // C1
  },
  (t) => [
    check('quiz_question_position_ck', sql`${t.position} >= 1`),
    check(
      'quiz_question_options_ck',
      sql`cardinality(${t.optionsBn}) = 4 and cardinality(${t.optionsEn}) = 4`,
    ),
    check('quiz_question_correct_ck', sql`${t.correctIndex} between 0 and 3`),
    check(
      'quiz_question_len_ck',
      sql`char_length(${t.promptBn}) <= 1000 and char_length(${t.promptEn}) <= 1000`,
    ),
    unique('quiz_question_version_position_uq').on(t.lessonVersionId, t.position),
    index('quiz_question_lesson_idx').on(t.lessonId),
  ],
);

export const quizAttempt = pgTable(
  'quiz_attempt',
  {
    attemptId: uuid('attempt_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    lessonId: uuid('lesson_id').notNull(), // C2
    courseId: uuid('course_id').notNull(), // C2
    score: integer('score').notNull(), // C3
    total: integer('total').notNull(), // C2
    submittedAt: ts('submitted_at').notNull().defaultNow(), // C3
  },
  (t) => [
    check('quiz_attempt_score_ck', sql`${t.score} >= 0 and ${t.score} <= ${t.total}`),
    index('quiz_attempt_user_lesson_idx').on(t.userId, t.lessonId, t.submittedAt),
  ],
);

/** One row per answered question; wrong answers feed the Mistake Vault when it ships (U5). */
export const quizAttemptAnswer = pgTable(
  'quiz_attempt_answer',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempt.attemptId, { onDelete: 'cascade' }), // C2
    questionId: uuid('question_id').notNull(), // C2
    chosenIndex: integer('chosen_index'), // C3, null when skipped
    isCorrect: boolean('is_correct').notNull(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    check(
      'quiz_attempt_answer_choice_ck',
      sql`${t.chosenIndex} is null or ${t.chosenIndex} between 0 and 3`,
    ),
  ],
);

export const VAULT_STATUSES = ['active', 'mastered'] as const;
export const VAULT_SOURCES = ['lesson', 'bank'] as const;

/**
 * Mistake Vault (FR-ADP-1): one row per Student and question they have answered wrongly. The goal is
 * the Goal of the course the mistake came from (cross-unit ID, not a foreign key).
 */
export const vaultItem = pgTable(
  'vault_item',
  {
    userId: uuid('user_id').notNull(), // C3
    /** A lesson quiz question (quiz_question) or a question-bank question (bank_question). */
    questionId: uuid('question_id').notNull(), // C2
    source: text('source', { enum: VAULT_SOURCES }).notNull().default('lesson'), // C2
    lessonId: uuid('lesson_id'), // C2, lesson items only
    courseId: uuid('course_id'), // C2, lesson items only
    /** Bank items: the topic and difficulty used to find similar questions (FR-ADP-1). */
    topicId: uuid('topic_id'), // C2
    difficulty: text('difficulty'), // C2
    goalId: uuid('goal_id'), // C2
    lastWrongChoice: integer('last_wrong_choice'), // C3
    status: text('status', { enum: VAULT_STATUSES }).notNull().default('active'), // C3
    correctRun: integer('correct_run').notNull().default(0), // C3
    wrongCount: integer('wrong_count').notNull().default(1), // C3
    firstWrongAt: ts('first_wrong_at').notNull(), // C3
    lastWrongAt: ts('last_wrong_at').notNull(), // C3
    lastPractisedAt: ts('last_practised_at'), // C3
    masteredAt: ts('mastered_at'), // C3
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    check('vault_item_status_ck', sql`${t.status} in ('active', 'mastered')`),
    check('vault_item_source_ck', sql`${t.source} in ('lesson', 'bank')`),
    check(
      'vault_item_lesson_ref_ck',
      sql`${t.source} <> 'lesson' or (${t.lessonId} is not null and ${t.courseId} is not null)`,
    ),
    check('vault_item_run_ck', sql`${t.correctRun} >= 0 and ${t.wrongCount} >= 1`),
    check(
      'vault_item_mastered_ck',
      sql`(${t.status} = 'mastered') = (${t.masteredAt} is not null)`,
    ),
    check(
      'vault_item_choice_ck',
      sql`${t.lastWrongChoice} is null or ${t.lastWrongChoice} between 0 and 3`,
    ),
    index('vault_item_queue_idx').on(t.userId, t.status, t.goalId),
  ],
);

/** Every answer given in vault practice (history for the Student and for anti-poisoning later). */
export const vaultAnswer = pgTable(
  'vault_answer',
  {
    vaultAnswerId: uuid('vault_answer_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    questionId: uuid('question_id').notNull(), // C2, lesson or bank question (see vault_item.source)
    chosenIndex: integer('chosen_index').notNull(), // C3
    isCorrect: boolean('is_correct').notNull(), // C3
    answeredAt: ts('answered_at').notNull().defaultNow(), // C3
  },
  (t) => [
    check('vault_answer_choice_ck', sql`${t.chosenIndex} between 0 and 3`),
    index('vault_answer_user_idx').on(t.userId, t.answeredAt),
  ],
);

/**
 * A renewal (FR-DIST-4): the payment extended an active enrolment from its end date, so no days are
 * lost. One row per renewal payment; the enrolment row itself carries the new end date.
 */
export const enrolmentRenewal = pgTable(
  'enrolment_renewal',
  {
    paymentId: uuid('payment_id')
      .primaryKey()
      .references(() => payment.paymentId, { onDelete: 'restrict' }), // C2
    enrolmentId: uuid('enrolment_id')
      .notNull()
      .references(() => enrolment.enrolmentId, { onDelete: 'restrict' }), // C2
    previousEndsAt: ts('previous_ends_at').notNull(), // C2
    newEndsAt: ts('new_ends_at').notNull(), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('enrolment_renewal_window_ck', sql`${t.newEndsAt} > ${t.previousEndsAt}`),
    index('enrolment_renewal_enrolment_idx').on(t.enrolmentId),
  ],
);

/**
 * Free trial (FR-DIST-1): the one designated trial course of each Goal segment, set by an Admin.
 * Cross-unit IDs (segment, course, admin) are not foreign keys (ADR-020).
 */
export const trialOffer = pgTable(
  'trial_offer',
  {
    segmentId: uuid('segment_id').primaryKey(), // C2
    courseId: uuid('course_id').notNull(), // C2
    setBy: uuid('set_by').notNull(), // C3
    setAt: ts('set_at').notNull().defaultNow(), // C2
  },
  (t) => [unique('trial_offer_course_uq').on(t.courseId)],
);

/**
 * A Student's trial in a segment: at most one per Student and segment, ever (Goal switching does not
 * reset it). Access is the course's first lessons for a fixed number of days; the cap is checked on
 * every read, so expiry needs no job.
 */
export const courseTrial = pgTable(
  'course_trial',
  {
    userId: uuid('user_id').notNull(), // C3
    segmentId: uuid('segment_id').notNull(), // C2
    courseId: uuid('course_id').notNull(), // C2
    startedAt: ts('started_at').notNull().defaultNow(), // C3
    endsAt: ts('ends_at').notNull(), // C3
    /** US2.23: the lesson cap in force when the trial started (later changes do not affect it). */
    lessonCap: integer('lesson_cap').notNull().default(5), // C2
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.segmentId] }),
    check('course_trial_window_ck', sql`${t.endsAt} > ${t.startedAt}`),
    check('course_trial_lesson_cap_ck', sql`${t.lessonCap} >= 1`),
    index('course_trial_user_course_idx').on(t.userId, t.courseId),
  ],
);

/**
 * The course NPS answer (FR7.9, US7.18): asked once when the Student completes the course. A skip
 * is stored with no score so the Student is not asked again; only scored rows count towards NPS.
 */
export const courseNps = pgTable(
  'course_nps',
  {
    userId: uuid('user_id').notNull(), // C3
    courseId: uuid('course_id').notNull(), // C2
    score: integer('score'), // C3
    answeredAt: ts('answered_at').notNull(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.courseId] }),
    check('course_nps_score_ck', sql`${t.score} is null or ${t.score} between 0 and 10`),
    index('course_nps_course_idx').on(t.courseId),
  ],
);

/**
 * One-time notices a Student has dismissed (US3.12: the viewer-badge explanation), so a notice is
 * never shown again on any device.
 */
export const learnerNotice = pgTable(
  'learner_notice',
  {
    userId: uuid('user_id').notNull(), // C3
    notice: text('notice', { enum: ['video_badge'] }).notNull(), // C2
    seenAt: ts('seen_at').notNull(), // C3
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.notice] }),
    check('learner_notice_notice_ck', sql`${t.notice} in ('video_badge')`),
  ],
);

/**
 * US8.5: a bundle bought through the fake gateway. Pending at checkout, then succeeded or failed
 * exactly once. On success each member course gets its own payment (its part of the price, see
 * bundle_order_item), its own enrolment and its own ledger sale, in the settlement transaction.
 */
export const bundleOrder = pgTable(
  'bundle_order',
  {
    orderId: uuid('order_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    bundleId: uuid('bundle_id').notNull(), // C2
    nameBn: text('name_bn').notNull(), // C2
    nameEn: text('name_en').notNull(), // C2
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'), // C2
    gateway: text('gateway', { enum: ['fake'] })
      .notNull()
      .default('fake'), // C2
    gatewayRef: text('gateway_ref'), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    settledAt: ts('settled_at'), // C2
  },
  (t) => [
    check('bundle_order_amount_ck', sql`${t.amountPoisha} >= 1`),
    check('bundle_order_status_ck', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check('bundle_order_settled_ck', sql`(${t.status} = 'pending') = (${t.settledAt} is null)`),
    index('bundle_order_user_idx').on(t.userId, t.createdAt),
  ],
);

/** The bundle's courses at checkout: list price, its part of the bundle price and access terms. */
export const bundleOrderItem = pgTable(
  'bundle_order_item',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => bundleOrder.orderId, { onDelete: 'cascade' }), // C2
    position: integer('position').notNull(), // C2
    courseId: uuid('course_id').notNull(), // C2
    listPricePoisha: bigint('list_price_poisha', { mode: 'number' }).notNull(), // C2
    allocatedPoisha: bigint('allocated_poisha', { mode: 'number' }).notNull(), // C2
    accessDurationMonths: integer('access_duration_months').notNull(), // C2
    /** The course's own payment, once the bundle is paid. */
    paymentId: uuid('payment_id'), // C2
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    unique('bundle_order_item_course_uq').on(t.orderId, t.courseId),
    check('bundle_order_item_amount_ck', sql`${t.allocatedPoisha} >= 1`),
    check('bundle_order_item_months_ck', sql`${t.accessDurationMonths} in (4, 6, 12)`),
  ],
);
