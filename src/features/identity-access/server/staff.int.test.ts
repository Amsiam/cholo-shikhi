// [LT] US1.6 Staff and roles: an Admin with two-step sign-in finds an account by email, gives and
// takes staff roles (an Instructor needs a type), sees the staff list; the last Admin stays.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDevMailbox } from '#src/features/notifications/server/email-sender.server.ts';
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

  describe('inviting staff', () => {
    const inviteLinkFor = (email: string) => {
      const mail = readDevMailbox()
        .filter((m) => m.to === email && m.kind === 'staff_invite')
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
      if (!mail) throw new Error(`no invite email for ${email}`);
      return decodeURIComponent(new URL(mail.link).pathname.split('/').pop() ?? '');
    };
    type Invites = Array<{ invitationId: string; email: string; role: string; isExpired: boolean }>;

    it('invites a new person; the link sets their password and gives the role', async () => {
      const email = `invited.${Date.now().toString(36)}@example.test`;
      const base = { name: 'Nusrat Invited', email, locale: 'en' as const };
      expect(
        await s.call('inviteStaff', s.admin.request, { ...base, role: 'instructor' }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      const invited = value<{ mode: string; userId: string }>(
        await s.call('inviteStaff', s.admin.request, {
          ...base,
          role: 'instructor',
          instructorType: 'employee',
        }),
      );
      expect(invited.mode).toBe('invited');
      expect(
        await s.call('inviteStaff', s.admin.request, {
          ...base,
          role: 'instructor',
          instructorType: 'employee',
        }),
      ).toMatchObject({ ok: false, error: { code: 'ALREADY_INVITED' } });
      const open = value<Invites>(await s.call('listStaffInvites', s.admin.request, {}));
      expect(open.find((i) => i.email === email)).toMatchObject({
        role: 'instructor',
        isExpired: false,
      });

      // The emailed link names who is invited, and works once.
      const token = inviteLinkFor(email);
      expect(value(await s.call('getStaffInvite', s.anonymous(), { token }))).toMatchObject({
        name: 'Nusrat Invited',
        role: 'instructor',
        state: 'open',
      });
      expect(
        await s.call('acceptStaffInvite', s.anonymous(), { token, password: 'short' }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      const password = 'Invited-staff-password-1';
      value(await s.call('acceptStaffInvite', s.anonymous(), { token, password }));
      expect(await s.call('acceptStaffInvite', s.anonymous(), { token, password })).toMatchObject({
        ok: false,
        error: { code: 'INVITE_INVALID' },
      });
      expect(value(await s.call('getStaffInvite', s.anonymous(), { token }))).toMatchObject({
        state: 'used',
      });

      // They hold the role (given by the inviting Admin) and can sign in, straight to two-step.
      const member = value<{ roles: Array<{ role: string; instructorType: string | null }> }>(
        await s.call('getStaffMember', s.admin.request, { userId: invited.userId }),
      );
      expect(member.roles).toEqual([
        expect.objectContaining({ role: 'instructor', instructorType: 'employee' }),
      ]);
      const signIn = await s.h.signIn(s.h.browser(), email, password);
      expect(signIn.body).toMatchObject({ status: 'signed_in', next: '/two-step' });
      expect(
        value<Invites>(await s.call('listStaffInvites', s.admin.request, {})).some(
          (i) => i.email === email,
        ),
      ).toBe(false);
    });

    it('gives a verified account the role at once, and cancels or resends an invitation', async () => {
      const person = await s.newStudent();
      const [account] = await getDb()
        .select({ email: userAccount.email })
        .from(userAccount)
        .where(eq(userAccount.id, person.userId));
      expect(
        value<{ mode: string }>(
          await s.call('inviteStaff', s.admin.request, {
            name: 'Existing Person',
            email: account?.email as string,
            locale: 'bn',
            role: 'finance',
          }),
        ).mode,
      ).toBe('assigned');

      const email = `cancelled.${Date.now().toString(36)}@example.test`;
      value(
        await s.call('inviteStaff', s.admin.request, {
          name: 'Later Maybe',
          email,
          locale: 'bn',
          role: 'admin',
        }),
      );
      const first = inviteLinkFor(email);
      const [invite] = value<Invites>(await s.call('listStaffInvites', s.admin.request, {})).filter(
        (i) => i.email === email,
      );
      const invitationId = invite?.invitationId as string;
      value(await s.call('resendStaffInvite', s.admin.request, { invitationId }));
      const second = inviteLinkFor(email);
      expect(second).not.toBe(first);
      // The old link stopped working when a new one was sent.
      expect(await s.call('getStaffInvite', s.anonymous(), { token: first })).toMatchObject({
        ok: false,
        error: { code: 'INVITE_INVALID' },
      });
      value(await s.call('cancelStaffInvite', s.admin.request, { invitationId }));
      expect(
        await s.call('acceptStaffInvite', s.anonymous(), {
          token: second,
          password: 'Cancelled-invite-password-1',
        }),
      ).toMatchObject({ ok: false, error: { code: 'INVITE_INVALID' } });
    });

    it('lets only an Admin invite, list, resend or cancel', async () => {
      const student = await s.newStudent();
      for (const caller of [student.request, s.instructor.request]) {
        expect(
          (
            await s.call('inviteStaff', caller, {
              name: 'Nope',
              email: 'nope@example.test',
              locale: 'en',
              role: 'admin',
            })
          ).ok,
        ).toBe(false);
        expect((await s.call('listStaffInvites', caller, {})).ok).toBe(false);
      }
    });
  });
});
