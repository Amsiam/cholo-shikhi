// Copyright takedown notices (U11 TrustOps; US9.7, FR9.4). One state machine:
// open → honoured or rejected; honoured → reversed. Honouring hides the named content through
// Catalog (contract 5), reversing restores it. Every decision carries a reason and is audit-logged.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const TAKEDOWN_STATES = ['open', 'honoured', 'rejected', 'reversed'] as const;

export const takedownNotice = pgTable(
  'takedown_notice',
  {
    noticeId: uuid('notice_id').primaryKey().defaultRandom(), // C2
    contentType: text('content_type', { enum: ['course', 'section', 'lesson'] }).notNull(), // C2
    contentId: uuid('content_id').notNull(), // C2
    courseId: uuid('course_id').notNull(), // C2
    /** Who claims the rights, and how to reach them (as given in the notice). */
    claimant: text('claimant').notNull(), // C3
    claimantContact: text('claimant_contact').notNull(), // C3
    /** The work claimed and the evidence offered (links or a description). */
    claim: text('claim').notNull(), // C3
    evidence: text('evidence').notNull(), // C3
    state: text('state', { enum: TAKEDOWN_STATES }).notNull().default('open'), // C2
    decisionReason: text('decision_reason'), // C2
    reversalReason: text('reversal_reason'), // C2
    loggedBy: uuid('logged_by').notNull(), // C3
    loggedAt: ts('logged_at').notNull(), // C2
    decidedBy: uuid('decided_by'), // C3
    decidedAt: ts('decided_at'), // C2
    reversedBy: uuid('reversed_by'), // C3
    reversedAt: ts('reversed_at'), // C2
  },
  (t) => [
    check(
      'takedown_notice_state_ck',
      sql`${t.state} in ('open', 'honoured', 'rejected', 'reversed')`,
    ),
    check('takedown_notice_type_ck', sql`${t.contentType} in ('course', 'section', 'lesson')`),
    check('takedown_notice_decided_ck', sql`(${t.state} = 'open') = (${t.decisionReason} is null)`),
    check(
      'takedown_notice_reversed_ck',
      sql`(${t.state} = 'reversed') = (${t.reversalReason} is not null)`,
    ),
    index('takedown_notice_state_idx').on(t.state, t.loggedAt),
    index('takedown_notice_course_idx').on(t.courseId),
  ],
);

/**
 * Payment disputes (US9.3; FR9.2). Finance records a dispute against a payment (no gateway dispute
 * webhook is assumed); one dispute per payment. Its evidence pack is generated in the same
 * transaction and locked: a trigger refuses any update or delete of a pack (AC9.3.2).
 */
export const paymentDispute = pgTable(
  'payment_dispute',
  {
    disputeId: uuid('dispute_id').primaryKey().defaultRandom(), // C2
    paymentId: uuid('payment_id').notNull(), // C2
    /** The gateway's case or chargeback reference, as given by Finance. */
    gatewayCaseRef: text('gateway_case_ref').notNull(), // C2
    reason: text('reason').notNull(), // C2
    disputedPoisha: bigint('disputed_poisha', { mode: 'number' }).notNull(), // C2
    recordedBy: uuid('recorded_by').notNull(), // C3
    recordedAt: ts('recorded_at').notNull(), // C2
  },
  (t) => [
    unique('payment_dispute_payment_uq').on(t.paymentId),
    check('payment_dispute_amount_ck', sql`${t.disputedPoisha} >= 1`),
    index('payment_dispute_recorded_idx').on(t.recordedAt),
  ],
);

export const disputeEvidencePack = pgTable(
  'dispute_evidence_pack',
  {
    packId: uuid('pack_id').primaryKey().defaultRandom(), // C2
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => paymentDispute.disputeId, { onDelete: 'restrict' }), // C2
    /** The pack's sections: payment, enrolment, access log, video views, quiz scores, summary. */
    content: jsonb('content').notNull(), // C3
    sha256: text('sha256').notNull(), // C2
    lockedAt: ts('locked_at').notNull(), // C2
  },
  (t) => [
    unique('dispute_evidence_pack_dispute_uq').on(t.disputeId),
    check('dispute_evidence_pack_hash_ck', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const FRAUD_KINDS = ['vault_gaming', 'quiz_collusion', 'referral_fraud'] as const;
export const FRAUD_STATES = ['open', 'cleared', 'banned', 'reinstated'] as const;

/**
 * Fraud review queues (US4.8, US4.9, US5.15, US8.10, US8.11; screen A3). REVIEW QUEUES ONLY (the
 * human's choice): an Admin flags an account by hand with a reason; there is no automatic detector.
 * While a flag is open its hold applies (Vault items held out of resurfacing, no live-quiz shields,
 * referral quarantine). Clearing lifts the hold; banning also suspends the account (reversible:
 * reinstating lifts the suspension). At most one
 * open flag per account and kind. Every step is audit-logged.
 */
export const fraudFlag = pgTable(
  'fraud_flag',
  {
    flagId: uuid('flag_id').primaryKey().defaultRandom(), // C2
    kind: text('kind', { enum: FRAUD_KINDS }).notNull(), // C2
    userId: uuid('user_id').notNull(), // C3
    reason: text('reason').notNull(), // C3
    state: text('state', { enum: FRAUD_STATES }).notNull().default('open'), // C2
    flaggedBy: uuid('flagged_by').notNull(), // C3
    flaggedAt: ts('flagged_at').notNull(), // C2
    decisionReason: text('decision_reason'), // C3
    decidedBy: uuid('decided_by'), // C3
    decidedAt: ts('decided_at'), // C2
    /** A banned account let back in: the suspension is lifted (reversible ban). */
    reinstateReason: text('reinstate_reason'), // C3
    reinstatedBy: uuid('reinstated_by'), // C3
    reinstatedAt: ts('reinstated_at'), // C2
  },
  (t) => [
    check(
      'fraud_flag_kind_ck',
      sql`${t.kind} in ('vault_gaming', 'quiz_collusion', 'referral_fraud')`,
    ),
    check('fraud_flag_state_ck', sql`${t.state} in ('open', 'cleared', 'banned', 'reinstated')`),
    check(
      'fraud_flag_decided_ck',
      sql`(${t.state} = 'open') = (${t.decidedAt} is null and ${t.decisionReason} is null)`,
    ),
    uniqueIndex('fraud_flag_open_uq').on(t.userId, t.kind).where(sql`${t.state} = 'open'`),
    index('fraud_flag_state_idx').on(t.state, t.kind, t.flaggedAt),
  ],
);
