// [LT] US7.13 attribution money (the human's choice): resolving a dispute gives the confirmed owner
// the disputed section's share of the unassigned pool, as one balanced ledger reassignment that the
// next payout cycle picks up. It waits while payouts.payrollAndAttribution is off or the draft
// golden set is unapproved; with the flag on, a cycle refuses to commit until the drafts are
// approved. Re-resolving and a second case never move a share twice; conservation holds.
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instructorCycleLines } from '#src/features/ledger/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import {
  attributionReassignment,
  auditLogEntry,
  ledgerPosting,
  ledgerTransaction,
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
import { setDraftGoldenGateForTests } from './new-rules.server.ts';
import { setPayoutClockForTests } from './payouts.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let finance: Caller;
let sections: string[];
let owner: string;

const dhakaNow = new Date(Date.now() + 6 * 3600_000);
const month = dhakaNow.toISOString().slice(0, 7);
const nextMonthStart = new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth() + 1, 2));

/** A sale made while no section had an owner: the whole 70% pool is unassigned. */
async function unassignedSale(amount: number) {
  const pool = Math.floor((amount * 7000) / 10_000);
  await withTransaction(getDb(), async (tx) => {
    const exec = tx as unknown as ReturnType<typeof getDb>;
    const [row] = await exec
      .insert(ledgerTransaction)
      .values({
        kind: 'course_sale',
        sourcePaymentId: randomUUID(),
        courseId: course.courseId,
        amountPoisha: amount,
        instructorShareBps: 7000,
        occurredAt: new Date(),
      })
      .returning({ id: ledgerTransaction.transactionId });
    const id = row?.id as string;
    await exec.insert(ledgerPosting).values([
      { transactionId: id, account: 'gateway_clearing', amountPoisha: amount },
      { transactionId: id, account: 'platform_revenue', amountPoisha: -(amount - pool) },
      { transactionId: id, account: 'unassigned_instructor_pool', amountPoisha: -pool },
    ]);
  });
}

async function openCase() {
  const [a, b] = [course.lead.userId, course.co?.userId as string];
  return value<{ caseId: string }>(
    await s.call('openAttributionCase', finance.request, {
      courseId: course.courseId,
      sectionId: sections[0],
      claimantIds: [a, b],
      description: 'Both say they recorded this section.',
    }),
  ).caseId;
}

const resolve = (caseId: string) =>
  s.call('resolveAttributionCase', finance.request, {
    caseId,
    ownerId: owner,
    reason: 'The upload history shows the Lead recorded it.',
  });

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

/** Balances of the course's pool and the owner's payable (credits positive). */
async function balances() {
  const rows = await getDb()
    .select({
      account: ledgerPosting.account,
      instructorId: ledgerPosting.instructorId,
      total: sql<string>`-sum(${ledgerPosting.amountPoisha})`,
    })
    .from(ledgerPosting)
    .innerJoin(ledgerTransaction, eq(ledgerTransaction.transactionId, ledgerPosting.transactionId))
    .where(eq(ledgerTransaction.courseId, course.courseId))
    .groupBy(ledgerPosting.account, ledgerPosting.instructorId);
  const of = (account: string, who: string | null = null) =>
    Number(rows.find((r) => r.account === account && r.instructorId === who)?.total ?? 0);
  return {
    pool: of('unassigned_instructor_pool'),
    owner: of('instructor_payable', owner),
    sum: rows.reduce((x, r) => x + Number(r.total), 0),
  };
}

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
  course = await p.published(goalId, { sections: 2, withCo: true });
  owner = course.lead.userId;
  sections = value<{ sections: Array<{ sectionId: string }> }>(
    await s.call('getAttributionCourse', finance.request, { course: course.courseId }),
  ).sections.map((x) => x.sectionId);
  // Two sales while nobody owned a section: 84000 and 69999 poisha unassigned.
  await unassignedSale(120_000);
  await unassignedSale(99_999);
  setPayoutClockForTests(() => nextMonthStart);
}, 180_000);
afterAll(async () => {
  setDraftGoldenGateForTests(() => false);
  setPayoutClockForTests(() => new Date());
  await s?.close();
});

describe('attribution money', () => {
  let firstCase: string;

  it('with the flag off, resolving records the owner’s share as pending and moves no money', async () => {
    firstCase = await openCase();
    // 2 sections: floor(84000 / 2) + floor(69999 / 2) = 42000 + 34999.
    expect(value(await resolve(firstCase))).toEqual({
      state: 'resolved',
      movedPoisha: 76_999,
      isPosted: false,
    });
    expect(await balances()).toMatchObject({ pool: 153_999, owner: 0, sum: 0 });
    const queue = value<{
      pendingReassignments: number;
      resolved: Array<{ reassignment: unknown }>;
    }>(await s.call('listAttributionCases', finance.request, {}));
    expect(queue.pendingReassignments).toBe(1);
    expect(queue.resolved[0]?.reassignment).toEqual({ movedPoisha: 76_999, isPosted: false });
    expect(await s.call('postAttributionReassignments', finance.request, {})).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.attribution.rulesOff' },
    });
    // A second resolution of the same case is refused (never a second move).
    expect(await resolve(firstCase)).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.attribution.resolved' },
    });
  });

  it('with the flag on, nothing is posted and no cycle commits until the drafts are approved', async () => {
    await setFlag('on');
    setDraftGoldenGateForTests(() => false);
    expect(await s.call('postAttributionReassignments', finance.request, {})).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.attribution.rulesOff' },
    });
    const run = value<{ inputHash: string; rules: { isOn: boolean; isApproved: boolean } }>(
      await s.call('dryRunPayoutCycle', finance.request, { month }),
    );
    expect(run.rules).toEqual({ isOn: true, isApproved: false });
    expect(
      await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.draftsUnapproved' } });
  });

  it('once approved, the pending share is posted once, balanced, and the next cycle pays it', async () => {
    setDraftGoldenGateForTests(() => true);
    expect(value(await s.call('postAttributionReassignments', finance.request, {}))).toEqual({
      posted: 1,
      totalPoisha: 76_999,
    });
    expect(value(await s.call('postAttributionReassignments', finance.request, {}))).toEqual({
      posted: 0,
      totalPoisha: 0,
    });
    expect(await balances()).toEqual({ pool: 77_000, owner: 76_999, sum: 0 });
    const run = value<{ lines: Array<{ instructorId: string; earned: number; payout: number }> }>(
      await s.call('dryRunPayoutCycle', finance.request, { month }),
    );
    expect(run.lines.find((l) => l.instructorId === owner)).toMatchObject({
      earned: 76_999,
      payout: 76_999,
    });
    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(
        and(
          eq(auditLogEntry.subjectId, firstCase),
          eq(auditLogEntry.action, 'payouts.attribution.posted'),
        ),
      );
    expect(audits).toHaveLength(1);
    // The owner's cycle statement shows the move as a reassignment, not as a sale.
    const far = new Date('2100-01-01T00:00:00Z');
    const lines = await instructorCycleLines(owner, { cutoff: far, committedAt: far }, null);
    const moved = lines.filter((l) => l.amount === 76_999);
    expect(moved.map((l) => l.kind)).toEqual(['attribution_reassignment']);
  });

  it('a second case on the same section moves only the new sale’s share, at once', async () => {
    await unassignedSale(50_000); // 35000 unassigned → 17500 for the section
    const second = await openCase();
    expect(value(await resolve(second))).toEqual({
      state: 'resolved',
      movedPoisha: 17_500,
      isPosted: true,
    });
    expect(await balances()).toEqual({ pool: 94_500, owner: 94_499, sum: 0 });
    const rows = await getDb().select().from(attributionReassignment);
    expect(rows.map((r) => r.totalPoisha).sort()).toEqual([17_500, 76_999]);
    // The stored reassignment cannot be edited.
    await expect(
      getDb().execute(sql`UPDATE attribution_reassignment SET total_poisha = 1`),
    ).rejects.toThrow();
    await setFlag('off');
  });
});
