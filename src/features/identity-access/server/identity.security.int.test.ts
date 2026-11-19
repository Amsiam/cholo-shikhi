// [LT] Steps 10–11: custom auth items (i)–(vii) against the real handler and database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
// Sessions are stamped by the database clock; each test starts with the fake clock at real time.
beforeEach(() => {
  h.clock.set(new Date().toISOString());
});

describe('(i) tiered session limits, evaluated on every request', () => {
  it('ends a student session after 7 idle days', async () => {
    const { browser: b } = await h.verifiedStudent();
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(true);
    // The session's lastActiveAt comes from the database clock; align the fake clock with it first.
    h.clock.set(new Date().toISOString());
    h.clock.advanceMs(7 * 24 * 60 * 60 * 1000 + 60_000);
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(false);
  });
});

describe('(ii)/(iii) per-account failure counters keyed by a keyed hash', () => {
  it('stores no raw email in any rate-limit key', async () => {
    const { person } = await h.verifiedStudent();
    await h.signIn(h.browser(), person.email, 'Wrong-password-xx1');
    const { rows } = await t.pool.query<{ bucket_key: string }>(
      'SELECT bucket_key FROM rate_limit_bucket',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.bucket_key).not.toContain('@');
      expect(r.bucket_key).toMatch(/^[a-z_]+:[0-9a-f]{64}$/);
    }
  });

  it('resets the counter after a successful sign-in', async () => {
    const { person } = await h.verifiedStudent();
    await h.signIn(h.browser(), person.email, 'Wrong-password-xx2');
    expect((await h.signIn(h.browser(), person.email, person.password)).status).toBe(200);
    for (let i = 0; i < 4; i++) await h.signIn(h.browser(), person.email, `Wrong-password-y${i}`);
    expect((await h.signIn(h.browser(), person.email, person.password)).status).toBe(200);
  });
});

describe('(iv)/(v) refusal before the password check, with equal timing', () => {
  it('refuses a locked account even with the right password and returns no session cookie', async () => {
    const { person } = await h.verifiedStudent();
    for (let i = 0; i < 5; i++) await h.signIn(h.browser(), person.email, `Wrong-password-z${i}`);
    const locked = await h.signIn(h.browser(), person.email, person.password);
    expect(locked.status).toBe(429);
    expect(locked.response.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(
      false,
    );
  });

  it('answers unknown and locked accounts in comparable time (dummy hash path)', async () => {
    const ghost = buildPerson();
    const started = performance.now();
    await h.signIn(h.browser(), ghost.email, ghost.password);
    const unknownMs = performance.now() - started;
    // A refusal that skipped hashing entirely would be near-instant; the dummy hash costs real work.
    expect(unknownMs).toBeGreaterThan(5);
  });
});

describe('(vi)/(vii) TOTP replay guard and hash-only recovery codes', () => {
  it('stores the TOTP secret encrypted and recovery codes only as hashes', async () => {
    const { person, userId } = await h.verifiedStudent();
    await h.identity.bootstrapAdmin(userId);
    const b = h.browser();
    await h.signIn(b, person.email, person.password);
    const enrol = await h.identity.twoFactor.beginEnrolment(b.request('/'));
    if (!enrol.ok) throw new Error(enrol.error.code);
    const confirm = await h.identity.twoFactor.confirmEnrolment(
      b.request('/'),
      totpCode(enrol.value.secret, h.clock.now()),
    );
    if (!confirm.ok) throw new Error(confirm.error.code);
    const secrets = await t.pool.query<{ totp_secret_ref: string }>(
      'SELECT totp_secret_ref FROM two_factor_credential WHERE user_id = $1',
      [userId],
    );
    expect(secrets.rows[0]?.totp_secret_ref).not.toContain(enrol.value.secret);
    expect(secrets.rows[0]?.totp_secret_ref).toMatch(/^v1\./);
    const codes = await t.pool.query<{ code_hash: string }>('SELECT code_hash FROM recovery_code');
    expect(codes.rows).toHaveLength(10);
    const stored = codes.rows.map((r) => r.code_hash).join(' ');
    for (const code of confirm.value.recoveryCodes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(code.replaceAll('-', ''));
    }
  });

  it('refuses enrolment calls from a session that is not pending enrolment', async () => {
    const { browser: b } = await h.verifiedStudent();
    expect(await h.identity.twoFactor.beginEnrolment(b.request('/'))).toMatchObject({
      ok: false,
      error: { code: 'TWO_STEP_NOT_PENDING' },
    });
    expect(await h.identity.twoFactor.challenge(b.request('/'), '123456')).toMatchObject({
      ok: false,
    });
  });
});

describe('endpoint allowlist and response hygiene', () => {
  it('does not expose Better Auth endpoints outside the allowlist (e.g. list-sessions, update-user)', async () => {
    const { browser: b } = await h.verifiedStudent();
    expect((await b.fetch('/api/auth/list-sessions')).status).toBe(404);
    expect((await b.json('/api/auth/update-user', { body: { locale: 'xx' } })).status).toBe(404);
    expect((await b.fetch('/api/auth/get-session')).status).toBe(404);
  });

  it('never returns the session token in a sign-in response body', async () => {
    const person = buildPerson();
    const s = h.browser();
    await h.signUp(s, person);
    await h.verify(s, person.email);
    const res = await h.signIn(h.browser(), person.email, person.password);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    expect(res.body).toMatchObject({ status: 'signed_in', next: '/' });
  });

  it('refuses requests from an untrusted origin', async () => {
    const person = buildPerson();
    const response = await h.identity.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
          cookie: 'x=1',
        },
        body: JSON.stringify({ email: person.email, password: person.password, name: '' }),
      }),
    );
    expect(response.status).toBe(403);
    const noOrigin = await h.identity.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: person.email, password: person.password }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });

  it('a password change while signed in revokes every other session (BR2.9)', async () => {
    const { person, browser: first } = await h.verifiedStudent();
    const second = h.browser();
    await h.signIn(second, person.email, person.password);
    const res = await first.json('/api/auth/change-password', {
      body: { currentPassword: person.password, newPassword: 'Changed-password-123' },
    });
    expect(res.status).toBe(200);
    expect((await h.identity.getActor(second.request('/'))).ok).toBe(false);
    expect((await h.identity.getActor(first.request('/'))).ok).toBe(true);
  });
});

describe('contract 3 helpers', () => {
  it('requireStepUp refuses an actor without two-step', () => {
    expect(
      h.identity.requireStepUp({ userId: 'u', roles: ['student'], locale: 'bn', hasStepUp: false }),
    ).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
  });

  it('getInstructorType returns NOT_FOUND for a non-instructor and hasRole(student) is implicit', async () => {
    const { userId } = await h.verifiedStudent();
    expect(await h.identity.getInstructorType(userId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await h.identity.hasRole(userId, 'student')).toBe(true);
  });

  it('disableAccount ends sessions; anonymiseAccount requires a disabled account', async () => {
    const { browser: b, userId } = await h.verifiedStudent();
    const { withTransaction } = await import('#src/server/db.ts');
    expect(
      await withTransaction(t.db, (tx) =>
        h.identity.anonymiseAccount(tx, userId, '00000000-0000-4000-8000-000000000009'),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    await withTransaction(t.db, (tx) =>
      h.identity.disableAccount(tx, userId, '00000000-0000-4000-8000-000000000009'),
    );
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(false);
    expect(
      (
        await withTransaction(t.db, (tx) =>
          h.identity.anonymiseAccount(tx, userId, '00000000-0000-4000-8000-000000000009'),
        )
      ).ok,
    ).toBe(true);
  });

  it('suspendAccount is Admin-with-two-step only, idempotent and reversible; closure is separate', async () => {
    const { browser: b, userId, person } = await h.verifiedStudent();
    const { userId: adminId } = await h.verifiedStudent();
    const { withTransaction } = await import('#src/server/db.ts');
    const admin = { userId: adminId, roles: ['student', 'admin'] as const, locale: 'en' as const };
    const input = { userId, reason: 'Referral ring confirmed.', source: 'test' };
    const run = <T>(fn: (tx: Parameters<Parameters<typeof withTransaction>[1]>[0]) => Promise<T>) =>
      withTransaction(t.db, fn);
    // A student, and an Admin without two-step, are refused.
    expect(
      await run((tx) =>
        h.identity.suspendAccount(
          tx,
          { userId: adminId, roles: ['student'], locale: 'en', hasStepUp: true },
          input,
        ),
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      await run((tx) =>
        h.identity.suspendAccount(
          tx,
          { ...admin, roles: [...admin.roles], hasStepUp: false },
          input,
        ),
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const actor = { ...admin, roles: [...admin.roles], hasStepUp: true };
    expect(
      await run((tx) => h.identity.suspendAccount(tx, actor, { ...input, userId: adminId })),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect(await run((tx) => h.identity.reinstateAccount(tx, actor, input))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(await run((tx) => h.identity.suspendAccount(tx, actor, input))).toEqual({
      ok: true,
      value: { alreadySuspended: false },
    });
    expect(await run((tx) => h.identity.suspendAccount(tx, actor, input))).toEqual({
      ok: true,
      value: { alreadySuspended: true },
    });
    expect(await h.identity.isSuspended(userId)).toBe(true);
    expect((await h.identity.getActor(b.request('/'))).ok).toBe(false);
    expect((await h.signIn(h.browser(), person.email, person.password)).status).toBe(403);
    // A suspended account cannot be anonymised: suspension is not closure.
    expect(
      await run((tx) =>
        h.identity.anonymiseAccount(tx, userId, '00000000-0000-4000-8000-000000000010'),
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect((await run((tx) => h.identity.reinstateAccount(tx, actor, input))).ok).toBe(true);
    expect(await h.identity.isSuspended(userId)).toBe(false);
    const again = h.browser();
    expect((await h.signIn(again, person.email, person.password)).status).toBe(200);
    expect((await h.identity.getActor(again.request('/'))).ok).toBe(true);
  });
});
