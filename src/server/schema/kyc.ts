// KYC and payout accounts (U9; US7.19–US7.21). Bangladesh-hosted only (NFR5). Data class C4
// (sensitive personal) for identity numbers, account numbers and NID images:
// - NID and account numbers are stored only AES-256-GCM encrypted (KYC_ENCRYPTION_KEY), next to a
//   masked form (last 3 digits) for display; they never reach logs, events or error reports.
// - NID photos live in Bangladesh-hosted object storage under kyc/<user>/...; only their keys and
//   SHA-256 hashes are stored here (the hash lets TrustOps spot a document shared by two accounts
//   without ever reading it, ADR-010).
// Cross-unit IDs (users) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const KYC_STATUSES = ['submitted', 'verified', 'rejected'] as const;
export const PAYOUT_RAILS = ['bkash', 'nagad', 'bank'] as const;
export const ACCOUNT_STATUSES = ['pending', 'verified', 'rejected'] as const;

/** One row per submission; the newest row is the Student's current KYC. */
export const kycSubmission = pgTable(
  'kyc_submission',
  {
    submissionId: uuid('submission_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    partyType: text('party_type', { enum: ['instructor', 'referrer'] }).notNull(), // C2
    legalName: text('legal_name').notNull(), // C3
    nidNumberSealed: text('nid_number_sealed').notNull(), // C4
    nidMasked: text('nid_masked').notNull(), // C3
    frontObjectKey: text('front_object_key').notNull(), // C4
    backObjectKey: text('back_object_key').notNull(), // C4
    frontSha256: text('front_sha256').notNull(), // C4
    backSha256: text('back_sha256').notNull(), // C4
    status: text('status', { enum: KYC_STATUSES }).notNull().default('submitted'), // C3
    /** Finance's reason for a rejection, shown to the instructor. */
    reason: text('reason'), // C3
    submittedAt: ts('submitted_at').notNull(), // C3
    decidedAt: ts('decided_at'), // C3
    decidedBy: uuid('decided_by'), // C3
  },
  (t) => [
    check('kyc_submission_status_ck', sql`${t.status} in ('submitted', 'verified', 'rejected')`),
    check('kyc_submission_party_ck', sql`${t.partyType} in ('instructor', 'referrer')`),
    check('kyc_submission_name_ck', sql`char_length(${t.legalName}) between 2 and 120`),
    index('kyc_submission_user_idx').on(t.userId, t.submittedAt),
    index('kyc_submission_queue_idx').on(t.status, t.submittedAt),
  ],
);

/**
 * Payout accounts (US7.20). A Student has at most one current account; a change makes a new row
 * that waits for Finance, and payouts are held until it is verified (AC7.20.3).
 */
export const payoutAccount = pgTable(
  'payout_account',
  {
    payoutAccountId: uuid('payout_account_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    rail: text('rail', { enum: PAYOUT_RAILS }).notNull(), // C3
    accountName: text('account_name').notNull(), // C3
    accountSealed: text('account_sealed').notNull(), // C4
    accountMasked: text('account_masked').notNull(), // C3
    /** Bank accounts only: bank name, branch and routing number (not secret). */
    bankName: text('bank_name'), // C3
    branchName: text('branch_name'), // C3
    routingNumber: text('routing_number'), // C3
    status: text('status', { enum: ACCOUNT_STATUSES }).notNull().default('pending'), // C3
    reason: text('reason'), // C3
    isCurrent: boolean('is_current').notNull().default(true), // C2
    createdAt: ts('created_at').notNull(), // C3
    decidedAt: ts('decided_at'), // C3
    decidedBy: uuid('decided_by'), // C3
  },
  (t) => [
    check('payout_account_rail_ck', sql`${t.rail} in ('bkash', 'nagad', 'bank')`),
    check('payout_account_status_ck', sql`${t.status} in ('pending', 'verified', 'rejected')`),
    check(
      'payout_account_bank_ck',
      sql`${t.rail} <> 'bank' or (${t.bankName} is not null and ${t.routingNumber} is not null)`,
    ),
    uniqueIndex('payout_account_current_uq').on(t.userId).where(sql`${t.isCurrent}`),
    index('payout_account_queue_idx').on(t.status, t.createdAt),
  ],
);
