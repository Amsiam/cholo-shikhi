// [LT] Payout cycles end to end (US7.2–US7.5, US7.8 per cycle, US7.9), revenue share only:
// a real sale split 70/30 by section ownership in the ledger, a verified Lead and an unverified
// Co-instructor, dry run → commit (stale refused, snapshot locked, audited) → payment (Admin with
// two-step sign-in, golden set approved, idempotent) → failure holds and flags → release → paid once
// under the original cycle; the next cycle never counts a sale twice.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setKycStoreForTests } from '#src/features/kyc/server/kyc.server.ts';
import { createFileObjectStore } from '#src/features/platform/index.ts';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry, payoutLine, payoutStatement } from '#src/server/schema/index.ts';
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
import {
  setGoldenGateForTests,
  setPayoutClockForTests,
  setPayoutStoreForTests,
} from './payouts.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let finance: Caller;
let dir: string;

/** The current Dhaka month and the next one; "now" is moved into the next month. */
const dhakaNow = new Date(Date.now() + 6 * 3600_000);
const month = dhakaNow.toISOString().slice(0, 7);
const nextMonthStart = new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth() + 1, 2));
const nextMonth = nextMonthStart.toISOString().slice(0, 7);

type DryRun = {
  inputHash: string;
  totals: { earned: number; payout: number; carryOut: number };
  lines: Array<{
    instructorId: string;
    earned: number;
    payout: number;
    carryOut: number;
    state: string;
  }>;
};
type Overview = {
  openMonths: string[];
  cycles: Array<{
    month: string;
    lines: Array<{ lineId: string; instructorId: string; state: string; payout: number }>;
  }>;
};

async function buy() {
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
}

async function verify(instructor: Caller) {
  const photo = (seed: number) => {
    const b = Buffer.alloc(8192, seed);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b.toString('base64');
  };
  value(
    await s.call('submitMyKyc', instructor.request, {
      legalName: 'Farhana Akter',
      nidNumber: '1990123456789',
      front: photo(1),
      back: photo(2),
    }),
  );
  const pick = async (kind: 'kyc' | 'account') =>
    value<Array<{ kind: string; id: string; userId: string }>>(
      await s.call('listKycQueue', finance.request, {}),
    ).find((i) => i.userId === instructor.userId && i.kind === kind)?.id;
  value(
    await s.call('decideKycItem', finance.request, {
      kind: 'kyc',
      id: await pick('kyc'),
      decision: 'approve',
    }),
  );
  value(
    await s.call('saveMyPayoutAccount', instructor.request, {
      rail: 'bkash',
      accountName: 'Farhana Akter',
      accountNumber: '01712345678',
    }),
  );
  value(
    await s.call('decideKycItem', finance.request, {
      kind: 'account',
      id: await pick('account'),
      decision: 'approve',
    }),
  );
}

const lineOf = async (instructorId: string, m = month) =>
  value<Overview>(await s.call('getPayoutsOverview', finance.request, {}))
    .cycles.find((c) => c.month === m)
    ?.lines.find((l) => l.instructorId === instructorId);

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  dir = mkdtempSync(join(tmpdir(), 'payouts-'));
  setKycStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)));
  setPayoutStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)));
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'LT price bounds',
      }),
    );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  // Three sections: the Co-instructor owns one, the Lead two. ৳1,500 = 150 000 poisha.
  course = await p.published(goalId, { sections: 3, withCo: true, price: '1500', months: 6 });
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  await buy();
  await verify(course.lead);
  setPayoutClockForTests(() => nextMonthStart);
}, 240_000);
afterAll(async () => {
  setPayoutClockForTests(() => new Date());
  setGoldenGateForTests(() => false);
  await s?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('payout cycle', () => {
  it('refuses a month that has not ended, and anyone but Finance or Admins', async () => {
    expect(await s.call('dryRunPayoutCycle', finance.request, { month: nextMonth })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.payouts.cycleOpen' },
    });
    expect((await s.call('dryRunPayoutCycle', course.lead.request, { month })).ok).toBe(false);
  });

  it('AC7.2: the dry run pays the verified Lead, holds the unverified Co, conserves money, saves nothing', async () => {
    const run = value<DryRun>(await s.call('dryRunPayoutCycle', finance.request, { month }));
    const lead = run.lines.find((l) => l.instructorId === course.lead.userId);
    const co = run.lines.find((l) => l.instructorId !== course.lead.userId);
    expect(lead).toMatchObject({ state: 'pending' });
    expect(co).toMatchObject({ state: 'held' });
    for (const l of run.lines) expect(l.payout - l.carryOut).toBe(l.earned);
    expect(run.totals.payout).toBe(run.lines.reduce((x, l) => x + l.payout, 0));
    expect(value<Overview>(await s.call('getPayoutsOverview', finance.request, {})).cycles).toEqual(
      [],
    );
  });

  it('AC7.3: commit refuses a stale hash, then locks the snapshot with one audit entry per line', async () => {
    const run = value<DryRun>(await s.call('dryRunPayoutCycle', finance.request, { month }));
    expect(
      await s.call('commitPayoutCycle', finance.request, { month, inputHash: 'f'.repeat(64) }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.dryRunStale' } });
    value(await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }));
    expect(
      await s.call('commitPayoutCycle', finance.request, { month, inputHash: run.inputHash }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.alreadyCommitted' } });
    const lead = await lineOf(course.lead.userId);
    // AC7.3.2: amounts cannot be edited or deleted, even directly in the database.
    await expect(
      getDb().execute(
        sql`UPDATE payout_line SET payout = payout + 1 WHERE line_id = ${lead?.lineId}`,
      ),
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`DELETE FROM payout_line WHERE line_id = ${lead?.lineId}`),
    ).rejects.toThrow();
    const audits = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.action, 'payout.line.committed'));
    expect(audits).toHaveLength(run.lines.length);
  });

  it('AC7.4/7.6: paying needs the approved golden set and the Admin with two-step sign-in; a retry pays once', async () => {
    const lead = await lineOf(course.lead.userId);
    const pay = (caller: Caller, key: string) =>
      s.call('recordPayoutPayment', caller.request, {
        lineId: lead?.lineId,
        providerRef: 'BKASH-TRX-0001',
        idempotencyKey: key,
      });
    setGoldenGateForTests(() => false);
    expect(await pay(s.admin, 'key-0000000000000001')).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.payouts.goldenUnapproved' },
    });
    setGoldenGateForTests(() => true);
    expect((await pay(finance, 'key-0000000000000001')).ok).toBe(false);

    // AC7.5 first: a failure holds the line and flags re-verification; release needs verification.
    value(
      await s.call('recordPayoutFailure', finance.request, {
        lineId: lead?.lineId,
        note: 'bKash rejected: name mismatch',
      }),
    );
    expect(await lineOf(course.lead.userId)).toMatchObject({ state: 'held' });
    expect(
      value<{ status: string }>(await s.call('getMyKycStatus', course.lead.request, {})).status,
    ).toBe('reverification_required');
    expect(
      await s.call('releaseHeldPayout', finance.request, { lineId: lead?.lineId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.notVerified' } });
    const account = value<Array<{ kind: string; id: string; userId: string }>>(
      await s.call('listKycQueue', finance.request, {}),
    ).find((i) => i.userId === course.lead.userId && i.kind === 'account');
    value(
      await s.call('decideKycItem', finance.request, {
        kind: 'account',
        id: account?.id,
        decision: 'approve',
      }),
    );
    value(await s.call('releaseHeldPayout', finance.request, { lineId: lead?.lineId }));

    value(await pay(s.admin, 'key-0000000000000002'));
    value(await pay(s.admin, 'key-0000000000000002'));
    expect(await pay(s.admin, 'key-0000000000000003')).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.payouts.notPayable' },
    });
    const [row] = await getDb()
      .select()
      .from(payoutLine)
      .where(eq(payoutLine.lineId, lead?.lineId as string));
    expect(row).toMatchObject({ state: 'disbursed', providerRef: 'BKASH-TRX-0001' });
    // The Co-instructor's held line cannot be paid.
    const co = (await lineOf(course.co?.userId ?? ''))?.lineId;
    if (co)
      expect(
        await s.call('recordPayoutPayment', s.admin.request, {
          lineId: co,
          providerRef: 'X-1',
          idempotencyKey: 'key-0000000000000009',
        }),
      ).toMatchObject({ ok: false, error: { i18nKey: 'errors.payouts.notPayable' } });
  });

  it('the next cycle counts only the new sale (even one recorded late), never the old one again', async () => {
    const first = await lineOf(course.lead.userId);
    const firstEarned = value<{ earned: number }>(
      await s.call('getMyCycleStatement', course.lead.request, { month }),
    ).earned;
    // A second sale is recorded now, after the first cycle was committed; it is dated inside the
    // first cycle's month, so the no-gap rule puts it in the next cycle.
    await buy();
    setPayoutClockForTests(
      () => new Date(Date.UTC(dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth() + 2, 2)),
    );
    const run = value<DryRun>(
      await s.call('dryRunPayoutCycle', finance.request, { month: nextMonth }),
    );
    const lead = run.lines.find((l) => l.instructorId === course.lead.userId);
    expect(lead?.earned).toBe(firstEarned);
    expect(lead?.payout).toBe(firstEarned);
    expect(first?.payout).toBe(firstEarned);
    setPayoutClockForTests(() => nextMonthStart);
  });

  it('AC7.8/7.9: each instructor sees their own cycles and statement, and nobody else can', async () => {
    type Mine = Array<{ month: string; state: string; payout: number }>;
    const mine = value<Mine>(await s.call('getMyPayoutCycles', course.lead.request, {}));
    expect(mine[0]).toMatchObject({ month, state: 'disbursed' });
    const statement = value<{
      earned: number;
      lines: Array<{ amount: number }>;
      csv: { en: string };
    }>(await s.call('getMyCycleStatement', course.lead.request, { month }));
    expect(statement.lines.reduce((x, l) => x + l.amount, 0)).toBe(statement.earned);
    expect(statement.csv.en).toContain('Payout');
    // US7.8 / FR7.4: stored at commit in both languages and kept at least 10 years.
    const kept = value<{ storedAt: string; retainUntil: string }>(
      await s.call('getMyCycleStatement', course.lead.request, { month }),
    );
    const years =
      (new Date(kept.retainUntil).getTime() - new Date(kept.storedAt).getTime()) /
      (365.25 * 86_400_000);
    expect(years).toBeGreaterThanOrEqual(9.99);
    const lead = await lineOf(course.lead.userId);
    const stored = await getDb()
      .select()
      .from(payoutStatement)
      .where(eq(payoutStatement.lineId, lead?.lineId as string));
    expect(stored.map((x) => x.locale).sort()).toEqual(['bn', 'en']);
    // AC7.8.3: the retention can never be set below 10 years.
    expect(
      await s.call('saveSetting', s.admin.request, {
        settingKey: 'payouts.statementRetentionYears',
        value: 9,
        reason: 'LT: below the floor',
      }),
    ).toMatchObject({ ok: false });
    const stranger = await s.newInstructor();
    expect((await s.call('getMyCycleStatement', stranger.request, { month })).ok).toBe(false);
    const student = await s.newStudent();
    expect((await s.call('getMyPayoutCycles', student.request, {})).ok).toBe(false);
  });
});
