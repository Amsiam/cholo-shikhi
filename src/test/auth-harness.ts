// Builds the real identity stack (Better Auth + IdentityAccess services) on a per-file test schema.

import {
  createIdentity,
  type Identity,
} from '#src/features/identity-access/server/identity.server.ts';
import { createRecordingEmailSender } from '#src/features/notifications/server/email-sender.server.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { createBrowser, TEST_ORIGIN, type TestBrowser } from './browser.ts';
import type { TestDatabase } from './db.ts';
import { buildPerson, type SyntheticPerson } from './factories/synthetic.ts';

export const TEST_AUTH_ENV = {
  APP_BASE_URL: TEST_ORIGIN,
  BETTER_AUTH_SECRET: 'test-secret-for-integration-only-0123456789abcdef',
  IDENTIFIER_HASH_KEY: 'test-identifier-hash-key-0123456789abcdef',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  KYC_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  /** Fixed synthetic cursor key (catalog unit-test instructions: never a real secret). */
  CATALOG_CURSOR_KEYS: `t1:${Buffer.alloc(32, 9).toString('base64')}`,
  TRUSTED_ORIGINS: [TEST_ORIGIN],
} as const;

export type AuthHarness = Awaited<ReturnType<typeof createAuthHarness>>;

export async function createAuthHarness(t: TestDatabase, options: { now?: string } = {}) {
  const mailbox = createRecordingEmailSender();
  const clock = fixedClock(options.now ?? new Date().toISOString());
  const metrics = createMetrics();
  const identity: Identity = createIdentity({
    db: t.db,
    env: TEST_AUTH_ENV,
    emailSender: mailbox,
    clock,
    metrics,
  });
  const handler = (request: Request) => identity.handler(request);
  const browser = (acceptLanguage?: string): TestBrowser =>
    createBrowser(handler, acceptLanguage ? { acceptLanguage } : {});

  /** The newest link of a kind sent to an address, read from the stub mailbox. */
  function latestLink(email: string, kind: 'verify' | 'reset'): string {
    const message = [...mailbox.sent].reverse().find((m) => m.to === email && m.kind === kind);
    if (!message) throw new Error(`no ${kind} email for ${email}`);
    const url = new URL(message.link);
    return `${url.pathname}${url.search}`;
  }

  async function signUp(b: TestBrowser, person: SyntheticPerson = buildPerson()) {
    const res = await b.json('/api/auth/sign-up/email', {
      body: {
        email: person.email,
        password: person.password,
        name: person.displayName,
        locale: person.locale,
      },
    });
    return { person, ...res };
  }

  async function verify(b: TestBrowser, email: string) {
    return b.fetch(latestLink(email, 'verify'));
  }

  async function signIn(b: TestBrowser, email: string, password: string) {
    return b.json<{ code?: string; redirect?: boolean }>('/api/auth/sign-in/email', {
      body: { email, password },
    });
  }

  /** A verified, active student, signed in on a fresh browser. */
  async function verifiedStudent(person: SyntheticPerson = buildPerson()) {
    const signupBrowser = browser();
    await signUp(signupBrowser, person);
    await verify(signupBrowser, person.email);
    const b = browser();
    await signIn(b, person.email, person.password);
    const userId = await identity.userIdByEmail(person.email);
    if (!userId) throw new Error('user not created');
    return { person, browser: b, userId };
  }

  return {
    identity,
    mailbox,
    clock,
    metrics,
    browser,
    latestLink,
    signUp,
    verify,
    signIn,
    verifiedStudent,
  };
}
