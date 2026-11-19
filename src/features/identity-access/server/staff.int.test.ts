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

  it("opens a staff member's profile with roles, role history and their money, for Admins only", async () => {
    const person = await s.newStudent();
    value(
      await s.call('assignStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'finance',
      }),
    );
    value(
      await s.call('revokeStaffRole', s.admin.request, { userId: person.userId, role: 'finance' }),
    );
    value(
      await s.call('assignStaffRole', s.admin.request, {
        userId: person.userId,
        role: 'instructor',
        instructorType: 'employee',
      }),
    );
    type Member = {
      userId: string;
      hasTwoStep: boolean;
      roles: Array<{ role: string; instructorType: string | null; revokedAt: string | null }>;
      history: Array<{ role: string; revokedAt: string | null; revokedBy: string | null }>;
    };
    const member = value<Member>(
      await s.call('getStaffMember', s.admin.request, { userId: person.userId }),
    );
    expect(member.roles).toEqual([
      expect.objectContaining({ role: 'instructor', instructorType: 'employee', revokedAt: null }),
    ]);
    expect(member.history.map((h) => h.role).sort()).toEqual(['finance', 'instructor']);
    expect(member.history.find((h) => h.role === 'finance')?.revokedAt).not.toBeNull();

    // A new instructor: no cycles, no KYC, nothing earned yet, but every part answers.
    const instructorId = person.userId;
    expect(
      value(await s.call('getInstructorPayoutCycles', s.admin.request, { instructorId })),
    ).toEqual([]);
    expect(
      value<{ status: string }>(await s.call('getInstructorKyc', s.admin.request, { instructorId }))
        .status,
    ).toBe('none');
    expect(
      value<{ total: number }>(
        await s.call('getInstructorEarnings', s.admin.request, { instructorId }),
      ).total,
    ).toBe(0);
    expect(
      await s.call('getInstructorCycleStatement', s.admin.request, {
        instructorId,
        month: '2020-01',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    // Someone who never held a staff role has no staff profile.
    const outsider = await s.newStudent();
    expect(
      await s.call('getStaffMember', s.admin.request, { userId: outsider.userId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    // Not for anyone but an Admin: not the instructor themself, not a Student.
    for (const caller of [person, outsider]) {
      expect((await s.call('getStaffMember', caller.request, { userId: person.userId })).ok).toBe(
        false,
      );
      expect((await s.call('getInstructorPayoutCycles', caller.request, { instructorId })).ok).toBe(
        false,
      );
    }
  });
});
