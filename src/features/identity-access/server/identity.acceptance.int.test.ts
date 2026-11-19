// [AT] Step 8 — Given/When/Then acceptance tests for US1.1–US1.7, US1.12 and US1.17 (stories.md).
// Written before the identity implementation; they drive Better Auth's real handler.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthHarness, createAuthHarness } from '#src/test/auth-harness.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { buildPerson } from '#src/test/factories/synthetic.ts';
import { totpCode } from '../domain/totp.ts';

let t: TestDatabase;
let h: AuthHarness;

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createAuthHarness(t);
});
afterAll(async () => {
  await t.drop();
});

async function accountCount(email: string): Promise<number> {
  const { rows } = await t.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM user_account WHERE email_normalised = $1',
    [email],
  );
  return rows[0]?.n ?? 0;
}

let rootAdminId: string | undefined;

/** A new Admin with two-step enrolled: the first is bootstrapped, later ones are assigned by it. */
async function makeAdmin() {
  const admin = await h.verifiedStudent();
  if (!rootAdminId) {
    const boot = await h.identity.bootstrapAdmin(admin.userId);
    if (!boot.ok) throw new Error(boot.error.code);
    rootAdminId = admin.userId;
  } else {
    const root = {
      userId: rootAdminId,
      roles: ['student', 'admin'] as Array<'student' | 'admin'>,
      locale: 'en' as const,
      hasStepUp: true,
    };
    const assigned = await h.identity.roles.assign(
      root,
      { userId: admin.userId, role: 'admin' },
      'corr-make-admin',
    );
    if (!assigned.ok) throw new Error(assigned.error.code);
  }
  // A fresh sign-in is now a staff session that must enrol two-step first.
  const b = h.browser();
  await h.signIn(b, admin.person.email, admin.person.password);
  const enrol = await h.identity.twoFactor.beginEnrolment(b.request('/'));
  if (!enrol.ok) throw new Error(enrol.error.code);
  const confirm = await h.identity.twoFactor.confirmEnrolment(
    b.request('/'),
    totpCode(enrol.value.secret, h.clock.now()),
  );
  if (!confirm.ok) throw new Error(confirm.error.code);
  const actor = await h.identity.getActor(b.request('/'));
  if (!actor.ok) throw new Error(actor.error.code);
  return {
    ...admin,
    browser: b,
    actor: actor.value,
    secret: enrol.value.secret,
    recoveryCodes: confirm.value.recoveryCodes,
  };
}

describe('US1.1 Sign up with email and password', () => {
  it('AC1.1.1 Given a Visitor, When they submit a valid email and a 12+ character password, Then an unverified account is created and a verification email is queued', async () => {
    const b = h.browser();
    const { person, status } = await h.signUp(b);
    expect(status).toBe(200);
    const { rows } = await t.pool.query(
      'SELECT status, email_verified FROM user_account WHERE email_normalised = $1',
      [person.email],
    );
    expect(rows[0]).toEqual({ status: 'unverified', email_verified: false });
    expect(h.mailbox.sent.filter((m) => m.to === person.email && m.kind === 'verify')).toHaveLength(
      1,
    );
  });

  it('AC1.1.2 Given parent@… has an account, When parent+child@… signs up, Then a separate account is created (plus tags kept)', async () => {
    const base = buildPerson();
    const [local, domain] = base.email.split('@') as [string, string];
    await h.signUp(h.browser(), base);
    const child = { ...buildPerson(), email: `${local}+sabbir@${domain}` };
    await h.signUp(h.browser(), child);
    expect(await accountCount(base.email)).toBe(1);
    expect(await accountCount(child.email)).toBe(1);
  });

  it('AC1.1.3 Given an 11-character password, When submitted, Then a field error is returned and no account is created; 12 characters is accepted', async () => {
    const short = { ...buildPerson(), password: 'Abcdefgh12!' };
    const res = await h.signUp(h.browser(), short);
    expect(res.status).toBe(400);
    expect(await accountCount(short.email)).toBe(0);
    const ok = { ...buildPerson(), password: 'Abcdefgh123!' };
    expect((await h.signUp(h.browser(), ok)).status).toBe(200);
    expect(await accountCount(ok.email)).toBe(1);
  });

  it('AC1.1.4 Given the email already has an account, When sign-up is submitted, Then the response is the same neutral one and nothing reveals the account exists', async () => {
    const person = buildPerson();
    const first = await h.signUp(h.browser(), person);
    const second = await h.signUp(h.browser(), { ...person, password: 'Another-password-123' });
    expect(second.status).toBe(first.status);
    expect(Object.keys(second.body as object).sort()).toEqual(
      Object.keys(first.body as object).sort(),
    );
    expect(await accountCount(person.email)).toBe(1);
  });

  it('AC1.1.5 Given the account record, Then it has no date-of-birth, age, guardian or marketing-tracking field', async () => {
    const { rows } = await t.pool.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [t.schemaName, 'user_account'],
    );
    const tokens = rows.flatMap((r) => r.column_name.split('_'));
    for (const forbidden of ['birth', 'dob', 'age', 'guardian', 'utm', 'tracking', 'fingerprint']) {
      expect(tokens, forbidden).not.toContain(forbidden);
    }
  });
});

describe('US1.17 Verify my email', () => {
  it('AC1.17.1 Given the verification email, When its link is opened in the sign-up browser within 24 h, Then the email is verified and the user is signed in', async () => {
    const b = h.browser();
    const { person } = await h.signUp(b);
    await h.verify(b, person.email);
    const { rows } = await t.pool.query(
      'SELECT status, email_verified FROM user_account WHERE email_normalised = $1',
      [person.email],
    );
    expect(rows[0]).toEqual({ status: 'active', email_verified: true });
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(true);
  });

  it('AC1.17.2 Given the link opens in another browser, Then the email is verified and the user is asked to sign in, with no error', async () => {
    const { person } = await h.signUp(h.browser());
    const other = h.browser();
    const res = await h.verify(other, person.email);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location') ?? '').toContain('verified=1');
    expect((await h.identity.getActor(other.request('/'))).ok).toBe(false);
    const { rows } = await t.pool.query(
      'SELECT email_verified FROM user_account WHERE email_normalised = $1',
      [person.email],
    );
    expect(rows[0]).toEqual({ email_verified: true });
  });

  it('AC1.17.3 Given the link was already used or replaced by a newer one, When opened, Then "link expired" is shown and nothing changes', async () => {
    const b = h.browser();
    const { person } = await h.signUp(b);
    const firstLink = h.latestLink(person.email, 'verify');
    await b.json('/api/identity/resend-verification', { body: { email: person.email } });
    const res = await h.browser().fetch(firstLink);
    expect(res.headers.get('location') ?? '').toContain('error=link_expired');
    const { rows } = await t.pool.query(
      'SELECT email_verified FROM user_account WHERE email_normalised = $1',
      [person.email],
    );
    expect(rows[0]).toEqual({ email_verified: false });
  });
});

describe('US1.2 Sign in', () => {
  it('AC1.2.1 Given a verified Student, When they sign in, Then a Secure, HttpOnly, SameSite=Lax session cookie is set', async () => {
    const person = buildPerson();
    const signup = h.browser();
    await h.signUp(signup, person);
    await h.verify(signup, person.email);
    const b = h.browser();
    const res = await h.signIn(b, person.email, person.password);
    expect(res.status).toBe(200);
    const cookie =
      res.response.headers.getSetCookie().find((c) => c.includes('session_token')) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const { rows } = await t.pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM auth_session',
    );
    const raw =
      decodeURIComponent((cookie.split(';')[0] ?? '').split('=')[1] ?? '').split('.')[0] ?? '';
    expect(rows.map((r) => r.token_hash)).not.toContain(raw);
  });

  it('AC1.2.2 Given a wrong password or an unknown email, Then the same generic "email or password is incorrect" error is returned', async () => {
    const { person } = await h.verifiedStudent();
    const wrong = await h.signIn(h.browser(), person.email, 'Wrong-password-000');
    const unknown = await h.signIn(h.browser(), buildPerson().email, 'Wrong-password-000');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(unknown.body.code).toBe(wrong.body.code);
  });

  it('AC1.2.3 Given L=5 failures in W=15 minutes, When attempt L+1 is made (even with the right password), Then it is refused with "try again later"', async () => {
    const { person } = await h.verifiedStudent();
    for (let i = 0; i < 5; i++) {
      expect((await h.signIn(h.browser(), person.email, `Wrong-password-${i}xx`)).status).toBe(401);
    }
    const sixth = await h.signIn(h.browser(), person.email, person.password);
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
  });

  it('BR2.11 Given a correct password for an unverified account, Then no session is created', async () => {
    const b = h.browser();
    const { person } = await h.signUp(b);
    const res = await h.signIn(h.browser(), person.email, person.password);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('US1.3 Reset a forgotten password', () => {
  it('AC1.3.1 Given a reset request, When the link is opened and a valid password set, Then the password changes and every session is revoked', async () => {
    const { person, browser: oldDevice } = await h.verifiedStudent();
    await h.browser().json('/api/auth/request-password-reset', {
      body: { email: person.email, redirectTo: '/reset-password' },
    });
    const link = new URL(`http://x${h.latestLink(person.email, 'reset')}`);
    const token = link.pathname.split('/').pop() ?? '';
    const res = await h
      .browser()
      .json('/api/auth/reset-password', { body: { token, newPassword: 'Brand-new-password-42' } });
    expect(res.status).toBe(200);
    expect((await h.identity.getActor(oldDevice.request('/'))).ok).toBe(false);
    expect((await h.signIn(h.browser(), person.email, 'Brand-new-password-42')).status).toBe(200);
  });

  it('AC1.3.2 Given a used reset link, When it is opened again, Then "link expired" is returned', async () => {
    const { person } = await h.verifiedStudent();
    await h.browser().json('/api/auth/request-password-reset', {
      body: { email: person.email, redirectTo: '/reset-password' },
    });
    const token = h.latestLink(person.email, 'reset').split('/').pop()?.split('?')[0] ?? '';
    await h
      .browser()
      .json('/api/auth/reset-password', { body: { token, newPassword: 'Brand-new-password-43' } });
    const again = await h.browser().json<{ code: string }>('/api/auth/reset-password', {
      body: { token, newPassword: 'Brand-new-password-44' },
    });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('LINK_EXPIRED');
  });

  it('AC1.3.3 Given an email with no account, When a reset is requested, Then the same confirmation is shown and no email is sent', async () => {
    const { person } = await h.verifiedStudent();
    const known = await h.browser().json('/api/auth/request-password-reset', {
      body: { email: person.email, redirectTo: '/reset-password' },
    });
    const ghost = buildPerson().email;
    const before = h.mailbox.sent.length;
    const unknown = await h.browser().json('/api/auth/request-password-reset', {
      body: { email: ghost, redirectTo: '/reset-password' },
    });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(h.mailbox.sent.slice(before).filter((m) => m.to === ghost)).toHaveLength(0);
  });
});

describe('US1.4 Switch accounts safely on a shared phone', () => {
  it('AC1.4.1 Given I am signed in, When I sign out, Then my session on this device ends', async () => {
    const { browser: b } = await h.verifiedStudent();
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(true);
    const res = await b.json('/api/auth/sign-out', { body: {} });
    expect(res.status).toBe(200);
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(false);
  });

  it('AC1.4.3 Given I am signed in, When a second account signs in on the same device without signing out, Then it is refused', async () => {
    const first = await h.verifiedStudent();
    const second = await h.verifiedStudent();
    const res = await h.signIn(first.browser, second.person.email, second.person.password);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SIGN_OUT_FIRST');
  });

  it('AC1.4.5 Given I signed out, Then the push subscription bound to that session is revoked', async () => {
    const { browser: b, userId } = await h.verifiedStudent();
    const { rows } = await t.pool.query<{ session_id: string }>(
      'SELECT session_id FROM auth_session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    );
    const sessionId = rows[0]?.session_id;
    await t.pool.query(
      "INSERT INTO push_subscription (user_id, session_id, endpoint, keys_ciphertext) VALUES ($1, $2, 'https://push.invalid/e1', 'x')",
      [userId, sessionId],
    );
    await b.json('/api/auth/sign-out', { body: {} });
    const after = await t.pool.query<{ revoked_at: Date | null; revoke_reason: string }>(
      'SELECT revoked_at, revoke_reason FROM push_subscription WHERE user_id = $1',
      [userId],
    );
    expect(after.rows[0]?.revoked_at).not.toBeNull();
    expect(after.rows[0]?.revoke_reason).toBe('sign_out');
  });
});

describe('US1.6 Assign staff roles and instructor type', () => {
  it('AC1.6.1 Given a verified account, When an Admin assigns Instructor (Contracted), Then it applies at the next request and is audit-logged', async () => {
    const admin = await makeAdmin();
    const target = await h.verifiedStudent();
    const r = await h.identity.roles.assign(
      admin.actor,
      { userId: target.userId, role: 'instructor', instructorType: 'contractor' },
      'corr-role-1',
    );
    expect(r.ok).toBe(true);
    expect(await h.identity.hasRole(target.userId, 'instructor')).toBe(true);
    expect(await h.identity.getInstructorType(target.userId)).toEqual({
      ok: true,
      value: 'contractor',
    });
    const audit = await t.pool.query('SELECT action FROM audit_log_entry WHERE subject_id = $1', [
      target.userId,
    ]);
    expect(audit.rows.map((x) => x.action)).toContain('identity.role.assigned');
  });

  it('AC1.6.2 Given one account, When it is assigned Admin and Finance, Then it holds both', async () => {
    const admin = await makeAdmin();
    const target = await h.verifiedStudent();
    await h.identity.roles.assign(admin.actor, { userId: target.userId, role: 'admin' }, 'c');
    await h.identity.roles.assign(admin.actor, { userId: target.userId, role: 'finance' }, 'c');
    expect(await h.identity.hasRole(target.userId, 'admin')).toBe(true);
    expect(await h.identity.hasRole(target.userId, 'finance')).toBe(true);
  });

  it('AC1.6.3 Given the last Admin, When their Admin role is removed, Then it is refused', async () => {
    const isolated = await createTestDatabase();
    try {
      const h2 = await createAuthHarness(isolated);
      const solo = await h2.verifiedStudent();
      await h2.identity.bootstrapAdmin(solo.userId);
      const actor = {
        userId: solo.userId,
        roles: ['student', 'admin'] as const,
        locale: 'en' as const,
        hasStepUp: true,
      };
      const r = await h2.identity.roles.revoke(
        { ...actor, roles: [...actor.roles] },
        { userId: solo.userId, role: 'admin' },
        'c',
      );
      expect(r).toMatchObject({ ok: false, error: { code: 'LAST_ADMIN' } });
    } finally {
      await isolated.drop();
    }
  });

  it('BR4.2 Given an actor without Admin or without step-up, When assigning a role, Then it is refused', async () => {
    const student = await h.verifiedStudent();
    const target = await h.verifiedStudent();
    const asStudent = await h.identity.roles.assign(
      { userId: student.userId, roles: ['student'], locale: 'en', hasStepUp: false },
      { userId: target.userId, role: 'finance' },
      'c',
    );
    expect(asStudent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('US1.7 Two-step sign-in for staff', () => {
  it('AC1.7.1/AC1.7.3 Given a staff user without a second factor, When they sign in, Then they must enrol (manual key in groups of 4), confirm a code and receive recovery codes before staff access', async () => {
    const admin = await makeAdmin();
    const staff = await h.verifiedStudent();
    await h.identity.roles.assign(admin.actor, { userId: staff.userId, role: 'finance' }, 'c');
    const b = h.browser();
    await h.signIn(b, staff.person.email, staff.person.password);
    expect(await h.identity.sessionState(b.request('/'))).toBe('pending_enrolment');
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(false);
    const enrol = await h.identity.twoFactor.beginEnrolment(b.request('/'));
    if (!enrol.ok) throw new Error(enrol.error.code);
    expect(enrol.value.setupKeyGroups.every((g) => g.length <= 4)).toBe(true);
    expect(enrol.value.setupKeyGroups.join('')).toBe(enrol.value.secret);
    const confirm = await h.identity.twoFactor.confirmEnrolment(
      b.request('/'),
      totpCode(enrol.value.secret, h.clock.now()),
    );
    expect(confirm.ok && confirm.value.recoveryCodes).toHaveLength(10);
    const actor = await h.identity.getActor(b.request('/'));
    expect(actor.ok && actor.value.hasStepUp).toBe(true);
  });

  it('AC1.7.2 Given two-step is set up, When the password and a valid current code are entered, Then the staff area opens', async () => {
    const admin = await makeAdmin();
    h.clock.advanceMs(60_000);
    const b = h.browser();
    await h.signIn(b, admin.person.email, admin.person.password);
    expect(await h.identity.sessionState(b.request('/'))).toBe('pending_challenge');
    const r = await h.identity.twoFactor.challenge(
      b.request('/'),
      totpCode(admin.secret, h.clock.now()),
    );
    expect(r.ok).toBe(true);
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(true);
  });

  it('BR5.4 Given a code was accepted, When the same code is replayed, Then it is refused', async () => {
    const admin = await makeAdmin();
    h.clock.advanceMs(60_000);
    const code = totpCode(admin.secret, h.clock.now());
    const b1 = h.browser();
    await h.signIn(b1, admin.person.email, admin.person.password);
    expect((await h.identity.twoFactor.challenge(b1.request('/'), code)).ok).toBe(true);
    const b2 = h.browser();
    await h.signIn(b2, admin.person.email, admin.person.password);
    expect(await h.identity.twoFactor.challenge(b2.request('/'), code)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CODE' },
    });
  });

  it('AC1.7.4 Given a correct password, When an invalid code is entered L+1 times in W minutes, Then further attempts are blocked', async () => {
    const admin = await makeAdmin();
    const b = h.browser();
    await h.signIn(b, admin.person.email, admin.person.password);
    for (let i = 0; i < 5; i++) {
      expect((await h.identity.twoFactor.challenge(b.request('/'), '000000')).ok).toBe(false);
    }
    h.clock.advanceMs(60_000);
    const blocked = await h.identity.twoFactor.challenge(
      b.request('/'),
      totpCode(admin.secret, h.clock.now()),
    );
    expect(blocked).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('AC1.7.5 Given a lost phone, When an unused recovery code is entered, Then the user is signed in once, the code is spent, and they must enrol again', async () => {
    const admin = await makeAdmin();
    const code = admin.recoveryCodes[0] as string;
    const b = h.browser();
    await h.signIn(b, admin.person.email, admin.person.password);
    expect((await h.identity.twoFactor.useRecoveryCode(b.request('/'), code)).ok).toBe(true);
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(true);
    const b2 = h.browser();
    await h.signIn(b2, admin.person.email, admin.person.password);
    expect(await h.identity.sessionState(b2.request('/'))).toBe('pending_enrolment');
    expect((await h.identity.twoFactor.useRecoveryCode(b2.request('/'), code)).ok).toBe(false);
  });

  it('AC1.7.5 (second half) A Student-only account is never asked for two-step', async () => {
    const { browser: b } = await h.verifiedStudent();
    expect(await h.identity.sessionState(b.request('/'))).toBe('active');
  });
});

describe('US1.12 Choose my interface language', () => {
  it('AC1.12.1 Given English, When I choose বাংলা, Then the choice is saved to my account', async () => {
    const { browser: b, userId } = await h.verifiedStudent({ ...buildPerson(), locale: 'en' });
    expect(await h.identity.getAccountLocale(userId)).toBe('en');
    expect((await h.identity.setLocale(b.request('/'), 'bn')).ok).toBe(true);
    expect(await h.identity.getAccountLocale(userId)).toBe('bn');
  });

  it('AC1.12.3 Given siblings with different languages on one phone, When each signs in, Then each sees their own language', async () => {
    const bn = await h.verifiedStudent({ ...buildPerson({ locale: 'bn_BD' }) });
    const en = await h.verifiedStudent({ ...buildPerson({ locale: 'en' }) });
    const a1 = await h.identity.getActor(bn.browser.request('/'));
    const a2 = await h.identity.getActor(en.browser.request('/'));
    expect(a1.ok && a1.value.locale).toBe('bn');
    expect(a2.ok && a2.value.locale).toBe('en');
  });

  it('AC1.12.4 Given my account language is Bangla, When an auth email is sent, Then it is in Bangla', async () => {
    const person = buildPerson({ locale: 'bn_BD' });
    await h.signUp(h.browser(), person);
    const message = h.mailbox.sent.find((m) => m.to === person.email);
    expect(message?.locale).toBe('bn');
    expect(message?.subject).toMatch(/[ঀ-৿]/);
  });
});
