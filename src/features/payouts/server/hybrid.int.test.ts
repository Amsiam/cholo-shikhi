// [LT] US7.27 hybrid line through the payout cycle, behind payouts.payrollAndAttribution: a real
// ৳1,500 sale credits the Lead the default 70% (105000); with a hybrid policy of 2000000 + 1500 bp
// the cycle pays 2000000 + floor(150000 × 1500 / 10000) = 2022500, posting the salary and the
// share adjustment (−82500, back to platform revenue) to the ledger once, balanced.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import {
  ledgerPosting,
  ledgerTransaction,
  payoutLine,
  staffRoleAssignment,
} from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { setHrClockForTests } from '../../hr/server/hr.server.ts';
import { setDraftGoldenGateForTests } from './new-rules.server.ts';
import { setPayoutClockForTests } from './payouts.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let finance: Caller;

const dhakaNow = new Date(Date.now() + 6 * 3600_000);
const month = dhakaNow.toISOString().slice(0, 7);
const nextMonthStart = new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth() + 1, 2));
const lastMonth = new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth() - 1, 10));
const lastMonthEnd = new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth(), 0))
  .toISOString()
  .slice(0, 10);

type DryRun = {
  inputHash: string;
  lines: Array<{
    instructorId: string;
    earned: number;
    salary: number;
    adjustment: number;
    payout: number;
  }>;
};

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

const leadLine = async () =>
  value<DryRun>(await s.call('dryRunPayoutCycle', finance.request, { month })).lines.find(
    (l) => l.instructorId === course.lead.userId,
  );

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  // Two sections, both owned by the Lead. ৳1,500 = 150 000 poisha.
  course = await p.published(goalId, { sections: 2, price: '1500', months: 6 });
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  // The hybrid policy is saved last month, so it is in effect from this month's 1st.
  setHrClockForTests(() => lastMonth);
  value(
    await s.call('savePayPolicyVersion', finance.request, {
      instructorId: course.lead.userId,
      kind: 'hybrid',
      salaryPoisha: 2_000_000,
      shareBps: 1500,
    }),
  );
  // Every Employee instructor is on payroll (AC7.16.4). The harness's other Employees left before
  // this month, so they have no line and do not block the commit.
  const employees = await getDb()
    .select({ userId: staffRoleAssignment.userId })
    .from(staffRoleAssignment)
    .where(
      and(
        eq(staffRoleAssignment.role, 'instructor'),
        eq(staffRoleAssignment.instructorType, 'employee'),
        isNull(staffRoleAssignment.revokedAt),
      ),
    );
  for (const { userId } of employees.filter((e) => e.userId !== course.lead.userId))
    value(
      await s.call('saveEmployeeRecord', finance.request, {
        instructorId: userId,
        salaryPoisha: 1_000_000,
        joinedOn: '2025-01-01',
        exitOn: lastMonthEnd,
        leaveBalanceDays: 0,
      }),
    );
  const buyer = await s.newStudent();
  const checkout = value<{ paymentId: string }>(
    await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
  );
  value(
    await s.call('settleMyFakePayment', buyer.request, {
      paymentId: checkout.paymentId,
      outcome: 'succeed',
    }),
  );
  setPayoutClockForTests(() => nextMonthStart);
}, 240_000);
afterAll(async () => {
  setHrClockForTests(() => new Date());
  setPayoutClockForTests(() => new Date());
  setDraftGoldenGateForTests(() => false);
  await s?.close();
});

describe('hybrid line', () => {
  it('with the flag off the Lead gets the default share only', async () => {
    expect(await leadLine()).toMatchObject({
      earned: 105_000,
      salary: 0,
      adjustment: 0,
      payout: 105_000,
    });
  });

  it('with the flag on: salary + 1500 bp of the attributed sale, not the default 70%', async () => {
    await setFlag('on');
    expect(await leadLine()).toMatchObject({
      earned: 105_000,
      salary: 2_000_000,
      adjustment: 22_500 - 105_000,
      payout: 2_022_500,
    });
  });

  it('commits once approved, posting salary and adjustment to the ledger, balanced', async () => {
    setDraftGoldenGateForTests(() => true);
    const run = value<DryRun>(await s.call('dryRunPayoutCycle', finance.request, { month }));
    value(await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }));
    const [line] = await getDb()
      .select()
      .from(payoutLine)
      .where(eq(payoutLine.instructorId, course.lead.userId));
    expect(line).toMatchObject({ earned: 105_000, salary: 2_000_000, adjustment: -82_500 });
    expect(line?.payout).toBe(2_022_500);
    // The Lead's payable now holds exactly the line's payout.
    const [payable] = await getDb()
      .select({ total: sql<string>`-sum(${ledgerPosting.amountPoisha})` })
      .from(ledgerPosting)
      .where(
        and(
          eq(ledgerPosting.account, 'instructor_payable'),
          eq(ledgerPosting.instructorId, course.lead.userId),
        ),
      );
    expect(Number(payable?.total)).toBe(2_022_500);
    const adjustments = await getDb()
      .select({ account: ledgerPosting.account, amount: ledgerPosting.amountPoisha })
      .from(ledgerPosting)
      .innerJoin(
        ledgerTransaction,
        eq(ledgerTransaction.transactionId, ledgerPosting.transactionId),
      )
      .where(eq(ledgerTransaction.kind, 'pay_policy_adjustment'));
    expect(adjustments.sort((a, b) => a.amount - b.amount)).toEqual([
      { account: 'platform_revenue', amount: -82_500 },
      { account: 'instructor_payable', amount: 82_500 },
    ]);
    await expect(getDb().execute(sql`UPDATE payout_line SET adjustment = 0`)).rejects.toThrow();
    await setFlag('off');
  });
});
