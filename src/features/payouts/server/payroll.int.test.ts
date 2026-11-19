// [LT] US7.16 / AC7.10.3 payroll through the payout cycle, behind payouts.payrollAndAttribution:
// off → no salary lines (the cycle is as before); on → the April dry run shows prorated salary
// lines and flags absence without leave; commit is refused until the draft golden set is approved
// and while an Employee has no salary (named), including an Employee with no HR record at all
// (AC7.16.4); the committed salary is posted to the ledger once,
// balanced; May has no line for the April leaver.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { ledgerPosting, ledgerTransaction, payoutLine } from '#src/server/schema/index.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';
import { setHrClockForTests } from '../../hr/server/hr.server.ts';
import { setDraftGoldenGateForTests } from './new-rules.server.ts';
import { setPayoutClockForTests } from './payouts.server.ts';

let s: ServerFnHarness;
let finance: Caller;
let shirin: Caller;
let nasrin: Caller;
const month = '2026-04';

type DryRun = {
  inputHash: string;
  totals: { salary: number };
  lines: Array<{
    instructorId: string;
    earned: number;
    salary: number;
    payout: number;
    absenceWithoutLeaveDays: number;
  }>;
  missingSalary: Array<{ instructorId: string; name: string }>;
};

const dry = async (m = month) =>
  value<DryRun>(await s.call('dryRunPayoutCycle', finance.request, { month: m }));

let flagRevision: number | undefined;
const setFlag = async (state: 'on' | 'off') => {
  const saved = value<{ revision: number }>(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'payouts.payrollAndAttribution',
      description: 'LT: new payout rules',
      state,
      ...(flagRevision ? { expectedRevision: flagRevision } : {}),
    }),
  );
  flagRevision = saved.revision;
};

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  shirin = await s.newInstructor();
  nasrin = await s.newInstructor();
  setHrClockForTests(() => new Date('2026-03-10T06:00:00.000Z'));
  value(
    await s.call('saveEmployeeRecord', finance.request, {
      instructorId: shirin.userId,
      salaryPoisha: 3_000_000,
      joinedOn: '2025-01-01',
      exitOn: '2026-04-15',
      leaveBalanceDays: 0,
    }),
  );
  value(
    await s.call('recordInstructorLeave', finance.request, {
      instructorId: shirin.userId,
      kind: 'absence',
      startsOn: '2026-04-06',
      endsOn: '2026-04-07',
    }),
  );
  value(
    await s.call('saveEmployeeRecord', finance.request, {
      instructorId: nasrin.userId,
      salaryPoisha: null,
      joinedOn: '2026-04-21',
    }),
  );
  setPayoutClockForTests(() => new Date('2026-05-02T00:00:00.000Z'));
}, 120_000);
afterAll(async () => {
  setHrClockForTests(() => new Date());
  setPayoutClockForTests(() => new Date());
  setDraftGoldenGateForTests(() => false);
  await s?.close();
});

describe('payroll salary lines', () => {
  it('with the flag off there are no salary lines', async () => {
    const run = await dry();
    expect(run.lines).toEqual([]);
    expect(run.missingSalary).toEqual([]);
    expect(run.totals.salary).toBe(0);
  });

  it('with the flag on: prorated salaries, absence flagged, the Employee without salary named', async () => {
    await setFlag('on');
    const run = await dry();
    // AC7.16.2: exit on 15 Apr (30 days) → 3000000 × 15 / 30.
    expect(run.lines).toEqual([
      expect.objectContaining({
        instructorId: shirin.userId,
        earned: 0,
        salary: 1_500_000,
        payout: 1_500_000,
        absenceWithoutLeaveDays: 2,
      }),
    ]);
    // AC7.16.4: nasrin has a record but no salary; the harness's instructor is an Employee with no
    // HR record at all. Both are named.
    expect(run.missingSalary.map((x) => x.instructorId).sort()).toEqual(
      [nasrin.userId, s.instructor.userId].sort(),
    );
    expect(run.missingSalary.every((x) => x.name.length > 0)).toBe(true);
  });

  it('commit is refused until the drafts are approved, then while a salary is missing', async () => {
    setDraftGoldenGateForTests(() => false);
    let run = await dry();
    expect(
      await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.draftsUnapproved' } });
    setDraftGoldenGateForTests(() => true);
    run = await dry();
    const refused = await s.call('commitPayoutCycle', finance.request, {
      month,
      inputHash: run.inputHash,
    });
    expect(refused).toMatchObject({
      ok: false,
      error: {
        i18nKey: 'errors.payouts.noSalary',
        fieldErrors: { instructors: [expect.any(String), expect.any(String)] },
      },
    });
    // With nasrin's salary set, the Employee with no HR record still blocks the commit.
    value(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: nasrin.userId,
        salaryPoisha: 1_000_000,
        joinedOn: '2026-04-21',
      }),
    );
    run = await dry();
    expect(run.missingSalary.map((x) => x.instructorId)).toEqual([s.instructor.userId]);
    expect(
      await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }),
    ).toMatchObject({
      ok: false,
      error: {
        i18nKey: 'errors.payouts.noSalary',
        fieldErrors: { instructors: [expect.any(String)] },
      },
    });
    // Recorded as having left in March: no April line, nothing missing.
    value(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: s.instructor.userId,
        salaryPoisha: 2_000_000,
        joinedOn: '2025-01-01',
        exitOn: '2026-03-31',
        leaveBalanceDays: 0,
      }),
    );
    expect((await dry()).missingSalary).toEqual([]);
  });

  it('commits salary lines and posts each salary to the ledger once, balanced', async () => {
    const run = await dry();
    // Joined 21 Apr: 10 of 30 days → floor(1000000 × 10 / 30) = 333333.
    expect(run.lines.find((l) => l.instructorId === nasrin.userId)?.salary).toBe(333_333);
    expect(run.totals.salary).toBe(1_833_333);
    value(await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }));
    const lines = await getDb().select().from(payoutLine);
    expect(lines.map((l) => [l.instructorId, l.salary, l.payout]).sort()).toEqual(
      [
        [shirin.userId, 1_500_000, 1_500_000],
        [nasrin.userId, 333_333, 333_333],
      ].sort(),
    );
    const payable = await getDb()
      .select({
        instructorId: ledgerPosting.instructorId,
        total: sql<string>`-sum(${ledgerPosting.amountPoisha})`,
      })
      .from(ledgerPosting)
      .innerJoin(
        ledgerTransaction,
        eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
      )
      .where(
        and(
          eq(ledgerTransaction.kind, 'salary_accrual'),
          eq(ledgerPosting.account, 'instructor_payable'),
        ),
      )
      .groupBy(ledgerPosting.instructorId);
    expect(Object.fromEntries(payable.map((p) => [p.instructorId, Number(p.total)]))).toEqual({
      [shirin.userId]: 1_500_000,
      [nasrin.userId]: 333_333,
    });
    const [balance] = await getDb()
      .select({ total: sql<string>`sum(${ledgerPosting.amountPoisha})` })
      .from(ledgerPosting)
      .innerJoin(
        ledgerTransaction,
        eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
      )
      .where(eq(ledgerTransaction.kind, 'salary_accrual'));
    expect(Number(balance?.total)).toBe(0);
    // A committed salary cannot be edited.
    await expect(
      getDb().execute(sql`UPDATE payout_line SET salary = salary + 1`),
    ).rejects.toThrow();
  });

  it('AC7.10.3: May has no salary line for the April leaver; the joiner gets a full month', async () => {
    setPayoutClockForTests(() => new Date('2026-06-02T00:00:00.000Z'));
    const run = await dry('2026-05');
    expect(run.lines.map((l) => [l.instructorId, l.salary])).toEqual([[nasrin.userId, 1_000_000]]);
    await setFlag('off');
  });
});
