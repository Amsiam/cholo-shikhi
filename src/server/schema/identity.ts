// IdentityAccess tables (entities.md). Better Auth owns user_account, auth_session, auth_account,
// auth_verification and auth_rate_limit; the property names below are Better Auth's field names.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userAccount = pgTable(
  'user_account',
  {
    id: uuid('user_id').primaryKey().defaultRandom(),
    // Better Auth requires `name`; it holds the optional display name (max 80, may be empty).
    name: text('display_name').notNull().default(''),
    // Lower-cased, trimmed full address; plus tags and dots kept (BR2.2).
    email: text('email_normalised').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifiedAt: ts('email_verified_at'),
    image: text('image'),
    locale: text('locale', { enum: ['bn', 'en'] })
      .notNull()
      .default('bn'),
    status: text('status', { enum: ['unverified', 'active', 'disabled', 'closed'] })
      .notNull()
      .default('unverified'),
    studentNumber: text('student_number'),
    /** Bangladeshi mobile number, +8801XXXXXXXXX; unverified until SMS ships (Q15). One account per number. */
    phone: text('phone_e164'),
    passwordChangedAt: ts('password_changed_at'),
    closedAt: ts('closed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_account_email_uq').on(t.email),
    uniqueIndex('user_account_student_number_uq').on(t.studentNumber),
    uniqueIndex('user_account_phone_uq').on(t.phone).where(sql`${t.phone} is not null`),
  ],
);

export const authSession = pgTable(
  'auth_session',
  {
    id: uuid('session_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    // SHA-256 of the cookie token; the raw token is never stored (BR3.5).
    token: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    tier: text('tier', { enum: ['student', 'staff'] })
      .notNull()
      .default('student'),
    state: text('state', {
      enum: ['pending_enrolment', 'pending_challenge', 'active', 'expired', 'revoked'],
    })
      .notNull()
      .default('active'),
    stepUpVerifiedAt: ts('step_up_verified_at'),
    tierAnchorAt: ts('tier_anchor_at').notNull().defaultNow(),
    lastActiveAt: ts('last_active_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    endReason: text('end_reason'),
    deviceLabel: text('device_label'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_session_token_uq').on(t.token),
    index('auth_session_user_idx').on(t.userId),
  ],
);

export const authAccount = pgTable(
  'auth_account',
  {
    id: uuid('account_id').primaryKey().defaultRandom(),
    accountId: text('provider_account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    // Better Auth's default adaptive (scrypt) hash; never logged.
    password: text('password_hash'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('auth_account_user_idx').on(t.userId)],
);

export const authVerification = pgTable(
  'auth_verification',
  {
    id: uuid('verification_id').primaryKey().defaultRandom(),
    // Stored hashed (Better Auth verification.storeIdentifier = 'hashed').
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
);

export const authRateLimit = pgTable('auth_rate_limit', {
  id: uuid('rate_limit_id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  // Better Auth writes epoch MILLISECONDS here (column name kept from migration 0000; see COMMENT in 0003).
  lastRequest: bigint('last_request_epoch_s', { mode: 'number' }).notNull(),
});

/** Single-use verification and reset links (BR2.6, BR2.8). Only a hash of the token is stored. */
export const verificationToken = pgTable(
  'verification_token',
  {
    tokenId: uuid('token_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['email_verification', 'password_reset'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    invalidatedAt: ts('invalidated_at'),
  },
  (t) => [
    uniqueIndex('verification_token_hash_uq').on(t.tokenHash),
    index('verification_token_user_purpose_idx').on(t.userId, t.purpose),
  ],
);

/** Failure counters keyed by action + keyed hash of the identifier; never the raw email (item iii). */
export const rateLimitBucket = pgTable('rate_limit_bucket', {
  bucketKey: text('bucket_key').primaryKey(),
  action: text('action', {
    enum: ['sign_in', 'sign_up', 'reset_request', 'verification_resend', 'two_factor'],
  }).notNull(),
  windowStartedAt: ts('window_started_at').notNull(),
  failureCount: integer('failure_count').notNull().default(0),
  blockedUntil: ts('blocked_until'),
});

export const staffRoleAssignment = pgTable(
  'staff_role_assignment',
  {
    roleAssignmentId: uuid('role_assignment_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id),
    role: text('role', { enum: ['instructor', 'admin', 'finance'] }).notNull(),
    instructorType: text('instructor_type', { enum: ['employee', 'contractor'] }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => userAccount.id),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    revokedBy: uuid('revoked_by').references(() => userAccount.id),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    // BR4.8: a role at most once at a time.
    uniqueIndex('staff_role_active_uq').on(t.userId, t.role).where(sql`${t.revokedAt} is null`),
  ],
);

export const twoFactorCredential = pgTable(
  'two_factor_credential',
  {
    twoFactorCredentialId: uuid('two_factor_credential_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    // AES-256-GCM ciphertext of the TOTP secret (BR5.8); never returned after enrolment.
    totpSecretRef: text('totp_secret_ref').notNull(),
    status: text('status', { enum: ['pending_confirmation', 'active', 'revoked'] })
      .notNull()
      .default('pending_confirmation'),
    lastAcceptedStep: integer('last_accepted_step'),
    enrolledAt: ts('enrolled_at').notNull().defaultNow(),
    confirmedAt: ts('confirmed_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('two_factor_active_uq').on(t.userId).where(sql`${t.status} = 'active'`)],
);

export const recoveryCode = pgTable(
  'recovery_code',
  {
    recoveryCodeId: uuid('recovery_code_id').primaryKey().defaultRandom(),
    twoFactorCredentialId: uuid('two_factor_credential_id')
      .notNull()
      .references(() => twoFactorCredential.twoFactorCredentialId, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [index('recovery_code_credential_idx').on(t.twoFactorCredentialId)],
);

/**
 * Account suspension (fraud ban, US8.11): an Admin-only, audited and reversible block that is
 * separate from account closure (U12). While a row has no `reinstatedAt`, the account cannot sign
 * in and every session ends. At most one active suspension per account.
 */
export const accountSuspension = pgTable(
  'account_suspension',
  {
    suspensionId: uuid('suspension_id').primaryKey().defaultRandom(), // C2
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }), // C3
    reason: text('reason').notNull(), // C3
    /** What led to it, e.g. `fraud_flag:<id>`. */
    source: text('source').notNull(), // C2
    suspendedBy: uuid('suspended_by').notNull(), // C3
    suspendedAt: ts('suspended_at').notNull(), // C2
    reinstateReason: text('reinstate_reason'), // C3
    reinstatedBy: uuid('reinstated_by'), // C3
    reinstatedAt: ts('reinstated_at'), // C2
  },
  (t) => [
    uniqueIndex('account_suspension_active_uq').on(t.userId).where(sql`${t.reinstatedAt} is null`),
    index('account_suspension_user_idx').on(t.userId, t.suspendedAt),
  ],
);
