// [LT] US7.1, US7.10, US7.24 (HR records only): Finance saves pay-policy versions (v1 in effect
// from the next cycle, v2 only after that), an Employee's salary and joining date, and leave and
// absence entries (10 − 3 = 7; an absence at 0 is "without leave"); a Contractor has no salary or
// leave; bad shares, amounts and dates and Students/Instructors are refused; all audit-logged.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/index.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';
import { setHrClockForTests } from './hr.server.ts';

let s: ServerFnHarness;
let finance: Awaited<ReturnType<ServerFnHarness['newFinance']>>;

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
}, 120_000);
afterAll(async () => {
  setHrClockForTests(() => new Date());
  await s?.close();
});

type Hr = {
  instructorType: string;
  record: { salaryPoisha: number | null; joinedOn: string | null; leaveBalanceDays: number } | null;
  policies: Array<{
    version: number;
    shareBps: number | null;
    isInEffect: boolean;
    createdBy: string;
  }>;
  leave: Array<{ isWithoutLeave: boolean }>;
};

async function contractor() {
  const person = await s.h.verifiedStudent();
  const assigned = await s.h.identity.roles.assign(
    { userId: s.admin.userId, roles: ['student', 'admin'], locale: 'en', hasStepUp: true },
    { userId: person.userId, role: 'instructor', instructorType: 'contractor' },
    'test-assign-contractor',
  );
  if (!assigned.ok) throw new Error('contractor assignment failed');
  return person.userId;
}

describe('pay-policy versions (US7.1)', () => {
  it('saves v1 for the next cycle; v2 mid-cycle leaves v1 in effect', async () => {
    const tasnim = await s.newInstructor();
    setHrClockForTests(() => new Date('2027-02-10T06:00:00.000Z'));
    const v1 = value<{ version: number; effectiveFrom: string }>(
      await s.call('savePayPolicyVersion', finance.request, {
        instructorId: tasnim.userId,
        kind: 'revenue_share',
        shareBps: 3500,
      }),
    );
    expect(v1).toEqual({ version: 1, effectiveFrom: '2027-02-28T18:00:00.000Z' });
    setHrClockForTests(() => new Date('2027-03-15T06:00:00.000Z'));
    const v2 = value<{ version: number; effectiveFrom: string }>(
      await s.call('savePayPolicyVersion', finance.request, {
        instructorId: tasnim.userId,
        kind: 'hybrid',
        salaryPoisha: 2_000_000,
        shareBps: 1500,
      }),
    );
    expect(v2).toEqual({ version: 2, effectiveFrom: '2027-03-31T18:00:00.000Z' });
    const hr = value<Hr>(
      await s.call('getInstructorHr', finance.request, { instructorId: tasnim.userId }),
    );
    expect(hr.policies.find((p) => p.isInEffect)?.version).toBe(1);
    expect(hr.policies.every((p) => p.createdBy === finance.userId)).toBe(true);

    for (const bad of [
      { kind: 'revenue_share', shareBps: 10_001 },
      { kind: 'salary', salaryPoisha: -1 },
      { kind: 'per_piece', perPiecePoisha: 500.5 },
    ])
      expect(
        (
          await s.call('savePayPolicyVersion', finance.request, {
            instructorId: tasnim.userId,
            ...bad,
          })
        ).ok,
      ).toBe(false);
  });
});

describe('employee records and leave (US7.10, US7.24)', () => {
  it('stores salary and joining date, then leave and absence entries', async () => {
    const emp = await s.newInstructor();
    value(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: emp.userId,
        salaryPoisha: 3_000_000,
        joinedOn: '2026-01-10',
        leaveBalanceDays: 10,
      }),
    );
    expect(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: emp.userId,
        exitOn: '2025-12-31',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.hr.exitBeforeJoin' } });
    const leave = value<{ balance: number; isWithoutLeave: boolean }>(
      await s.call('recordInstructorLeave', finance.request, {
        instructorId: emp.userId,
        kind: 'leave',
        startsOn: '2027-02-01',
        endsOn: '2027-02-03',
      }),
    );
    expect(leave).toEqual({ balance: 7, isWithoutLeave: false, entryId: expect.any(String) });
    expect(
      await s.call('recordInstructorLeave', finance.request, {
        instructorId: emp.userId,
        kind: 'leave',
        startsOn: '2027-02-05',
        endsOn: '2027-02-04',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.hr.leaveDates' } });

    value(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: emp.userId,
        leaveBalanceDays: 0,
      }),
    );
    const absence = value<{ balance: number; isWithoutLeave: boolean }>(
      await s.call('recordInstructorLeave', finance.request, {
        instructorId: emp.userId,
        kind: 'absence',
        startsOn: '2027-02-10',
        endsOn: '2027-02-10',
      }),
    );
    expect(absence).toMatchObject({ balance: 0, isWithoutLeave: true });

    const hr = value<Hr>(
      await s.call('getInstructorHr', s.admin.request, { instructorId: emp.userId }),
    );
    expect(hr.record).toMatchObject({ salaryPoisha: 3_000_000, joinedOn: '2026-01-10' });
    expect(hr.leave.map((l) => l.isWithoutLeave)).toContain(true);
    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.subjectId, emp.userId));
    expect(audits.map((a) => a.action)).toContain('hr.employeeRecord.saved');
    const list = value<Array<{ instructorId: string }>>(
      await s.call('listHrInstructors', finance.request, {}),
    );
    expect(list.map((l) => l.instructorId)).toContain(emp.userId);
  });

  it('AC7.10.2: a Contractor has no salary or leave fields', async () => {
    const id = await contractor();
    const hr = value<Hr>(await s.call('findHrInstructor', finance.request, { instructor: id }));
    expect(hr).toMatchObject({ instructorType: 'contractor', record: null, leave: [] });
    expect(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: id,
        salaryPoisha: 1_000_000,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.hr.contractor' } });
  });

  it('refuses Students and Instructors, and someone who is not an instructor', async () => {
    const st = await s.newStudent();
    expect((await s.call('listHrInstructors', st.request, {})).ok).toBe(false);
    expect((await s.call('listHrInstructors', s.instructor.request, {})).ok).toBe(false);
    expect(
      await s.call('findHrInstructor', finance.request, { instructor: st.userId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.hr.noInstructor' } });
  });
});
