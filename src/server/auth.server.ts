// The Better Auth instance (TS-04, team.md "Better Auth hardening"). IdentityAccess wraps its handler
// (src/features/identity-access/server/identity.server.ts) to add the custom items (i)–(vii).

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { withHashedSessionTokens } from '#src/features/identity-access/server/session-token-adapter.server.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Database } from './db.ts';
import {
  authAccount,
  authRateLimit,
  authSession,
  authVerification,
  userAccount,
} from './schema/index.ts';

export type AuthEnv = {
  APP_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  TRUSTED_ORIGINS: readonly string[];
};

export type AuthUser = { id: string; email: string; name: string; locale?: string };

export type AuthCallbacks = {
  sendVerificationEmail(input: { user: AuthUser; token: string }): Promise<void>;
  sendResetPassword(input: { user: AuthUser; token: string }): Promise<void>;
};

export const AUTH_BASE_PATH = '/api/auth';
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const VERIFICATION_VALIDITY_SECONDS = 24 * 60 * 60;
export const RESET_VALIDITY_SECONDS = 60 * 60;
export const SESSION_COOKIE_PREFIX = 'cs';

export function createAuth(deps: { db: Database; env: AuthEnv; callbacks: AuthCallbacks }) {
  const logger = getLogger().child({ component: 'better-auth' });
  return betterAuth({
    appName: 'Cholo Shikhi',
    baseURL: deps.env.APP_BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: deps.env.BETTER_AUTH_SECRET,
    trustedOrigins: [...deps.env.TRUSTED_ORIGINS],
    // Nothing leaves the Bangladesh-hosted app (residency, BR19.3).
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      // Routed through the redacting logger: Better Auth messages can contain email addresses.
      log: (level, message) => logger[level === 'debug' ? 'debug' : level](message),
    },
    database: withHashedSessionTokens(
      drizzleAdapter(deps.db, {
        provider: 'pg',
        schema: {
          user_account: userAccount,
          auth_session: authSession,
          auth_account: authAccount,
          auth_verification: authVerification,
          auth_rate_limit: authRateLimit,
        },
      }),
    ),
    user: {
      modelName: 'user_account',
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'bn', input: true },
        status: { type: 'string', required: false, defaultValue: 'unverified', input: false },
        studentNumber: { type: 'string', required: false, input: false },
        emailVerifiedAt: { type: 'date', required: false, input: false },
        passwordChangedAt: { type: 'date', required: false, input: false },
      },
    },
    session: {
      modelName: 'auth_session',
      // Better Auth's own expiry is the outer bound; the tier limits (Q1) are enforced on every request.
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // No cookie cache: the database is consulted on every request, so a role change or revocation
      // takes effect at the next request (BR3.4, BR4.5).
      cookieCache: { enabled: false },
      additionalFields: {
        tier: { type: 'string', required: false, defaultValue: 'student', input: false },
        state: { type: 'string', required: false, defaultValue: 'active', input: false },
        tierAnchorAt: { type: 'date', required: false, input: false },
        lastActiveAt: { type: 'date', required: false, input: false },
        stepUpVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification', storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      resetPasswordTokenExpiresIn: RESET_VALIDITY_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) =>
        deps.callbacks.sendResetPassword({ user: user as AuthUser, token }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_VALIDITY_SECONDS,
      sendVerificationEmail: async ({ user, token }) =>
        deps.callbacks.sendVerificationEmail({ user: user as AuthUser, token }),
    },
    rateLimit: {
      // Coarse per-IP limiter; per-account failure counters live in IdentityAccess (item ii).
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 20 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
