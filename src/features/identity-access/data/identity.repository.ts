// IdentityAccess data access. Callers pass an Executor (the database or an open transaction).
import { and, count, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '#src/server/db.ts';
import {
  accountSuspension,
  authSession,
  pushSubscription,
  rateLimitBucket,
  recoveryCode,
  staffInvitation,
  staffRoleAssignment,
  twoFactorCredential,
  userAccount,
  verificationToken,
} from '#src/server/schema/index.ts';
import type { Bucket, RateLimitedAction } from '../domain/rate-limit-policy.ts';
import type { SessionSnapshot } from '../domain/session-policy.ts';

type StaffRole = 'instructor' | 'admin' | 'finance';
const iso = (d: Date) => d.toISOString();

export function createIdentityRepository() {
  return {
    async findUserById(db: Executor, userId: string) {
      const [row] = await db.select().from(userAccount).where(eq(userAccount.id, userId)).limit(1);
      return row;
    },

    /** Display names of up to 100 users (contract 3 batched read for public instructor names). */
    async displayNames(db: Executor, userIds: readonly string[]) {
      if (userIds.length === 0) return [];
      return db
        .select({ id: userAccount.id, name: userAccount.name })
        .from(userAccount)
        .where(inArray(userAccount.id, [...userIds].slice(0, 100)))
        .limit(100);
    },

    async findUserByEmail(db: Executor, email: string) {
      const [row] = await db
        .select()
        .from(userAccount)
        .where(eq(userAccount.email, email.trim().toLowerCase()))
        .limit(1);
      return row;
    },

    async markEmailVerified(db: Executor, userId: string, at: Date) {
      await db
        .update(userAccount)
        .set({ status: 'active', emailVerifiedAt: at, updatedAt: at })
        .where(and(eq(userAccount.id, userId), eq(userAccount.status, 'unverified')));
    },

    async setLocale(db: Executor, userId: string, locale: 'bn' | 'en', at: Date) {
      await db.update(userAccount).set({ locale, updatedAt: at }).where(eq(userAccount.id, userId));
    },

    async profileOf(db: Executor, userId: string) {
      const rows = await db
        .select({
          name: userAccount.name,
          email: userAccount.email,
          phone: userAccount.phone,
          passwordChangedAt: userAccount.passwordChangedAt,
        })
        .from(userAccount)
        .where(eq(userAccount.id, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Returns false when another account already holds the phone number. */
    async updateProfile(
      db: Executor,
      userId: string,
      input: { name: string; phone: string | null },
      at: Date,
    ): Promise<boolean> {
      if (input.phone) {
        const taken = await db
          .select({ id: userAccount.id })
          .from(userAccount)
          .where(eq(userAccount.phone, input.phone))
          .limit(1);
        if (taken[0] && taken[0].id !== userId) return false;
      }
      await db
        .update(userAccount)
        .set({ name: input.name, phone: input.phone, updatedAt: at })
        .where(eq(userAccount.id, userId));
      return true;
    },

    async setPasswordChangedAt(db: Executor, userId: string, at: Date) {
      await db
        .update(userAccount)
        .set({ passwordChangedAt: at, updatedAt: at })
        .where(eq(userAccount.id, userId));
    },

    async setStatus(db: Executor, userId: string, status: 'disabled' | 'closed', at: Date) {
      await db
        .update(userAccount)
        .set({ status, ...(status === 'closed' ? { closedAt: at } : {}), updatedAt: at })
        .where(eq(userAccount.id, userId));
    },

    async anonymise(db: Executor, userId: string, at: Date) {
      await db
        .update(userAccount)
        .set({
          email: `closed+${userId}@invalid.invalid`,
          name: '',
          image: null,
          status: 'closed',
          closedAt: at,
          updatedAt: at,
        })
        .where(eq(userAccount.id, userId));
    },

    // ------------------------------------------------------------- suspension
    async activeSuspension(db: Executor, userId: string) {
      const [row] = await db
        .select()
        .from(accountSuspension)
        .where(and(eq(accountSuspension.userId, userId), isNull(accountSuspension.reinstatedAt)))
        .limit(1);
      return row;
    },

    /** Inserts the active suspension; undefined when the account is already suspended. */
    async suspend(
      db: Executor,
      row: { userId: string; reason: string; source: string; suspendedBy: string; at: Date },
    ) {
      const [created] = await db
        .insert(accountSuspension)
        .values({
          userId: row.userId,
          reason: row.reason,
          source: row.source,
          suspendedBy: row.suspendedBy,
          suspendedAt: row.at,
        })
        .onConflictDoNothing()
        .returning();
      return created;
    },

    /** Lifts the active suspension; undefined when there is none. */
    async reinstate(
      db: Executor,
      row: { userId: string; reason: string; reinstatedBy: string; at: Date },
    ) {
      const [lifted] = await db
        .update(accountSuspension)
        .set({ reinstateReason: row.reason, reinstatedBy: row.reinstatedBy, reinstatedAt: row.at })
        .where(
          and(eq(accountSuspension.userId, row.userId), isNull(accountSuspension.reinstatedAt)),
        )
        .returning();
      return lifted;
    },

    // ---------------------------------------------------------------- sessions
    async findSession(db: Executor, sessionId: string) {
      const [row] = await db
        .select()
        .from(authSession)
        .where(eq(authSession.id, sessionId))
        .limit(1);
      return row;
    },

    async updateSession(db: Executor, sessionId: string, next: SessionSnapshot) {
      await db
        .update(authSession)
        .set({
          tier: next.tier,
          state: next.state,
          tierAnchorAt: new Date(next.tierAnchorAt),
          lastActiveAt: new Date(next.lastActiveAt),
          stepUpVerifiedAt: next.stepUpVerifiedAt ? new Date(next.stepUpVerifiedAt) : null,
        })
        .where(eq(authSession.id, sessionId));
    },

    async activateSessionStepUp(db: Executor, sessionId: string, at: Date) {
      await db
        .update(authSession)
        .set({ state: 'active', stepUpVerifiedAt: at, lastActiveAt: at })
        .where(eq(authSession.id, sessionId));
    },

    async deleteSession(db: Executor, sessionId: string) {
      await db.delete(authSession).where(eq(authSession.id, sessionId));
    },

    async deleteSessionsOfUser(db: Executor, userId: string, exceptSessionId?: string) {
      await db
        .delete(authSession)
        .where(
          and(
            eq(authSession.userId, userId),
            exceptSessionId ? ne(authSession.id, exceptSessionId) : undefined,
          ),
        );
    },

    async revokePushForSession(
      db: Executor,
      sessionId: string,
      reason: 'sign_out' | 'session_ended',
      at: Date,
    ) {
      await db
        .update(pushSubscription)
        .set({ revokedAt: at, revokeReason: reason })
        .where(and(eq(pushSubscription.sessionId, sessionId), isNull(pushSubscription.revokedAt)));
    },

    // ----------------------------------------------------------- single-use links
    /** Issues a link token and invalidates every older unused one of the same purpose (BR2.6, BR2.8). */
    async issueToken(
      db: Executor,
      input: {
        userId: string;
        purpose: 'email_verification' | 'password_reset';
        tokenHash: string;
        expiresAt: Date;
        now: Date;
      },
    ) {
      await db
        .update(verificationToken)
        .set({ invalidatedAt: input.now })
        .where(
          and(
            eq(verificationToken.userId, input.userId),
            eq(verificationToken.purpose, input.purpose),
            isNull(verificationToken.usedAt),
            isNull(verificationToken.invalidatedAt),
          ),
        );
      await db.insert(verificationToken).values({
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        expiresAt: input.expiresAt,
      });
    },

    async findValidToken(
      db: Executor,
      purpose: 'email_verification' | 'password_reset',
      tokenHash: string,
      now: Date,
    ) {
      const [row] = await db
        .select()
        .from(verificationToken)
        .where(
          and(
            eq(verificationToken.tokenHash, tokenHash),
            eq(verificationToken.purpose, purpose),
            isNull(verificationToken.usedAt),
            isNull(verificationToken.invalidatedAt),
            gt(verificationToken.expiresAt, now),
          ),
        )
        .limit(1);
      return row;
    },

    /** Marks a token used; returns false if another request used it first. */
    async consumeToken(db: Executor, tokenId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(verificationToken)
        .set({ usedAt: now })
        .where(and(eq(verificationToken.tokenId, tokenId), isNull(verificationToken.usedAt)))
        .returning({ tokenId: verificationToken.tokenId });
      return rows.length === 1;
    },

    // ------------------------------------------------------------- rate limits
    async getBucket(db: Executor, bucketKey: string): Promise<Bucket | null> {
      const [row] = await db
        .select()
        .from(rateLimitBucket)
        .where(eq(rateLimitBucket.bucketKey, bucketKey))
        .limit(1);
      return row
        ? {
            windowStartedAt: iso(row.windowStartedAt),
            failureCount: row.failureCount,
            blockedUntil: row.blockedUntil ? iso(row.blockedUntil) : null,
          }
        : null;
    },

    async saveBucket(db: Executor, bucketKey: string, action: RateLimitedAction, bucket: Bucket) {
      const values = {
        windowStartedAt: new Date(bucket.windowStartedAt),
        failureCount: bucket.failureCount,
        blockedUntil: bucket.blockedUntil ? new Date(bucket.blockedUntil) : null,
      };
      await db
        .insert(rateLimitBucket)
        .values({ bucketKey, action, ...values })
        .onConflictDoUpdate({ target: rateLimitBucket.bucketKey, set: values });
    },

    async deleteBucket(db: Executor, bucketKey: string) {
      await db.delete(rateLimitBucket).where(eq(rateLimitBucket.bucketKey, bucketKey));
    },

    // ------------------------------------------------------------------- roles
    async activeStaffRoles(db: Executor, userId: string): Promise<StaffRole[]> {
      const rows = await db
        .select({ role: staffRoleAssignment.role })
        .from(staffRoleAssignment)
        .where(and(eq(staffRoleAssignment.userId, userId), isNull(staffRoleAssignment.revokedAt)));
      return rows.map((r) => r.role);
    },

    /** US7.16 (AC7.16.4): every active instructor assignment of this instructor type. */
    async activeInstructorIdsOfType(
      db: Executor,
      instructorType: 'employee' | 'contractor',
    ): Promise<string[]> {
      const rows = await db
        .select({ userId: staffRoleAssignment.userId })
        .from(staffRoleAssignment)
        .where(
          and(
            eq(staffRoleAssignment.role, 'instructor'),
            eq(staffRoleAssignment.instructorType, instructorType),
            isNull(staffRoleAssignment.revokedAt),
          ),
        )
        .orderBy(staffRoleAssignment.userId);
      return rows.map((r) => r.userId);
    },

    /** Every active staff assignment with the account's name and email (Admin staff screen). */
    async activeStaff(db: Executor) {
      return db
        .select({
          userId: staffRoleAssignment.userId,
          role: staffRoleAssignment.role,
          instructorType: staffRoleAssignment.instructorType,
          assignedAt: staffRoleAssignment.assignedAt,
          name: userAccount.name,
          email: userAccount.email,
          hasTwoStep: sql<boolean>`exists (select 1 from two_factor_credential c where c.user_id = ${staffRoleAssignment.userId} and c.status = 'active')`,
        })
        .from(staffRoleAssignment)
        .innerJoin(userAccount, eq(userAccount.id, staffRoleAssignment.userId))
        .where(isNull(staffRoleAssignment.revokedAt))
        .orderBy(userAccount.name)
        .limit(500);
    },

    // ------------------------------------------------------------ staff invitations
    async insertInvitation(
      db: Executor,
      input: {
        userId: string;
        role: StaffRole;
        instructorType: 'employee' | 'contractor' | null;
        tokenHash: string;
        invitedBy: string;
        expiresAt: Date;
        at: Date;
      },
    ) {
      const [row] = await db
        .insert(staffInvitation)
        .values({
          userId: input.userId,
          role: input.role,
          instructorType: input.instructorType,
          tokenHash: input.tokenHash,
          invitedBy: input.invitedBy,
          expiresAt: input.expiresAt,
          createdAt: input.at,
        })
        .returning({ invitationId: staffInvitation.invitationId });
      return row as { invitationId: string };
    },

    /** The open (neither accepted nor cancelled) invitation for this person and role, if any. */
    async openInvitationFor(db: Executor, userId: string, role: StaffRole) {
      const [row] = await db
        .select()
        .from(staffInvitation)
        .where(
          and(
            eq(staffInvitation.userId, userId),
            eq(staffInvitation.role, role),
            isNull(staffInvitation.acceptedAt),
            isNull(staffInvitation.cancelledAt),
          ),
        )
        .limit(1);
      return row;
    },

    /** An invitation and its invitee, by token hash or by id. */
    async invitationWithUser(db: Executor, by: { tokenHash: string } | { invitationId: string }) {
      const [row] = await db
        .select({
          invitation: staffInvitation,
          name: userAccount.name,
          email: userAccount.email,
          locale: userAccount.locale,
          status: userAccount.status,
        })
        .from(staffInvitation)
        .innerJoin(userAccount, eq(userAccount.id, staffInvitation.userId))
        .where(
          'tokenHash' in by
            ? eq(staffInvitation.tokenHash, by.tokenHash)
            : eq(staffInvitation.invitationId, by.invitationId),
        )
        .limit(1);
      return row;
    },

    /** Open invitations, newest first, with the invitee. */
    async openInvitations(db: Executor) {
      return db
        .select({
          invitationId: staffInvitation.invitationId,
          userId: staffInvitation.userId,
          role: staffInvitation.role,
          instructorType: staffInvitation.instructorType,
          invitedBy: staffInvitation.invitedBy,
          createdAt: staffInvitation.createdAt,
          expiresAt: staffInvitation.expiresAt,
          name: userAccount.name,
          email: userAccount.email,
        })
        .from(staffInvitation)
        .innerJoin(userAccount, eq(userAccount.id, staffInvitation.userId))
        .where(and(isNull(staffInvitation.acceptedAt), isNull(staffInvitation.cancelledAt)))
        .orderBy(desc(staffInvitation.createdAt))
        .limit(200);
    },

    /** Claims an open, unexpired invitation; false when it was used, cancelled or has expired. */
    async acceptInvitation(db: Executor, invitationId: string, at: Date): Promise<boolean> {
      const rows = await db
        .update(staffInvitation)
        .set({ acceptedAt: at })
        .where(
          and(
            eq(staffInvitation.invitationId, invitationId),
            isNull(staffInvitation.acceptedAt),
            isNull(staffInvitation.cancelledAt),
            gt(staffInvitation.expiresAt, at),
          ),
        )
        .returning({ id: staffInvitation.invitationId });
      return rows.length > 0;
    },

    async cancelInvitation(db: Executor, invitationId: string, by: string, at: Date) {
      const rows = await db
        .update(staffInvitation)
        .set({ cancelledAt: at, cancelledBy: by })
        .where(
          and(
            eq(staffInvitation.invitationId, invitationId),
            isNull(staffInvitation.acceptedAt),
            isNull(staffInvitation.cancelledAt),
          ),
        )
        .returning({ id: staffInvitation.invitationId });
      return rows.length > 0;
    },

    /** A new link for an open invitation: the old token stops working. */
    async renewInvitation(db: Executor, invitationId: string, tokenHash: string, expiresAt: Date) {
      const rows = await db
        .update(staffInvitation)
        .set({ tokenHash, expiresAt })
        .where(
          and(
            eq(staffInvitation.invitationId, invitationId),
            isNull(staffInvitation.acceptedAt),
            isNull(staffInvitation.cancelledAt),
          ),
        )
        .returning({ id: staffInvitation.invitationId });
      return rows.length > 0;
    },

    /** The invitee proved they own the email by using the link: the account becomes active. */
    async activateInvitedAccount(db: Executor, userId: string, at: Date) {
      await db
        .update(userAccount)
        .set({
          emailVerified: true,
          emailVerifiedAt: sql`coalesce(${userAccount.emailVerifiedAt}, ${at})`,
          status: 'active',
          updatedAt: at,
        })
        .where(
          and(eq(userAccount.id, userId), inArray(userAccount.status, ['unverified', 'active'])),
        );
    },

    /** Every role this account has held, current and taken away, newest first. */
    async assignmentsOf(db: Executor, userId: string) {
      return db
        .select({
          role: staffRoleAssignment.role,
          instructorType: staffRoleAssignment.instructorType,
          assignedBy: staffRoleAssignment.assignedBy,
          assignedAt: staffRoleAssignment.assignedAt,
          revokedBy: staffRoleAssignment.revokedBy,
          revokedAt: staffRoleAssignment.revokedAt,
        })
        .from(staffRoleAssignment)
        .where(eq(staffRoleAssignment.userId, userId))
        .orderBy(desc(staffRoleAssignment.assignedAt))
        .limit(100);
    },

    async activeAssignment(db: Executor, userId: string, role: StaffRole) {
      const [row] = await db
        .select()
        .from(staffRoleAssignment)
        .where(
          and(
            eq(staffRoleAssignment.userId, userId),
            eq(staffRoleAssignment.role, role),
            isNull(staffRoleAssignment.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async insertAssignment(
      db: Executor,
      input: {
        userId: string;
        role: StaffRole;
        instructorType: 'employee' | 'contractor' | null;
        assignedBy: string;
        at: Date;
      },
    ) {
      const [row] = await db
        .insert(staffRoleAssignment)
        .values({
          userId: input.userId,
          role: input.role,
          instructorType: input.instructorType,
          assignedBy: input.assignedBy,
          assignedAt: input.at,
        })
        .returning();
      return row as typeof staffRoleAssignment.$inferSelect;
    },

    async revokeAssignment(db: Executor, roleAssignmentId: string, revokedBy: string, at: Date) {
      await db
        .update(staffRoleAssignment)
        .set({ revokedBy, revokedAt: at })
        .where(eq(staffRoleAssignment.roleAssignmentId, roleAssignmentId));
    },

    /** Active Admin assignments on active accounts other than `userId`, locked for the transaction (BR4.6). */
    async lockOtherActiveAdmins(db: Executor, userId: string): Promise<number> {
      const rows = await db
        .select({ id: staffRoleAssignment.roleAssignmentId })
        .from(staffRoleAssignment)
        .innerJoin(userAccount, eq(userAccount.id, staffRoleAssignment.userId))
        .where(
          and(
            eq(staffRoleAssignment.role, 'admin'),
            isNull(staffRoleAssignment.revokedAt),
            ne(staffRoleAssignment.userId, userId),
            eq(userAccount.status, 'active'),
          ),
        )
        .for('update', { of: staffRoleAssignment });
      return rows.length;
    },

    async countActiveAdmins(db: Executor): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(staffRoleAssignment)
        .where(and(eq(staffRoleAssignment.role, 'admin'), isNull(staffRoleAssignment.revokedAt)));
      return row?.n ?? 0;
    },

    // -------------------------------------------------------------- two-factor
    async credentialFor(db: Executor, userId: string, status: 'pending_confirmation' | 'active') {
      const [row] = await db
        .select()
        .from(twoFactorCredential)
        .where(and(eq(twoFactorCredential.userId, userId), eq(twoFactorCredential.status, status)))
        .orderBy(desc(twoFactorCredential.enrolledAt))
        .limit(1);
      return row;
    },

    async hasActiveCredential(db: Executor, userId: string): Promise<boolean> {
      const [row] = await db
        .select({ n: count() })
        .from(twoFactorCredential)
        .where(
          and(eq(twoFactorCredential.userId, userId), eq(twoFactorCredential.status, 'active')),
        );
      return (row?.n ?? 0) > 0;
    },

    async startEnrolment(db: Executor, userId: string, sealedSecret: string, at: Date) {
      await db
        .update(twoFactorCredential)
        .set({ status: 'revoked', revokedAt: at })
        .where(
          and(
            eq(twoFactorCredential.userId, userId),
            eq(twoFactorCredential.status, 'pending_confirmation'),
          ),
        );
      const [row] = await db
        .insert(twoFactorCredential)
        .values({ userId, totpSecretRef: sealedSecret, enrolledAt: at })
        .returning({ id: twoFactorCredential.twoFactorCredentialId });
      return (row as { id: string }).id;
    },

    async activateCredential(
      db: Executor,
      credentialId: string,
      userId: string,
      step: number,
      at: Date,
    ) {
      await db
        .update(twoFactorCredential)
        .set({ status: 'revoked', revokedAt: at })
        .where(
          and(eq(twoFactorCredential.userId, userId), eq(twoFactorCredential.status, 'active')),
        );
      await db
        .update(twoFactorCredential)
        .set({ status: 'active', confirmedAt: at, lastAcceptedStep: step })
        .where(eq(twoFactorCredential.twoFactorCredentialId, credentialId));
    },

    /** Replay guard (item vi): only advances when `step` is newer than the last accepted step. */
    async acceptStep(db: Executor, credentialId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(twoFactorCredential)
        .set({ lastAcceptedStep: step })
        .where(
          and(
            eq(twoFactorCredential.twoFactorCredentialId, credentialId),
            or(
              isNull(twoFactorCredential.lastAcceptedStep),
              sql`${twoFactorCredential.lastAcceptedStep} < ${step}`,
            ),
          ),
        )
        .returning({ id: twoFactorCredential.twoFactorCredentialId });
      return rows.length === 1;
    },

    async revokeCredential(db: Executor, credentialId: string, at: Date) {
      await db
        .update(twoFactorCredential)
        .set({ status: 'revoked', revokedAt: at })
        .where(eq(twoFactorCredential.twoFactorCredentialId, credentialId));
    },

    async insertRecoveryCodes(db: Executor, credentialId: string, codeHashes: readonly string[]) {
      await db
        .insert(recoveryCode)
        .values(codeHashes.map((codeHash) => ({ twoFactorCredentialId: credentialId, codeHash })));
    },

    /** Spends an unused recovery code; returns false if it does not exist or was already used (BR5.7). */
    async spendRecoveryCode(
      db: Executor,
      credentialId: string,
      codeHash: string,
      at: Date,
    ): Promise<boolean> {
      const rows = await db
        .update(recoveryCode)
        .set({ usedAt: at })
        .where(
          and(
            eq(recoveryCode.twoFactorCredentialId, credentialId),
            eq(recoveryCode.codeHash, codeHash),
            isNull(recoveryCode.usedAt),
          ),
        )
        .returning({ id: recoveryCode.recoveryCodeId });
      return rows.length === 1;
    },
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
