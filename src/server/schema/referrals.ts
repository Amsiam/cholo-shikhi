// Referrals (U3 Marketing; US8.6–US8.9, FR8.2). A Student's opaque referral code, and who signed up
// through whose link. Earnings never live here: they are ledger postings (referral_accrual,
// referral_clawback, referral_payout on the referrer's referral_payable account), so a balance is
// always the ledger's sum. Cross-unit IDs (users) are not foreign keys (ADR-020).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** AC8.6.1: one opaque code per account; the link carries the code and nothing personal. */
export const referralCode = pgTable(
  'referral_code',
  {
    userId: uuid('user_id').primaryKey(), // C3
    code: text('code').notNull(), // C2
    createdAt: ts('created_at').notNull().defaultNow(), // C2
    /** AC8.9.2: when the referrer declared they are 18 or older (needed for KYC and payouts). */
    adultDeclaredAt: ts('adult_declared_at'), // C3
  },
  (t) => [
    unique('referral_code_code_uq').on(t.code),
    check('referral_code_code_ck', sql`${t.code} ~ '^[A-HJ-NP-Z2-9]{10}$'`),
  ],
);

/** Who signed up through whose link: at most one referrer per account, never oneself. */
export const referralAttribution = pgTable(
  'referral_attribution',
  {
    referredUserId: uuid('referred_user_id').primaryKey(), // C3
    referrerUserId: uuid('referrer_user_id').notNull(), // C3
    code: text('code').notNull(), // C2
    attributedAt: ts('attributed_at').notNull().defaultNow(), // C2
  },
  (t) => [
    check('referral_attribution_self_ck', sql`${t.referredUserId} <> ${t.referrerUserId}`),
    index('referral_attribution_referrer_idx').on(t.referrerUserId, t.attributedAt),
  ],
);

export const REFERRAL_WITHDRAWAL_STATES = ['requested', 'paid', 'rejected'] as const;

/**
 * US8.8: a referrer asks to withdraw their whole balance; the owner-operator (an Admin with
 * two-step sign-in) approves it in the product, which pays it through the disbursement stub and
 * posts the referral_payout, or rejects it with a reason. One open request per referrer.
 */
export const referralWithdrawal = pgTable(
  'referral_withdrawal',
  {
    withdrawalId: uuid('withdrawal_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id').notNull(), // C3
    amountPoisha: bigint('amount_poisha', { mode: 'number' }).notNull(), // C2
    status: text('status', { enum: REFERRAL_WITHDRAWAL_STATES }).notNull().default('requested'), // C2
    /** The verified payout account at request time (masked). */
    rail: text('rail', { enum: ['bkash', 'nagad', 'bank'] }).notNull(), // C3
    accountMasked: text('account_masked').notNull(), // C3
    requestedAt: ts('requested_at').notNull(), // C2
    decidedBy: uuid('decided_by'), // C3
    decidedAt: ts('decided_at'), // C2
    reason: text('reason'), // C3
    /** The disbursement stub's reference once paid. */
    providerRef: text('provider_ref'), // C2
  },
  (t) => [
    check('referral_withdrawal_amount_ck', sql`${t.amountPoisha} >= 1`),
    check('referral_withdrawal_status_ck', sql`${t.status} in ('requested', 'paid', 'rejected')`),
    check(
      'referral_withdrawal_decided_ck',
      sql`(${t.status} = 'requested') = (${t.decidedAt} is null)`,
    ),
    check(
      'referral_withdrawal_paid_ck',
      sql`(${t.status} = 'paid') = (${t.providerRef} is not null)`,
    ),
    uniqueIndex('referral_withdrawal_open_uq').on(t.userId).where(sql`${t.status} = 'requested'`),
    index('referral_withdrawal_status_idx').on(t.status, t.requestedAt),
  ],
);
