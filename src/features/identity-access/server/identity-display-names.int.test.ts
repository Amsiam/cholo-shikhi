// [IT] Step 26 — direct integration test for displayNamesOf (contract 3 batched read for public
// instructor names; data minimisation). Real PostgreSQL on a per-file schema, synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTransaction } from '#src/server/db.ts';
import { type AuthHarness, createAuthHarness } from '#src/test/auth-harness.ts';
import { createTestDatabase, type TestDatabase } from '#src/test/db.ts';
import { buildPerson } from '#src/test/factories/synthetic.ts';

let t: TestDatabase;
let h: AuthHarness;

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createAuthHarness(t);
});
afterAll(async () => {
  await t.drop();
});

type Seeded = { id: string; displayName: string; email: string };

/** Inserts synthetic active accounts straight into user_account (no sign-up flow needed here). */
async function seedUsers(count: number, locale: 'bn_BD' | 'en' = 'en'): Promise<Seeded[]> {
  const people = Array.from({ length: count }, () => buildPerson({ locale }));
  const values: string[] = [];
  const params: string[] = [];
  people.forEach((p, i) => {
    values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, 'active', true)`);
    params.push(p.displayName, p.email, p.locale);
  });
  const { rows } = await t.pool.query<{ user_id: string; email_normalised: string }>(
    `INSERT INTO user_account (display_name, email_normalised, locale, status, email_verified)
     VALUES ${values.join(', ')} RETURNING user_id, email_normalised`,
    params,
  );
  return people.map((p) => {
    const row = rows.find((r) => r.email_normalised === p.email);
    if (!row) throw new Error('seeded row missing');
    return { id: row.user_id, displayName: p.displayName, email: p.email };
  });
}

describe('displayNamesOf (contract 3 identity read surface)', () => {
  it('Given two accounts, When their names are read, Then the result maps id to display name only (no email, phone or status)', async () => {
    const [a, b] = await seedUsers(2, 'bn_BD');
    if (!a || !b) throw new Error('seed failed');

    const names = await h.identity.displayNamesOf([a.id, b.id]);

    expect(names).toEqual({ [a.id]: a.displayName, [b.id]: b.displayName });
    for (const value of Object.values(names)) {
      expect(typeof value).toBe('string');
      expect(value).not.toContain('@');
    }
    expect(JSON.stringify(names)).not.toContain(a.email);
    expect(JSON.stringify(names)).not.toContain('active');
  });

  it('Given an id with no account, When names are read, Then that id is left out and known ids still resolve', async () => {
    const [a] = await seedUsers(1);
    if (!a) throw new Error('seed failed');
    const unknown = randomUUID();

    const names = await h.identity.displayNamesOf([unknown, a.id]);

    expect(names).toEqual({ [a.id]: a.displayName });
    expect(Object.hasOwn(names, unknown)).toBe(false);
  });

  it('Given an empty list, When names are read, Then it returns {} without touching the database', async () => {
    const query = vi.spyOn(t.pool, 'query');
    const connect = vi.spyOn(t.pool, 'connect');
    try {
      expect(await h.identity.displayNamesOf([])).toEqual({});
      expect(query).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();

      // Control: the spies do see a real read, so the "not called" above is meaningful.
      await h.identity.displayNamesOf([randomUUID()]);
      expect(query.mock.calls.length + connect.mock.calls.length).toBeGreaterThan(0);
    } finally {
      query.mockRestore();
      connect.mockRestore();
    }
  });

  it('Given an account that was disabled then anonymised, When its name is read, Then it resolves to the anonymised empty name', async () => {
    const [a] = await seedUsers(1);
    if (!a) throw new Error('seed failed');
    const closureRequestId = randomUUID();
    const disabled = await withTransaction(t.db, (tx) =>
      h.identity.disableAccount(tx, a.id, closureRequestId),
    );
    expect(disabled.ok).toBe(true);
    const anonymised = await withTransaction(t.db, (tx) =>
      h.identity.anonymiseAccount(tx, a.id, closureRequestId),
    );
    expect(anonymised.ok).toBe(true);

    const names = await h.identity.displayNamesOf([a.id]);

    expect(names).toEqual({ [a.id]: '' });
  });

  it('Given 101 ids, When names are read, Then only the first 100 ids in input order are resolved (silent cap, no error)', async () => {
    const seeded = await seedUsers(101);
    const ids = seeded.map((s) => s.id);

    const names = await h.identity.displayNamesOf(ids);

    expect(Object.keys(names)).toHaveLength(100);
    expect(new Set(Object.keys(names))).toEqual(new Set(ids.slice(0, 100)));
    expect(Object.hasOwn(names, ids[100] as string)).toBe(false);

    // The cap follows input order, not insertion order: reversed input drops the other end.
    const reversed = [...ids].reverse();
    const reversedNames = await h.identity.displayNamesOf(reversed);
    expect(new Set(Object.keys(reversedNames))).toEqual(new Set(reversed.slice(0, 100)));
    expect(Object.hasOwn(reversedNames, ids[0] as string)).toBe(false);
  });

  it('Given exactly 100 ids, When names are read, Then all 100 resolve', async () => {
    const seeded = await seedUsers(100);
    const names = await h.identity.displayNamesOf(seeded.map((s) => s.id));
    expect(Object.keys(names)).toHaveLength(100);
    for (const s of seeded) expect(names[s.id]).toBe(s.displayName);
  });
});
