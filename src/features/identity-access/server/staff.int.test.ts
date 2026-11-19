// [LT] US1.6 Staff and roles: an Admin with two-step sign-in finds an account by email, gives and
// takes staff roles (an Instructor needs a type), sees the staff list; the last Admin stays.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { userAccount } from '#src/server/schema/index.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
beforeAll(async () => {
  s = await createServerFnHarness();
}, 120_000);
afterAll(async () => {
  await s?.close();
});

type Staff = Array<{
  userId: string;
  roles: Array<{ role: string; instructorType: string | null }>;
}>;

describe('staff and roles', () => {
  it('finds an account, gives Instructor (with a type), lists it, and takes it away', async () => {
    const person = await s.newStudent();
    const [account] = await getDb()
      .select({ email: userAccount.email })
      .from(userAccount)
      .where(eq(userAccount.id, person.userId));
    const email = account?.email as string;
    const found = value<{ userId: string }>(
      await s.call('findStaffCandidate', s.admin.request, { email }),
    );
    expect(found.userId).toBe(person.userId);
    expect(
      await s.call('assignStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'instructor',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    value(
      await s.call('assignStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'instructor',
        instructorType: 'contractor',
      }),
    );
    expect(
      await s.call('assignStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'instructor',
        instructorType: 'contractor',
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const staff = value<Staff>(await s.call('listStaff', s.admin.request, {}));
    expect(staff.find((m) => m.userId === person.userId)?.roles).toEqual([
      expect.objectContaining({ role: 'instructor', instructorType: 'contractor' }),
    ]);
    value(
      await s.call('revokeStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'instructor',
      }),
    );
    expect(
      value<Staff>(await s.call('listStaff', s.admin.request, {})).some(
        (m) => m.userId === person.userId,
      ),
    ).toBe(false);
  });

  it('keeps the last Admin, and refuses everyone but an Admin', async () => {
    expect(
      await s.call('revokeStaffRole', s.admin.request, { userId: s.admin.userId, role: 'admin' }),
    ).toMatchObject({ ok: false, error: { code: 'LAST_ADMIN' } });
    const student = await s.newStudent();
    expect((await s.call('listStaff', student.request, {})).ok).toBe(false);
    expect(
      (await s.call('findStaffCandidate', student.request, { email: 'x@example.test' })).ok,
    ).toBe(false);
    expect(
      await s.call('findStaffCandidate', s.admin.request, { email: 'nobody@example.test' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
