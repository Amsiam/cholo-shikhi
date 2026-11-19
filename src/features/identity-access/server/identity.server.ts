// IdentityAccess: Better Auth plus the custom items (i)–(vii) of the NFR security design, contract 3's
// identity functions, staff roles and the staff two-step check. Server-only.
import { randomBytes } from 'node:crypto';
import type { EmailSender } from '#src/features/notifications/server/email-sender.server.ts';
import type { Instrument } from '#src/features/platform/domain/instrumentation.ts';
import { createAudit } from '#src/features/platform/server/audit.server.ts';
import { correlationIdFrom, currentCorrelationId } from '#src/lib/correlation.ts';
import { type AppError, appError, fromZodError } from '#src/lib/errors.ts';
import { translate } from '#src/lib/i18n/index.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import {
  type AuthUser,
  createAuth,
  RESET_VALIDITY_SECONDS,
  VERIFICATION_VALIDITY_SECONDS,
} from '#src/server/auth.server.ts';
import { decryptSecret, encryptSecret, keyedHash, sha256Hex } from '#src/server/crypto.server.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createIdentityRepository } from '../data/identity.repository.ts';
import type { Actor, InstructorType, Role, StaffRole } from '../domain/actor.schema.ts';
import {
  DEFAULT_RATE_LIMITS,
  isBlocked,
  type RateLimitedAction,
  recordAttempt,
} from '../domain/rate-limit-policy.ts';
import { canManageRoles, checkAssign, checkRevoke } from '../domain/roles.ts';
import {
  evaluateSession,
  hasStepUp,
  type SessionSnapshot,
  type SessionState,
} from '../domain/session-policy.ts';
import { base32Encode, groupSetupKey, otpauthUri, verifyTotp } from '../domain/totp.ts';
import {
  LocaleInput,
  RecoveryCodeInput,
  ResendVerificationInput,
  ResetPasswordInput,
  ResetRequestInput,
  SignInInput,
  SignUpInput,
  TwoFactorCodeInput,
} from './auth.schema.ts';

export type IdentityEnv = {
  APP_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  IDENTIFIER_HASH_KEY: string;
  TOTP_ENCRYPTION_KEY: string;
  TRUSTED_ORIGINS: readonly string[];
};

export type IdentityDeps = {
  db: Database;
  env: IdentityEnv;
  emailSender: EmailSender;
  clock: Clock;
  metrics: Metrics;
  instrument?: Instrument;
};

const SIGNUP_DEVICE_COOKIE = 'cs_signup_device';
const RECOVERY_CODE_COUNT = 10;
const ALLOWED_AUTH_ROUTES = new Set([
  'POST /sign-up/email',
  'POST /sign-in/email',
  'POST /sign-out',
  'GET /verify-email',
  'POST /request-password-reset',
  'POST /reset-password',
  'POST /change-password',
  'GET /ok',
]);

type ResolvedSession = {
  sessionId: string;
  userId: string;
  locale: 'bn' | 'en';
  email: string;
  staffRoles: StaffRole[];
  snapshot: SessionSnapshot;
};

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function errorResponse(status: number, error: AppError): Response {
  return json(status, {
    code: error.code,
    i18nKey: error.i18nKey,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function originOf(referer: string | null): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function forward(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}

function sessionTokenFromSetCookie(response: Response): string | undefined {
  for (const raw of response.headers.getSetCookie()) {
    const match = /session_token=([^;]+)/.exec(raw);
    if (match?.[1]) return decodeURIComponent(match[1]).split('.')[0];
  }
  return undefined;
}

function toSnapshot(row: {
  tier: 'student' | 'staff';
  state: SessionState;
  createdAt: Date;
  tierAnchorAt: Date;
  lastActiveAt: Date;
  stepUpVerifiedAt: Date | null;
}): SessionSnapshot {
  return {
    tier: row.tier,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    tierAnchorAt: row.tierAnchorAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    stepUpVerifiedAt: row.stepUpVerifiedAt ? row.stepUpVerifiedAt.toISOString() : null,
  };
}

export function createIdentity(deps: IdentityDeps) {
  const { db, env, clock } = deps;
  const repo = createIdentityRepository();
  const audit = createAudit({ clock });
  const log = getLogger().child({ component: 'identity' });
  const instrument: Instrument = deps.instrument ?? {
    emit: () => undefined,
    flush: async () => undefined,
  };
  const now = () => new Date(clock.now());
  const correlation = () => currentCorrelationId() ?? correlationIdFrom(null);
  const emit = (eventName: string, properties?: Record<string, string | number | boolean>) =>
    instrument.emit({
      eventName,
      featureArea: 'identity',
      correlationId: correlation(),
      ...(properties ? { properties } : {}),
    });

  const auth = createAuth({
    db,
    env,
    callbacks: {
      sendVerificationEmail: ({ user, token }) => sendAuthEmail(user, token, 'verify'),
      sendResetPassword: ({ user, token }) => sendAuthEmail(user, token, 'reset'),
    },
  });

  // --------------------------------------------------------------- auth emails
  /** BR2.10/BR6.4: sent straight to the email service in the account's language. */
  async function sendAuthEmail(
    user: AuthUser,
    token: string,
    kind: 'verify' | 'reset',
  ): Promise<void> {
    const issuedAt = now();
    const validity = kind === 'verify' ? VERIFICATION_VALIDITY_SECONDS : RESET_VALIDITY_SECONDS;
    await repo.issueToken(db, {
      userId: user.id,
      purpose: kind === 'verify' ? 'email_verification' : 'password_reset',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(issuedAt.getTime() + validity * 1000),
      now: issuedAt,
    });
    const locale = user.locale === 'en' ? 'en' : 'bn';
    const link =
      kind === 'verify'
        ? `${env.APP_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=%2F`
        : `${env.APP_BASE_URL}/reset-password/${encodeURIComponent(token)}`;
    const subject = translate(
      locale,
      kind === 'verify' ? 'auth.email.verify.subject' : 'auth.email.reset.subject',
    );
    const text =
      kind === 'verify'
        ? translate(locale, 'auth.email.verify.body', { hours: validity / 3600, link })
        : translate(locale, 'auth.email.reset.body', { minutes: validity / 60, link });
    try {
      await deps.emailSender.send({ to: user.email, locale, kind, subject, text, link });
    } catch (error) {
      // The account and token exist; the user can ask for a new link (resend / reset again).
      log.error(
        { err: error, kind, code: 'AUTH_EMAIL_SEND_FAILED' },
        'auth email could not be sent',
      );
    }
  }

  // ------------------------------------------------------------- rate limits
  function bucketKey(action: RateLimitedAction, identifier: string): string {
    return `${action}:${keyedHash(env.IDENTIFIER_HASH_KEY, identifier)}`;
  }

  async function isLimited(action: RateLimitedAction, identifier: string): Promise<boolean> {
    return isBlocked(
      await repo.getBucket(db, bucketKey(action, identifier)),
      DEFAULT_RATE_LIMITS[action],
      clock.now(),
    );
  }

  async function countAttempt(action: RateLimitedAction, identifier: string): Promise<void> {
    const key = bucketKey(action, identifier);
    const next = recordAttempt(
      await repo.getBucket(db, key),
      DEFAULT_RATE_LIMITS[action],
      clock.now(),
    );
    await repo.saveBucket(db, key, action, next);
  }

  /** Item (v): equalise timing when a request is refused before the password check. */
  async function dummyHash(): Promise<void> {
    const context = await auth.$context;
    await context.password.hash(randomBytes(16).toString('hex'));
  }

  // ---------------------------------------------------------------- sessions
  async function resolveSession(request: Request): Promise<ResolvedSession | null> {
    const found = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!found) return null;
    const row = await repo.findSession(db, found.session.id);
    const user = await repo.findUserById(db, found.user.id);
    if (!row || !user) return null;
    if (
      user.status === 'disabled' ||
      user.status === 'closed' ||
      (await repo.activeSuspension(db, user.id))
    ) {
      await endSession(row.id, 'session_ended');
      return null;
    }
    const staffRoles = await repo.activeStaffRoles(db, user.id);
    const hasActiveAuthenticator = await repo.hasActiveCredential(db, user.id);
    const evaluation = evaluateSession(
      toSnapshot(row),
      { isStaff: staffRoles.length > 0, hasActiveAuthenticator },
      clock.now(),
    );
    if (evaluation.outcome === 'ended') {
      await endSession(row.id, 'session_ended');
      return null;
    }
    if (evaluation.isChanged) await repo.updateSession(db, row.id, evaluation.next);
    return {
      sessionId: row.id,
      userId: user.id,
      locale: user.locale,
      email: user.email,
      staffRoles,
      snapshot: evaluation.next,
    };
  }

  async function endSession(
    sessionId: string,
    reason: 'sign_out' | 'session_ended',
  ): Promise<void> {
    await repo.revokePushForSession(db, sessionId, reason, now());
    await repo.deleteSession(db, sessionId);
  }

  async function getActor(request: Request): Promise<Result<Actor, AppError<'UNAUTHENTICATED'>>> {
    const session = await resolveSession(request);
    if (session?.snapshot.state !== 'active') return err(appError('UNAUTHENTICATED'));
    const roles: Role[] = ['student', ...session.staffRoles];
    return ok({
      userId: session.userId,
      roles,
      locale: session.locale,
      hasStepUp: hasStepUp(session.snapshot),
    });
  }

  async function sessionState(request: Request): Promise<SessionState | 'none'> {
    return (await resolveSession(request))?.snapshot.state ?? 'none';
  }

  // ------------------------------------------------------------ HTTP routes
  async function signUp(request: Request): Promise<Response> {
    const parsed = SignUpInput.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, fromZodError(parsed.error));
    const ip = clientIp(request);
    if (await isLimited('sign_up', ip)) return errorResponse(429, appError('RATE_LIMITED'));
    await countAttempt('sign_up', ip);
    const { email, password, name, locale } = parsed.data;
    const response = await auth.handler(
      forward(request, { email, password, name, locale, callbackURL: '/' }),
    );
    if (response.status !== 200) return mapAuthError(response);
    // BR2.4: the same neutral answer for a new and an existing email. BR2.7: remember this browser.
    const deviceProof = keyedHash(env.IDENTIFIER_HASH_KEY, `signup:${email}`);
    return json(
      200,
      { status: 'check_email' },
      {
        'set-cookie': `${SIGNUP_DEVICE_COOKIE}=${deviceProof}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VERIFICATION_VALIDITY_SECONDS}`,
      },
    );
  }

  async function signIn(request: Request): Promise<Response> {
    const generic = () =>
      errorResponse(401, appError('INVALID_EMAIL_OR_PASSWORD', { namespace: 'identity' }));
    const parsed = SignInInput.safeParse(await readJson(request));
    if (!parsed.success) {
      await dummyHash();
      return generic();
    }
    // BR3.10: one signed-in account per device.
    if (await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })) {
      return errorResponse(409, appError('SIGN_OUT_FIRST', { namespace: 'identity' }));
    }
    const { email, password } = parsed.data;
    // Item (iv): a locked account is refused before the password check, with equal timing (item v).
    if (await isLimited('sign_in', email)) {
      await dummyHash();
      emit('sign_in_locked');
      return errorResponse(429, appError('RATE_LIMITED'));
    }
    const response = await auth.handler(forward(request, { email, password, rememberMe: true }));
    if (response.status === 401) {
      await countAttempt('sign_in', email);
      deps.metrics.increment('auth_sign_in_failures_total');
      emit('sign_in_failed');
      return generic();
    }
    if (response.status !== 200) return mapAuthError(response);
    await repo.deleteBucket(db, bucketKey('sign_in', email));
    const user = await repo.findUserByEmail(db, email);
    // A suspended account (fraud ban) is refused after the password check: the session Better Auth
    // just created ends and no cookie is returned.
    if (user && (await repo.activeSuspension(db, user.id))) {
      await repo.deleteSessionsOfUser(db, user.id);
      emit('sign_in_suspended');
      return errorResponse(403, appError('ACCOUNT_SUSPENDED', { namespace: 'identity' }));
    }
    emit('sign_in_succeeded');
    const isStaff = user ? (await repo.activeStaffRoles(db, user.id)).length > 0 : false;
    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
    // The session token stays in the HttpOnly cookie only; it is never returned in the body.
    return json(200, { status: 'signed_in', next: isStaff ? '/two-step' : '/' }, headers);
  }

  async function verifyEmail(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') ?? '';
    const record = await repo.findValidToken(db, 'email_verification', sha256Hex(token), now());
    const expired = () =>
      new Response(null, {
        status: 302,
        headers: { location: '/verify?error=link_expired', 'cache-control': 'no-store' },
      });
    if (!record) return expired();
    const user = await repo.findUserById(db, record.userId);
    if (!user) return expired();
    const isSameDevice =
      readCookie(request, SIGNUP_DEVICE_COOKIE) ===
      keyedHash(env.IDENTIFIER_HASH_KEY, `signup:${user.email}`);
    url.searchParams.set('callbackURL', isSameDevice ? '/?verified=1' : '/sign-in?verified=1');
    const response = await auth.handler(
      new Request(url, { method: 'GET', headers: request.headers }),
    );
    const location = response.headers.get('location') ?? '';
    if (response.status >= 400 || location.includes('error=')) return expired();
    if (!(await repo.consumeToken(db, record.tokenId, now()))) return expired();
    await repo.markEmailVerified(db, user.id, now());
    emit('email_verified');
    const headers = new Headers({ location, 'cache-control': 'no-store' });
    const createdToken = sessionTokenFromSetCookie(response);
    if (isSameDevice) {
      for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
      headers.append(
        'set-cookie',
        `${SIGNUP_DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      );
    } else if (createdToken) {
      // BR2.7: another browser gets the email verified but no session.
      const found = await auth.api.getSession({
        headers: new Headers({
          cookie: `${response.headers
            .getSetCookie()
            .map((c) => c.split(';')[0])
            .join('; ')}`,
        }),
        query: { disableRefresh: true },
      });
      if (found) await repo.deleteSession(db, found.session.id);
    }
    return new Response(null, { status: 302, headers });
  }

  async function requestPasswordReset(request: Request): Promise<Response> {
    const parsed = ResetRequestInput.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, fromZodError(parsed.error));
    const { email } = parsed.data;
    if (await isLimited('reset_request', email))
      return errorResponse(429, appError('RATE_LIMITED'));
    await countAttempt('reset_request', email);
    const response = await auth.handler(forward(request, { email, redirectTo: '/reset-password' }));
    if (response.status !== 200) return mapAuthError(response);
    // BR2.4 / AC1.3.3: the same confirmation whether or not the account exists.
    return json(200, { status: 'check_email' });
  }

  async function resetPassword(request: Request): Promise<Response> {
    const parsed = ResetPasswordInput.safeParse(await readJson(request));
    const linkExpired = () =>
      errorResponse(400, appError('LINK_EXPIRED', { namespace: 'identity' }));
    if (!parsed.success) {
      const error = fromZodError(parsed.error);
      return error.fieldErrors?.newPassword ? errorResponse(400, error) : linkExpired();
    }
    const record = await repo.findValidToken(
      db,
      'password_reset',
      sha256Hex(parsed.data.token),
      now(),
    );
    if (!record) return linkExpired();
    const response = await auth.handler(forward(request, parsed.data));
    if (response.status !== 200)
      return response.status === 400 ? linkExpired() : mapAuthError(response);
    await repo.consumeToken(db, record.tokenId, now());
    await repo.setPasswordChangedAt(db, record.userId, now());
    // BR2.9: a reset revokes every session (Better Auth revokeSessionsOnPasswordReset, enforced again here).
    await repo.deleteSessionsOfUser(db, record.userId);
    emit('password_reset_completed');
    return json(200, { status: 'password_changed' });
  }

  async function signOut(request: Request): Promise<Response> {
    const found = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    // BR3.11: unbind this device's push subscription before the session row goes away.
    if (found) await repo.revokePushForSession(db, found.session.id, 'sign_out', now());
    const response = await auth.handler(forward(request, {}));
    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
    if (found) emit('signed_out');
    return json(200, { status: 'signed_out' }, headers);
  }

  async function changePassword(request: Request): Promise<Response> {
    const body = (await readJson(request)) as Record<string, unknown> | undefined;
    // BR2.9: a password change while signed in always revokes every other session.
    const response = await auth.handler(
      forward(request, { ...(body ?? {}), revokeOtherSessions: true }),
    );
    if (response.status !== 200) return mapAuthError(response);
    const found = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (found) await repo.setPasswordChangedAt(db, found.user.id, now());
    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
    return json(200, { status: 'password_changed' }, headers);
  }

  async function resendVerification(request: Request): Promise<Response> {
    const parsed = ResendVerificationInput.safeParse(await readJson(request));
    if (!parsed.success) return errorResponse(400, fromZodError(parsed.error));
    const { email } = parsed.data;
    if (await isLimited('verification_resend', email))
      return errorResponse(429, appError('RATE_LIMITED'));
    await countAttempt('verification_resend', email);
    const user = await repo.findUserByEmail(db, email);
    if (user && !user.emailVerified) {
      await sendAuthEmail(
        { id: user.id, email: user.email, name: user.name, locale: user.locale },
        await createVerificationToken(user.id, user.email),
        'verify',
      );
    }
    return json(200, { status: 'check_email' });
  }

  async function createVerificationToken(userId: string, email: string): Promise<string> {
    const { createEmailVerificationToken } = await import('better-auth/api');
    // A nonce makes every resent link distinct, so the previous one can be invalidated (BR2.6).
    return createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      email,
      undefined,
      VERIFICATION_VALIDITY_SECONDS,
      {
        userId,
        nonce: randomBytes(8).toString('hex'),
      },
    );
  }

  async function mapAuthError(response: Response): Promise<Response> {
    const body = (await readJson(response as unknown as Request)) as { code?: string } | undefined;
    const code = body?.code ?? 'AUTH_FAILED';
    const status = Math.max(response.status, 400);
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
      return errorResponse(
        400,
        appError('VALIDATION_FAILED', {
          fieldErrors: { password: ['errors.validation.password_length'] },
        }),
      );
    }
    return errorResponse(status, appError(code, { namespace: 'identity' }));
  }

  /** BR3.5: a state-changing request must come from a trusted origin; a missing origin is refused. */
  function isTrustedOrigin(request: Request): boolean {
    const origin = request.headers.get('origin') ?? originOf(request.headers.get('referer'));
    return origin !== undefined && env.TRUSTED_ORIGINS.includes(origin);
  }

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isTrustedOrigin(request)) {
      return errorResponse(403, appError('FORBIDDEN', { details: { reason: 'untrusted_origin' } }));
    }
    if (request.method === 'POST' && url.pathname === '/api/identity/resend-verification')
      return resendVerification(request);
    if (!url.pathname.startsWith('/api/auth/')) return errorResponse(404, appError('NOT_FOUND'));
    const route = `${request.method} ${url.pathname.slice('/api/auth'.length)}`;
    if (!ALLOWED_AUTH_ROUTES.has(route)) return errorResponse(404, appError('NOT_FOUND'));
    switch (route) {
      case 'POST /sign-up/email':
        return signUp(request);
      case 'POST /sign-in/email':
        return signIn(request);
      case 'GET /verify-email':
        return verifyEmail(request);
      case 'POST /request-password-reset':
        return requestPasswordReset(request);
      case 'POST /reset-password':
        return resetPassword(request);
      case 'POST /sign-out':
        return signOut(request);
      case 'POST /change-password':
        return changePassword(request);
      default:
        return auth.handler(request);
    }
  }

  // ------------------------------------------------------- staff invitations
  /** How long an invitation link works; a resend issues a new link for the same span. */
  const INVITE_VALIDITY_DAYS = 7;

  async function sendInviteEmail(
    to: { email: string; name: string; locale: 'bn' | 'en' },
    token: string,
    role: StaffRole,
  ): Promise<void> {
    const link = `${env.APP_BASE_URL}/staff-invite/${encodeURIComponent(token)}`;
    const subject = translate(to.locale, 'auth.email.invite.subject');
    const text = translate(to.locale, 'auth.email.invite.body', {
      name: to.name,
      role: translate(to.locale, `staff.role.${role}`),
      days: INVITE_VALIDITY_DAYS,
      link,
    });
    try {
      await deps.emailSender.send({
        to: to.email,
        locale: to.locale,
        kind: 'staff_invite',
        subject,
        text,
        link,
      });
    } catch (error) {
      // The invitation stands; an Admin can send a new link from the staff screen.
      log.error({ err: error, code: 'STAFF_INVITE_EMAIL_FAILED' }, 'staff invite email not sent');
    }
  }

  const newInviteToken = () => {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: sha256Hex(token) };
  };
  const inviteExpiry = () => new Date(now().getTime() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const staffInvites = {
    /**
     * Adds someone as staff by email. An existing verified, active account gets the role at once
     * (as roles.assign). Otherwise the account is created (or an unverified one reused) without a
     * usable password, and an emailed link lets them set one; the role is given when they do.
     */
    async invite(
      actor: Actor,
      input: {
        name: string;
        email: string;
        locale: 'bn' | 'en';
        role: StaffRole;
        instructorType?: 'employee' | 'contractor';
      },
      correlationId: string,
    ): Promise<Result<{ mode: 'assigned' | 'invited'; userId: string }, AppError>> {
      if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
      const email = input.email.trim().toLowerCase();
      const existing = await repo.findUserByEmail(db, email);
      if (existing?.emailVerified && existing.status === 'active') {
        const assigned = await roles.assign(
          actor,
          {
            userId: existing.id,
            role: input.role,
            ...(input.instructorType ? { instructorType: input.instructorType } : {}),
          },
          correlationId,
        );
        return assigned.ok ? ok({ mode: 'assigned', userId: existing.id }) : assigned;
      }
      // The same role and type rules as a direct assignment (target facts do not apply yet).
      const rules = checkAssign(actor, input, {
        target: { exists: true, isEmailVerified: true, status: 'active' },
        isAlreadyHeld: false,
      });
      if (!rules.ok) return rules;
      if (existing && existing.status !== 'unverified') {
        return err(appError('INVALID_STATE', { details: { reason: 'account_not_invitable' } }));
      }
      if (existing && (await repo.openInvitationFor(db, existing.id, input.role))) {
        return err(appError('ALREADY_INVITED', { namespace: 'identity' }));
      }
      let userId = existing?.id;
      if (!userId) {
        // A sign-in account with a random password nobody knows: unusable until the link is used.
        const ctx = await auth.$context;
        const user = await ctx.internalAdapter.createUser(
          { email, name: input.name.trim(), emailVerified: false, locale: input.locale },
          { method: 'admin' },
        );
        await ctx.internalAdapter.linkAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await ctx.password.hash(randomBytes(32).toString('base64url')),
        });
        userId = user.id;
      }
      const { token, tokenHash } = newInviteToken();
      const invitedUserId = userId;
      await withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        await repo.insertInvitation(exec, {
          userId: invitedUserId,
          role: input.role,
          instructorType: input.instructorType ?? null,
          tokenHash,
          invitedBy: actor.userId,
          expiresAt: inviteExpiry(),
          at: now(),
        });
        await audit.record(tx, {
          actorId: actor.userId,
          action: 'identity.staff_invite.created',
          subjectType: 'user_account',
          subjectId: invitedUserId,
          after: { role: input.role, instructorType: input.instructorType ?? null },
          correlationId,
        });
      });
      await sendInviteEmail(
        { email, name: existing?.name ?? input.name.trim(), locale: input.locale },
        token,
        input.role,
      );
      emit('staff_invited', { role: input.role });
      return ok({ mode: 'invited', userId: invitedUserId });
    },

    /** Open invitations for the staff screen, with who sent each and whether it has expired. */
    async list(actor: Actor) {
      if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
      const rows = await repo.openInvitations(db);
      const names = await displayNamesOf([...new Set(rows.map((r) => r.invitedBy))]);
      const at = now().getTime();
      return ok(
        rows.map((r) => ({
          invitationId: r.invitationId,
          userId: r.userId,
          name: r.name,
          email: r.email,
          role: r.role,
          instructorType: r.instructorType,
          invitedBy: names[r.invitedBy] ?? '',
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          isExpired: r.expiresAt.getTime() <= at,
        })),
      );
    },

    /** Sends a fresh link (the old one stops working) and restarts the validity period. */
    async resend(
      actor: Actor,
      invitationId: string,
      correlationId: string,
    ): Promise<Result<void, AppError>> {
      if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
      const found = await repo.invitationWithUser(db, { invitationId });
      if (!found) return err(appError('NOT_FOUND'));
      const { token, tokenHash } = newInviteToken();
      const renewed = await withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        if (!(await repo.renewInvitation(exec, invitationId, tokenHash, inviteExpiry())))
          return false;
        await audit.record(tx, {
          actorId: actor.userId,
          action: 'identity.staff_invite.resent',
          subjectType: 'user_account',
          subjectId: found.invitation.userId,
          correlationId,
        });
        return true;
      });
      if (!renewed) return err(appError('INVITE_INVALID', { namespace: 'identity' }));
      await sendInviteEmail(
        { email: found.email, name: found.name, locale: found.locale === 'en' ? 'en' : 'bn' },
        token,
        found.invitation.role,
      );
      return ok(undefined);
    },

    async cancel(
      actor: Actor,
      invitationId: string,
      correlationId: string,
    ): Promise<Result<void, AppError>> {
      if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
      return withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        const found = await repo.invitationWithUser(exec, { invitationId });
        if (!found) return err(appError('NOT_FOUND'));
        if (!(await repo.cancelInvitation(exec, invitationId, actor.userId, now())))
          return err(appError('INVITE_INVALID', { namespace: 'identity' }));
        await audit.record(tx, {
          actorId: actor.userId,
          action: 'identity.staff_invite.cancelled',
          subjectType: 'user_account',
          subjectId: found.invitation.userId,
          correlationId,
        });
        return ok(undefined);
      });
    },

    /** What the invitation page shows before the password is set. The token is the secret. */
    async preview(token: string) {
      const found = await repo.invitationWithUser(db, { tokenHash: sha256Hex(token) });
      if (!found) return err(appError('INVITE_INVALID', { namespace: 'identity' }));
      const i = found.invitation;
      const state =
        i.acceptedAt || i.cancelledAt
          ? ('used' as const)
          : i.expiresAt.getTime() <= now().getTime()
            ? ('expired' as const)
            : ('open' as const);
      return ok({
        name: found.name,
        email: found.email,
        role: i.role,
        instructorType: i.instructorType,
        state,
      });
    },

    /**
     * The invitee sets a password with the emailed link. That proves they own the email, so the
     * account becomes active and the role is given (by the inviting Admin), all at once; any
     * session the account had is ended. Then they sign in and set up two-step like other staff.
     */
    async accept(token: string, password: string): Promise<Result<{ email: string }, AppError>> {
      const invalid = err(appError('INVITE_INVALID', { namespace: 'identity' }));
      const found = await repo.invitationWithUser(db, { tokenHash: sha256Hex(token) });
      if (!found) return invalid;
      const ctx = await auth.$context;
      const hash = await ctx.password.hash(password);
      const i = found.invitation;
      const accepted = await withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        if (!(await repo.acceptInvitation(exec, i.invitationId, now()))) return false;
        await repo.activateInvitedAccount(exec, i.userId, now());
        if (!(await repo.activeAssignment(exec, i.userId, i.role))) {
          await repo.insertAssignment(exec, {
            userId: i.userId,
            role: i.role,
            instructorType: i.instructorType,
            assignedBy: i.invitedBy,
            at: now(),
          });
        }
        await audit.record(tx, {
          actorId: i.invitedBy,
          action: 'identity.role.assigned',
          subjectType: 'user_account',
          subjectId: i.userId,
          after: { role: i.role, instructorType: i.instructorType, via: 'invitation' },
          correlationId: correlation(),
        });
        return true;
      });
      if (!accepted) return invalid;
      await ctx.internalAdapter.updatePassword(i.userId, hash);
      await repo.setPasswordChangedAt(db, i.userId, now());
      await repo.deleteSessionsOfUser(db, i.userId);
      emit('staff_role_changed', { role: i.role, change: 'assigned' });
      return ok({ email: found.email });
    },
  };

  // ------------------------------------------------------------------- roles
  const roles = {
    async assign(
      actor: Actor,
      input: { userId: string; role: StaffRole; instructorType?: 'employee' | 'contractor' },
      correlationId: string,
    ): Promise<Result<{ roleAssignmentId: string }, AppError>> {
      return withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        const target = await repo.findUserById(exec, input.userId);
        const check = checkAssign(actor, input, {
          target: {
            exists: Boolean(target),
            isEmailVerified: Boolean(target?.emailVerified),
            status: target?.status ?? '',
          },
          isAlreadyHeld: Boolean(await repo.activeAssignment(exec, input.userId, input.role)),
        });
        if (!check.ok) return check;
        const row = await repo.insertAssignment(exec, {
          userId: input.userId,
          role: input.role,
          instructorType: input.instructorType ?? null,
          assignedBy: actor.userId,
          at: now(),
        });
        await audit.record(tx, {
          actorId: actor.userId,
          action: 'identity.role.assigned',
          subjectType: 'user_account',
          subjectId: input.userId,
          after: { role: input.role, instructorType: input.instructorType ?? null },
          correlationId,
        });
        emit('staff_role_changed', { role: input.role, change: 'assigned' });
        return ok({ roleAssignmentId: row.roleAssignmentId });
      });
    },

    async revoke(
      actor: Actor,
      input: { userId: string; role: StaffRole },
      correlationId: string,
    ): Promise<Result<void, AppError>> {
      return withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        const assignment = await repo.activeAssignment(exec, input.userId, input.role);
        const otherActiveAdmins =
          input.role === 'admin' ? await repo.lockOtherActiveAdmins(exec, input.userId) : 1;
        const check = checkRevoke(actor, input, { isHeld: Boolean(assignment), otherActiveAdmins });
        if (!check.ok || !assignment) return check;
        await repo.revokeAssignment(exec, assignment.roleAssignmentId, actor.userId, now());
        await audit.record(tx, {
          actorId: actor.userId,
          action: 'identity.role.revoked',
          subjectType: 'user_account',
          subjectId: input.userId,
          before: { role: input.role, instructorType: assignment.instructorType },
          correlationId,
        });
        emit('staff_role_changed', { role: input.role, change: 'revoked' });
        return ok(undefined);
      });
    },
  };

  /** US1.6: the staff list for an Admin with two-step sign-in: each person and their roles. */
  async function staffDirectory(actor: Actor) {
    if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
    const rows = await repo.activeStaff(db);
    const byUser = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string;
        hasTwoStep: boolean;
        roles: Array<{
          role: StaffRole;
          instructorType: 'employee' | 'contractor' | null;
          since: string;
        }>;
      }
    >();
    for (const r of rows) {
      const entry = byUser.get(r.userId) ?? {
        userId: r.userId,
        name: r.name,
        email: r.email,
        hasTwoStep: Boolean(r.hasTwoStep),
        roles: [],
      };
      entry.roles.push({
        role: r.role,
        instructorType: r.instructorType,
        since: r.assignedAt.toISOString(),
      });
      byUser.set(r.userId, entry);
    }
    return ok([...byUser.values()]);
  }

  /**
   * One staff member's account for an Admin (two-step): contact details, account state, two-step,
   * the roles held now and every role held before (who gave or took it, and when). Only accounts
   * that hold or once held a staff role answer; anyone else is NOT_FOUND.
   */
  async function staffMember(actor: Actor, userId: string) {
    if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
    const user = await repo.findUserById(db, userId);
    const history = user ? await repo.assignmentsOf(db, userId) : [];
    if (!user || history.length === 0) return err(appError('NOT_FOUND'));
    const people = new Set(history.flatMap((h) => [h.assignedBy, h.revokedBy ?? h.assignedBy]));
    const names = await displayNamesOf([...people]);
    const roleOf = (h: (typeof history)[number]) => ({
      role: h.role,
      instructorType: h.instructorType,
      assignedAt: h.assignedAt.toISOString(),
      assignedBy: names[h.assignedBy] ?? '',
      revokedAt: h.revokedAt ? h.revokedAt.toISOString() : null,
      revokedBy: h.revokedBy ? (names[h.revokedBy] ?? '') : null,
    });
    return ok({
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      locale: user.locale === 'en' ? ('en' as const) : ('bn' as const),
      status: user.status,
      isSuspended: await isSuspended(user.id),
      hasTwoStep: await repo.hasActiveCredential(db, user.id),
      createdAt: user.createdAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      roles: history.filter((h) => h.revokedAt === null).map(roleOf),
      history: history.map(roleOf),
    });
  }

  /**
   * US1.6: finds an account by its exact email so an Admin (two-step) can give it a role. Only for
   * Admins, so the answer cannot be used to probe accounts.
   */
  async function findAccountForStaffing(actor: Actor, email: string) {
    if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
    const user = await repo.findUserByEmail(db, email);
    if (!user) return err(appError('NOT_FOUND'));
    return ok({
      userId: user.id,
      name: user.name,
      email: user.email,
      isEmailVerified: Boolean(user.emailVerified),
      status: user.status,
    });
  }

  /** First-run only: makes an existing verified account the first Admin. Refused once any Admin exists. */
  async function bootstrapAdmin(userId: string): Promise<Result<void, AppError>> {
    return withTransaction(db, async (tx) => {
      const exec = unwrapTx(tx);
      if ((await repo.countActiveAdmins(exec)) > 0)
        return err(appError('CONFLICT', { details: { reason: 'admin_exists' } }));
      const user = await repo.findUserById(exec, userId);
      if (!user?.emailVerified) return err(appError('INVALID_STATE'));
      await repo.insertAssignment(exec, {
        userId,
        role: 'admin',
        instructorType: null,
        assignedBy: userId,
        at: now(),
      });
      await audit.record(tx, {
        actorId: 'system',
        action: 'identity.role.bootstrap_admin',
        subjectType: 'user_account',
        subjectId: userId,
        after: { role: 'admin' },
        correlationId: correlation(),
      });
      return ok(undefined);
    });
  }

  // -------------------------------------------------------------- two-factor
  function twoFactorError(code: 'INVALID_CODE' | 'TWO_STEP_NOT_PENDING'): AppError {
    return appError(code, { namespace: 'identity' });
  }

  async function guardTwoFactorAttempt(userId: string): Promise<AppError | null> {
    if (await isLimited('two_factor', userId)) {
      log.warn({ code: 'TWO_STEP_BLOCKED' }, 'two-step attempts blocked for the window');
      return appError('RATE_LIMITED');
    }
    return null;
  }

  async function failTwoFactor(userId: string): Promise<Result<never, AppError>> {
    await countAttempt('two_factor', userId);
    // BR5.6: logged without the code.
    log.info({ code: 'TWO_STEP_INVALID' }, 'invalid two-step code');
    emit('two_step_challenge_failed');
    return err(twoFactorError('INVALID_CODE'));
  }

  function newRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = base32Encode(randomBytes(8)).slice(0, 12);
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    });
  }

  const recoveryHash = (code: string) =>
    keyedHash(env.IDENTIFIER_HASH_KEY, `recovery:${code.toUpperCase().replace(/[\s-]/g, '')}`);

  const twoFactor = {
    async beginEnrolment(
      request: Request,
    ): Promise<Result<{ secret: string; setupKeyGroups: string[]; otpauthUri: string }, AppError>> {
      const session = await resolveSession(request);
      if (session?.snapshot.state !== 'pending_enrolment')
        return err(twoFactorError('TWO_STEP_NOT_PENDING'));
      const secret = base32Encode(randomBytes(20));
      await repo.startEnrolment(
        db,
        session.userId,
        encryptSecret(env.TOTP_ENCRYPTION_KEY, secret),
        now(),
      );
      return ok({
        secret,
        setupKeyGroups: groupSetupKey(secret),
        otpauthUri: otpauthUri(secret, session.email),
      });
    },

    async confirmEnrolment(
      request: Request,
      rawCode: string,
    ): Promise<Result<{ recoveryCodes: string[] }, AppError>> {
      const session = await resolveSession(request);
      if (session?.snapshot.state !== 'pending_enrolment')
        return err(twoFactorError('TWO_STEP_NOT_PENDING'));
      const blocked = await guardTwoFactorAttempt(session.userId);
      if (blocked) return err(blocked);
      const parsed = TwoFactorCodeInput.safeParse({ code: rawCode });
      const pending = await repo.credentialFor(db, session.userId, 'pending_confirmation');
      if (!parsed.success || !pending) return failTwoFactor(session.userId);
      const result = verifyTotp(
        decryptSecret(env.TOTP_ENCRYPTION_KEY, pending.totpSecretRef),
        parsed.data.code,
        clock.now(),
        null,
      );
      if (!result.isValid) return failTwoFactor(session.userId);
      const codes = newRecoveryCodes();
      await withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        await repo.activateCredential(
          exec,
          pending.twoFactorCredentialId,
          session.userId,
          result.step,
          now(),
        );
        await repo.insertRecoveryCodes(
          exec,
          pending.twoFactorCredentialId,
          codes.map(recoveryHash),
        );
        await repo.activateSessionStepUp(exec, session.sessionId, now());
        await audit.record(tx, {
          actorId: session.userId,
          action: 'identity.two_factor.enrolled',
          subjectType: 'user_account',
          subjectId: session.userId,
          correlationId: correlation(),
        });
      });
      await repo.deleteBucket(db, bucketKey('two_factor', session.userId));
      emit('two_step_enrolled');
      return ok({ recoveryCodes: codes });
    },

    async challenge(request: Request, rawCode: string): Promise<Result<void, AppError>> {
      const session = await resolveSession(request);
      if (session?.snapshot.state !== 'pending_challenge')
        return err(twoFactorError('TWO_STEP_NOT_PENDING'));
      const blocked = await guardTwoFactorAttempt(session.userId);
      if (blocked) return err(blocked);
      const parsed = TwoFactorCodeInput.safeParse({ code: rawCode });
      const credential = await repo.credentialFor(db, session.userId, 'active');
      if (!parsed.success || !credential) return failTwoFactor(session.userId);
      const secret = decryptSecret(env.TOTP_ENCRYPTION_KEY, credential.totpSecretRef);
      const result = verifyTotp(secret, parsed.data.code, clock.now(), credential.lastAcceptedStep);
      // The conditional update closes the race where two requests present the same code (item vi).
      if (
        !result.isValid ||
        !(await repo.acceptStep(db, credential.twoFactorCredentialId, result.step))
      ) {
        return failTwoFactor(session.userId);
      }
      await repo.activateSessionStepUp(db, session.sessionId, now());
      await repo.deleteBucket(db, bucketKey('two_factor', session.userId));
      return ok(undefined);
    },

    async useRecoveryCode(request: Request, rawCode: string): Promise<Result<void, AppError>> {
      const session = await resolveSession(request);
      if (session?.snapshot.state !== 'pending_challenge')
        return err(twoFactorError('TWO_STEP_NOT_PENDING'));
      const blocked = await guardTwoFactorAttempt(session.userId);
      if (blocked) return err(blocked);
      const parsed = RecoveryCodeInput.safeParse({ code: rawCode });
      const credential = await repo.credentialFor(db, session.userId, 'active');
      if (!parsed.success || !credential) return failTwoFactor(session.userId);
      const spent = await withTransaction(db, async (tx) => {
        const exec = unwrapTx(tx);
        if (
          !(await repo.spendRecoveryCode(
            exec,
            credential.twoFactorCredentialId,
            recoveryHash(parsed.data.code),
            now(),
          ))
        )
          return false;
        // BR5.7: the user is let in once and must enrol a new authenticator next time.
        await repo.revokeCredential(exec, credential.twoFactorCredentialId, now());
        await repo.activateSessionStepUp(exec, session.sessionId, now());
        await audit.record(tx, {
          actorId: session.userId,
          action: 'identity.recovery_code.used',
          subjectType: 'user_account',
          subjectId: session.userId,
          correlationId: correlation(),
        });
        return true;
      });
      if (!spent) return failTwoFactor(session.userId);
      emit('recovery_code_used');
      return ok(undefined);
    },
  };

  // ---------------------------------------------------------- contract 3 API
  async function hasRole(userId: string, role: Role): Promise<boolean> {
    if (role === 'student') return Boolean(await repo.findUserById(db, userId));
    return (await repo.activeStaffRoles(db, userId)).includes(role);
  }

  /**
   * Display names by user ID, for names shown publicly (U2 S4 instructors, BR11.8). Additive in Bolt
   * u2-catalog-browse. Unknown IDs are left out; an empty name stays empty for the caller's fallback.
   */
  async function displayNamesOf(userIds: readonly string[]): Promise<Record<string, string>> {
    const rows = await repo.displayNames(db, userIds);
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  async function getInstructorType(
    userId: string,
  ): Promise<Result<InstructorType, AppError<'NOT_FOUND'>>> {
    const assignment = await repo.activeAssignment(db, userId, 'instructor');
    return assignment?.instructorType ? ok(assignment.instructorType) : err(appError('NOT_FOUND'));
  }

  /** US7.16 (AC7.16.4): the user IDs of every active instructor of this type, HR record or not. */
  async function instructorIdsOfType(instructorType: 'employee' | 'contractor'): Promise<string[]> {
    return repo.activeInstructorIdsOfType(db, instructorType);
  }

  function requireStepUp(actor: Actor): Result<void, AppError<'STEP_UP_REQUIRED'>> {
    return actor.hasStepUp
      ? ok(undefined)
      : err(appError('STEP_UP_REQUIRED', { namespace: 'identity' }));
  }

  async function getAccountLocale(userId: string): Promise<'bn' | 'en'> {
    return (await repo.findUserById(db, userId))?.locale ?? 'bn';
  }

  async function setLocale(request: Request, locale: unknown): Promise<Result<void, AppError>> {
    const parsed = LocaleInput.safeParse({ locale });
    if (!parsed.success) return err(fromZodError(parsed.error));
    const actor = await getActor(request);
    if (!actor.ok) return actor;
    await repo.setLocale(db, actor.value.userId, parsed.data.locale, now());
    emit('language_changed', { locale: parsed.data.locale });
    return ok(undefined);
  }

  async function userIdByEmail(email: string): Promise<string | undefined> {
    return (await repo.findUserByEmail(db, email))?.id;
  }

  /** U12 only (contract 3): account closure. A fraud ban uses suspendAccount instead. */
  async function disableAccount(
    tx: TxHandle,
    userId: string,
    closureRequestId: string,
  ): Promise<Result<void, AppError<'NOT_FOUND'>>> {
    const exec = unwrapTx(tx);
    if (!(await repo.findUserById(exec, userId))) return err(appError('NOT_FOUND'));
    await repo.setStatus(exec, userId, 'disabled', now());
    await repo.deleteSessionsOfUser(exec, userId);
    await audit.record(tx, {
      actorId: 'system',
      action: 'identity.account.disabled',
      subjectType: 'user_account',
      subjectId: userId,
      after: { closureRequestId },
      correlationId: correlation(),
    });
    return ok(undefined);
  }

  /**
   * Fraud ban (US8.11): suspends an account, separately from closure. Admin with two-step sign-in
   * only. Every session ends and sign-in is refused until the account is reinstated. Suspending an
   * account that is already suspended changes nothing (`alreadySuspended`).
   */
  async function suspendAccount(
    tx: TxHandle,
    actor: Actor,
    input: { userId: string; reason: string; source: string },
  ): Promise<
    Result<{ alreadySuspended: boolean }, AppError<'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_STATE'>>
  > {
    if (!(actor.roles.includes('admin') && actor.hasStepUp)) return err(appError('FORBIDDEN'));
    if (input.userId === actor.userId) return err(appError('INVALID_STATE'));
    const exec = unwrapTx(tx);
    if (!(await repo.findUserById(exec, input.userId))) return err(appError('NOT_FOUND'));
    const at = now();
    const created = await repo.suspend(exec, {
      userId: input.userId,
      reason: input.reason,
      source: input.source,
      suspendedBy: actor.userId,
      at,
    });
    if (!created) return ok({ alreadySuspended: true });
    await repo.deleteSessionsOfUser(exec, input.userId);
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'identity.account.suspended',
      subjectType: 'user_account',
      subjectId: input.userId,
      after: { suspensionId: created.suspensionId, source: input.source },
      reason: input.reason,
      correlationId: correlation(),
    });
    return ok({ alreadySuspended: false });
  }

  /** Lifts an account's suspension (Admin with two-step sign-in only); the account can sign in again. */
  async function reinstateAccount(
    tx: TxHandle,
    actor: Actor,
    input: { userId: string; reason: string },
  ): Promise<Result<void, AppError<'FORBIDDEN' | 'INVALID_STATE'>>> {
    if (!(actor.roles.includes('admin') && actor.hasStepUp)) return err(appError('FORBIDDEN'));
    const lifted = await repo.reinstate(unwrapTx(tx), {
      userId: input.userId,
      reason: input.reason,
      reinstatedBy: actor.userId,
      at: now(),
    });
    if (!lifted) return err(appError('INVALID_STATE'));
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'identity.account.reinstated',
      subjectType: 'user_account',
      subjectId: input.userId,
      before: { suspensionId: lifted.suspensionId, source: lifted.source },
      reason: input.reason,
      correlationId: correlation(),
    });
    return ok(undefined);
  }

  /** Whether the account is suspended now. */
  async function isSuspended(userId: string): Promise<boolean> {
    return Boolean(await repo.activeSuspension(db, userId));
  }

  /** U12 only (contract 3), after every purge step. */
  async function anonymiseAccount(
    tx: TxHandle,
    userId: string,
    closureRequestId: string,
  ): Promise<Result<void, AppError<'NOT_FOUND' | 'INVALID_STATE'>>> {
    const exec = unwrapTx(tx);
    const user = await repo.findUserById(exec, userId);
    if (!user) return err(appError('NOT_FOUND'));
    if (user.status !== 'disabled') return err(appError('INVALID_STATE'));
    await repo.anonymise(exec, userId, now());
    await audit.record(tx, {
      actorId: 'system',
      action: 'identity.account.anonymised',
      subjectType: 'user_account',
      subjectId: userId,
      after: { closureRequestId },
      correlationId: correlation(),
    });
    return ok(undefined);
  }

  return {
    auth,
    handler,
    getActor,
    sessionState,
    userIdByEmail,
    bootstrapAdmin,
    roles,
    staffDirectory,
    staffMember,
    staffInvites,
    findAccountForStaffing,
    hasRole,
    displayNamesOf,
    getInstructorType,
    instructorIdsOfType,
    requireStepUp,
    getAccountLocale,
    setLocale,
    twoFactor,
    disableAccount,
    anonymiseAccount,
    suspendAccount,
    reinstateAccount,
    isSuspended,
  };
}

export type Identity = ReturnType<typeof createIdentity>;
