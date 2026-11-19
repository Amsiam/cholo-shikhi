// Calls the app's real server functions through their real builders and handlers, with the app's
// own singletons (IdentityAccess, Platform, Notifications, Goals…) pointed at a per-file schema and
// real Better Auth sessions. Only the Start transport is replaced: the request and cookie writes come
// from the test (the same wiring as src/server/server-functions.authz.int.test.ts).
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { totpCode } from '#src/features/identity-access/domain/totp.ts';
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';
import { resetEnvForTests } from '#src/lib/env.ts';
import { ok } from '#src/lib/result.ts';
import { type DeclaredAccess, overrideServerFnRuntimeForTests } from '#src/server/fn.ts';
import { type AuthHarness, createAuthHarness, TEST_AUTH_ENV } from './auth-harness.ts';
import { TEST_ORIGIN } from './browser.ts';
import { createTestDatabase, type TestDatabase } from './db.ts';

/** Test-only header naming an injected actor; never read outside this harness. */
const INJECTED_ACTOR_HEADER = 'x-test-injected-actor';

export type ServerFnResultLike = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; i18nKey: string; fieldErrors?: Record<string, readonly string[]> };
};
type Invoke = (opts: { data?: unknown }) => Promise<ServerFnResultLike>;
export type InvokableServerFn = { serverFnAccess: DeclaredAccess; invoke: Invoke };

const modules = import.meta.glob('/src/**/server/*.functions.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

/** Every exported server function in the app, by export name. */
export function allServerFns(): Record<string, InvokableServerFn> {
  const fns: Record<string, InvokableServerFn> = {};
  for (const exported of Object.values(modules)) {
    for (const [name, value] of Object.entries(exported)) {
      if (typeof value === 'function' && 'serverFnAccess' in value)
        fns[name] = value as unknown as InvokableServerFn;
    }
  }
  return fns;
}

export type Caller = { request: Request; userId: string };

export type ServerFnHarness = {
  t: TestDatabase;
  h: AuthHarness;
  anonymous: () => Request;
  /** Calls a server function by export name; a missing function is a failing test, not a skip. */
  call: (name: string, request: Request, data?: unknown) => Promise<ServerFnResultLike>;
  newStudent: () => Promise<Caller>;
  /** An Admin whose session passed two-step. */
  admin: Caller;
  /** A real Admin session that has not passed two-step yet: U1 keeps it pending (UNAUTHENTICATED). */
  adminPendingTwoStep: Caller;
  /**
   * An active Admin actor without step-up, injected through the runtime's getActor seam: the only
   * way to reach the builder's STEP_UP_REQUIRED defence, which a real staff session never reaches.
   */
  adminWithoutStepUp: Caller;
  /** An instructor with two-step done: a staff role that is still the wrong role for Admin work. */
  instructor: Caller;
  /** Another instructor (employee) with two-step done, e.g. a Co-instructor or another course's Lead. */
  newInstructor: () => Promise<Caller>;
  /** A Finance staff member with two-step done: the wrong role for authoring. */
  newFinance: () => Promise<Caller>;
  close: () => Promise<void>;
};

export async function createServerFnHarness(): Promise<ServerFnHarness> {
  const t = await createTestDatabase();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: `${t.connectionString}?options=-c%20search_path%3D${t.schemaName}`,
    APP_BASE_URL: TEST_AUTH_ENV.APP_BASE_URL,
    BETTER_AUTH_SECRET: TEST_AUTH_ENV.BETTER_AUTH_SECRET,
    IDENTIFIER_HASH_KEY: TEST_AUTH_ENV.IDENTIFIER_HASH_KEY,
    TOTP_ENCRYPTION_KEY: TEST_AUTH_ENV.TOTP_ENCRYPTION_KEY,
    KYC_ENCRYPTION_KEY: TEST_AUTH_ENV.KYC_ENCRYPTION_KEY,
    CATALOG_CURSOR_KEYS: TEST_AUTH_ENV.CATALOG_CURSOR_KEYS,
    TRUSTED_ORIGINS: TEST_ORIGIN,
  });
  resetEnvForTests();
  let currentRequest: Request = new Request(TEST_ORIGIN);
  const injected = new Map<string, Actor>();
  const restore = overrideServerFnRuntimeForTests({
    getRequest: () => currentRequest,
    getActor: async (request) => {
      const actor = injected.get(request.headers.get(INJECTED_ACTOR_HEADER) ?? '');
      return actor ? ok(actor) : getIdentity().getActor(request);
    },
    setCookie: () => undefined,
  });
  const h = await createAuthHarness(t);
  const fns = allServerFns();

  async function call(name: string, request: Request, data: unknown = {}) {
    const fn = fns[name];
    if (!fn) throw new Error(`no server function ${name}`);
    currentRequest = request;
    return fn.invoke({ data });
  }

  async function newStudent(): Promise<Caller> {
    const s = await h.verifiedStudent();
    return { request: s.browser.request('/'), userId: s.userId };
  }

  async function withTwoStep(email: string, password: string): Promise<Request> {
    const browser = h.browser();
    await h.signIn(browser, email, password);
    const enrol = await h.identity.twoFactor.beginEnrolment(browser.request('/'));
    if (!enrol.ok) throw new Error(`two-step enrolment failed: ${enrol.error.code}`);
    const confirmed = await h.identity.twoFactor.confirmEnrolment(
      browser.request('/'),
      totpCode(enrol.value.secret, h.clock.now()),
    );
    if (!confirmed.ok) throw new Error(`two-step confirm failed: ${confirmed.error.code}`);
    return browser.request('/');
  }

  // The first Admin: one session without two-step (opened before enrolment), one with it.
  const boss = await h.verifiedStudent();
  const bootstrapped = await h.identity.bootstrapAdmin(boss.userId);
  if (!bootstrapped.ok) throw new Error(`bootstrap failed: ${bootstrapped.error.code}`);
  const plainBrowser = h.browser();
  await h.signIn(plainBrowser, boss.person.email, boss.person.password);
  const adminPendingTwoStep = { request: plainBrowser.request('/'), userId: boss.userId };
  injected.set('admin-without-step-up', {
    userId: boss.userId,
    roles: ['student', 'admin'],
    locale: 'en',
    hasStepUp: false,
  });
  const adminWithoutStepUp = {
    request: new Request(`${TEST_ORIGIN}/_serverFn`, {
      headers: { origin: TEST_ORIGIN, [INJECTED_ACTOR_HEADER]: 'admin-without-step-up' },
    }),
    userId: boss.userId,
  };
  const admin = {
    request: await withTwoStep(boss.person.email, boss.person.password),
    userId: boss.userId,
  };

  // Staff (instructors are employees), assigned by the Admin, with two-step done.
  async function newStaff(role: 'instructor' | 'finance'): Promise<Caller> {
    const person = await h.verifiedStudent();
    const assigned = await h.identity.roles.assign(
      { userId: boss.userId, roles: ['student', 'admin'], locale: 'en', hasStepUp: true },
      role === 'instructor'
        ? { userId: person.userId, role, instructorType: 'employee' }
        : { userId: person.userId, role },
      `test-assign-${role}`,
    );
    if (!assigned.ok) throw new Error(`${role} assignment failed: ${assigned.error.code}`);
    return {
      request: await withTwoStep(person.person.email, person.person.password),
      userId: person.userId,
    };
  }
  const newInstructor = () => newStaff('instructor');
  const instructor = await newInstructor();

  return {
    t,
    h,
    anonymous: () => new Request(`${TEST_ORIGIN}/_serverFn`, { headers: { origin: TEST_ORIGIN } }),
    call,
    newStudent,
    admin,
    adminPendingTwoStep,
    adminWithoutStepUp,
    instructor,
    newInstructor,
    newFinance: () => newStaff('finance'),
    async close() {
      restore();
      const { closeDb } = await import('#src/server/db.ts');
      await closeDb();
      await t.drop();
    },
  };
}
