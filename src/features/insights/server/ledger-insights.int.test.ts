// [LT] A fake-gateway sale is posted to the double-entry ledger in the settlement transaction, split
// 70/30 by section ownership; the ledger refuses edits, deletes and unbalanced transactions; and
// course statistics, earnings and platform finance are visible only to the right people. Salary,
// pay-policy adjustments, attribution reassignments, payouts and referral money each show as their
// own labelled line on the books and the statements, reconciling to the ledger to the poisha.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  recordAttributionReassignment,
  recordInstructorPayout,
  recordPolicyAdjustment,
  recordReferral,
  recordSalaryAccrual,
} from '#src/features/ledger/index.ts';
import { createFileObjectStore } from '#src/features/platform/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { earningsStatement } from '#src/server/schema/index.ts';
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
import { setStatementStoreForTests } from './insights.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let buyer: Caller;
let paymentId: string;

beforeAll(async () => {
  s = await createServerFnHarness();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'LT price bounds',
      }),
    );
  }
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  // Three sections: the Co-instructor owns the first, the Lead the other two. ৳1,500 = 150 000 poisha.
  course = await p.published(goalId, { sections: 3, withCo: true, price: '1500', months: 6 });
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  buyer = await s.newStudent();
  const checkout = value<{ paymentId: string }>(
    await s.call('startCourseCheckout', buyer.request, { courseId: course.courseId }),
  );
  paymentId = checkout.paymentId;
  value(await s.call('settleMyFakePayment', buyer.request, { paymentId, outcome: 'succeed' }));
}, 180_000);
afterAll(async () => {
  await s?.close();
});

const postings = async () =>
  (
    await s.t.pool.query<{ account: string; instructor_id: string | null; amount: string }>(
      `SELECT p.account, p.instructor_id, p.amount_poisha::text AS amount
         FROM ledger_posting p JOIN ledger_transaction t USING (transaction_id)
        WHERE t.source_payment_id = $1`,
      [paymentId],
    )
  ).rows;

describe('posting a sale', () => {
  it('posts one balanced transaction split 70/30 by sections owned', async () => {
    const rows = await postings();
    const amount = (account: string, who: string | null = null) =>
      Number(rows.find((r) => r.account === account && r.instructor_id === who)?.amount);
    expect(amount('gateway_clearing')).toBe(150_000);
    expect(amount('platform_revenue')).toBe(-45_000);
    expect(amount('instructor_payable', course.lead.userId)).toBe(-70_000);
    expect(amount('instructor_payable', course.co?.userId ?? '')).toBe(-35_000);
    expect(rows.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(0);
  });

  it('does not post twice when the settlement is repeated', async () => {
    value(await s.call('settleMyFakePayment', buyer.request, { paymentId, outcome: 'succeed' }));
    const { rows } = await s.t.pool.query(
      'SELECT 1 FROM ledger_transaction WHERE source_payment_id = $1',
      [paymentId],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('the ledger protects itself', () => {
  const fails = async (sql: string, params: unknown[] = []) => {
    const client = await s.t.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql, params);
      await client.query('COMMIT');
      return null;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      return (e as Error).message;
    } finally {
      client.release();
    }
  };

  it('refuses updates and deletes', async () => {
    expect(
      await fails(
        'UPDATE ledger_posting SET amount_poisha = amount_poisha - 1 WHERE account = $1',
        ['platform_revenue'],
      ),
    ).toMatch(/append-only/);
    expect(await fails('DELETE FROM ledger_transaction')).toMatch(/append-only/);
  });

  it('refuses a transaction that does not balance', async () => {
    const message = await fails(
      `WITH t AS (
         INSERT INTO ledger_transaction (kind, source_payment_id, course_id, amount_poisha, instructor_share_bps, occurred_at)
         VALUES ('course_sale', gen_random_uuid(), gen_random_uuid(), 100, 7000, now()) RETURNING transaction_id)
       INSERT INTO ledger_posting (transaction_id, account, amount_poisha)
       SELECT transaction_id, 'gateway_clearing', 100 FROM t`,
    );
    expect(message).toMatch(/does not balance/);
  });
});

describe('who sees what', () => {
  it('shows the Lead and the Co-instructor the course statistics and their own earnings', async () => {
    const stats = value<{
      finance: { gross: number; platform: number; instructors: number; myEarnings: number };
      summary: { students: number; active: number };
      students: { rows: Array<{ userId: string; progressBps: number }> };
    }>(await s.call('getCourseStats', course.lead.request, { courseId: course.courseId }));
    expect(stats.finance).toMatchObject({
      gross: 150_000,
      platform: 45_000,
      instructors: 105_000,
      myEarnings: 70_000,
    });
    expect(stats.summary).toMatchObject({ students: 1, active: 1 });
    expect(stats.students.rows.map((r) => r.userId)).toEqual([buyer.userId]);

    const co = course.co as Caller;
    const coStats = value<{ finance: { myEarnings: number } }>(
      await s.call('getCourseStats', co.request, { courseId: course.courseId }),
    );
    expect(coStats.finance.myEarnings).toBe(35_000);
    const earnings = value<{ total: number; courses: Array<{ courseId: string; earned: number }> }>(
      await s.call('getMyInstructorEarnings', co.request, {}),
    );
    expect(earnings.total).toBe(35_000);
    expect(earnings.courses).toContainEqual(
      expect.objectContaining({ courseId: course.courseId, earned: 35_000 }),
    );
  });

  it('answers NOT_FOUND to another instructor, and refuses students and anonymous callers', async () => {
    const stranger = await s.newInstructor();
    expect(
      await s.call('getCourseStats', stranger.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    for (const name of ['getCourseStats', 'getMyInstructorEarnings', 'getPlatformBooks']) {
      const data = name === 'getCourseStats' ? { courseId: course.courseId } : {};
      expect(await s.call(name, buyer.request, data)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(await s.call(name, s.anonymous(), data)).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    }
  });

  it('gives platform finance to Admins only, with the sale in the journal', async () => {
    expect(await s.call('getPlatformBooks', course.lead.request, {})).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const books = value<{
      totals: { gross: number; platform: number };
      journal: { rows: Array<{ amount: number; postings: unknown[] }> };
    }>(await s.call('getPlatformBooks', s.admin.request, {}));
    expect(books.totals.gross).toBeGreaterThanOrEqual(150_000);
    expect(books.journal.rows.some((r) => r.amount === 150_000 && r.postings.length === 4)).toBe(
      true,
    );
    // An Admin also sees any course's statistics.
    expect(
      (await s.call('getCourseStats', s.admin.request, { courseId: course.courseId })).ok,
    ).toBe(true);
  });
});

describe('course NPS and the teaching dashboard (US7.17, US7.18)', () => {
  type Home = { askNps: boolean; sections: Array<{ lessons: Array<{ lessonId: string }> }> };
  type Teaching = {
    totals: {
      students: number;
      completionBps: number | null;
      nps: { responses: number; nps: number | null };
    };
    courses: Array<{ courseId: string; students: number; completed: number }>;
  };
  const home = async () =>
    value<Home>(await s.call('getMyLearningCourse', buyer.request, { courseId: course.courseId }));

  it('asks the NPS question once, only after the last lesson', async () => {
    expect((await home()).askNps).toBe(false);
    expect(
      await s.call('answerMyCourseNps', buyer.request, { courseId: course.courseId, score: 9 }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    for (const lesson of (await home()).sections.flatMap((x) => x.lessons))
      value(
        await s.call('completeMyLesson', buyer.request, {
          courseId: course.courseId,
          lessonId: lesson.lessonId,
        }),
      );
    expect((await home()).askNps).toBe(true);
    expect(
      value<{ saved: boolean }>(
        await s.call('answerMyCourseNps', buyer.request, { courseId: course.courseId, score: 9 }),
      ).saved,
    ).toBe(true);
    expect((await home()).askNps).toBe(false);
    // AC7.18.2: never twice; the first answer stays.
    expect(
      value<{ saved: boolean }>(
        await s.call('answerMyCourseNps', buyer.request, { courseId: course.courseId, score: 0 }),
      ).saved,
    ).toBe(false);
  });

  it('shows the instructor their students, completion and NPS (hidden below 5 answers)', async () => {
    const d = value<Teaching>(await s.call('getMyTeachingDashboard', course.lead.request, {}));
    expect(d.totals).toMatchObject({
      students: 1,
      completionBps: 10_000,
      nps: { responses: 1, nps: null },
    });
    expect(d.courses.find((c) => c.courseId === course.courseId)).toMatchObject({
      students: 1,
      completed: 1,
    });
    // Another instructor sees nothing of this course; a Student is refused.
    const other = value<Teaching>(
      await s.call('getMyTeachingDashboard', (await s.newInstructor()).request, {}),
    );
    expect(other.courses).toEqual([]);
    expect((await s.call('getMyTeachingDashboard', buyer.request, {})).ok).toBe(false);
  });
});

describe('monthly earnings statements (US7.8, monthly)', () => {
  type Statement = {
    month: string;
    opening: number;
    earned: number;
    refunded: number;
    closing: number;
    lines: Array<{ kind: string; amount: number; courseId: string | null }>;
    csv: { bn: string; en: string };
  };
  const thisMonth = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7);

  it('lists the month of the sale and gives each instructor only their own lines', async () => {
    const months = value<string[]>(
      await s.call('getMyEarningStatementMonths', course.lead.request, {}),
    );
    expect(months[0]).toBe(thisMonth);
    const lead = value<Statement>(
      await s.call('getMyEarningStatement', course.lead.request, { month: thisMonth }),
    );
    expect(lead.lines.length).toBeGreaterThanOrEqual(1);
    expect(lead.lines.every((l) => l.courseId === course.courseId)).toBe(true);
    // Conservation: what is owed at the end is the start plus the lines.
    expect(lead.closing).toBe(lead.opening + lead.lines.reduce((x, l) => x + l.amount, 0));
    expect(lead.earned - lead.refunded).toBe(lead.closing - lead.opening);
    // The CSV carries a BOM and the same total, in both languages.
    expect(lead.csv.en.startsWith('﻿')).toBe(true);
    expect(lead.csv.en).toContain('Owed at end');
    expect(lead.csv.bn).toContain('শেষে পাওনা');
    // A month with nothing still gives a statement that carries the balance.
    const empty = value<Statement>(
      await s.call('getMyEarningStatement', course.lead.request, { month: '2020-01' }),
    );
    expect(empty).toMatchObject({ opening: 0, closing: 0, lines: [] });
  });

  it('AC7.8.2: refuses students and malformed months; there is no way to name another instructor', async () => {
    expect((await s.call('getMyEarningStatement', buyer.request, { month: thisMonth })).ok).toBe(
      false,
    );
    expect(
      await s.call('getMyEarningStatement', course.lead.request, { month: '2026-13' }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const stranger = await s.newInstructor();
    const theirs = value<Statement>(
      await s.call('getMyEarningStatement', stranger.request, { month: thisMonth }),
    );
    expect(theirs.lines).toEqual([]);
  });
});

describe('stored monthly statements (FR7.4)', () => {
  it('stores an ended month once in both languages, and a new version only when the ledger changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'statements-'));
    const thisMonth = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7);
    type Stored = { stored: { version: number; storedAt: string; retainUntil: string } | null };
    const read = async () =>
      value<Stored>(
        await s.call('getMyEarningStatement', course.lead.request, { month: thisMonth }),
      ).stored;
    // While the month is open nothing is stored.
    setStatementStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)), () => new Date());
    expect(await read()).toBeNull();
    // Once it has ended: version 1, kept at least 10 years; viewing again stores nothing new.
    const later = new Date(Date.now() + 40 * 86_400_000);
    setStatementStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)), () => later);
    const first = await read();
    expect(first?.version).toBe(1);
    const years =
      (new Date(first?.retainUntil ?? 0).getTime() - new Date(first?.storedAt ?? 0).getTime()) /
      (365.25 * 86_400_000);
    expect(years).toBeGreaterThanOrEqual(9.99);
    expect((await read())?.version).toBe(1);
    const rows = await getDb()
      .select()
      .from(earningsStatement)
      .where(
        and(
          eq(earningsStatement.instructorId, course.lead.userId),
          eq(earningsStatement.month, thisMonth),
        ),
      );
    expect(rows.map((r) => r.locale).sort()).toEqual(['bn', 'en']);
    // A late sale dated in that month changes it: version 2, version 1 is kept.
    const late = await s.newStudent();
    const checkout = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', late.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', late.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
    expect((await read())?.version).toBe(2);
    const all = await getDb()
      .select()
      .from(earningsStatement)
      .where(
        and(
          eq(earningsStatement.instructorId, course.lead.userId),
          eq(earningsStatement.month, thisMonth),
        ),
      );
    expect(all).toHaveLength(4);
    setStatementStoreForTests(createFileObjectStore(), () => new Date());
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('salary, adjustments, reassignments, payouts and referral money (books and statements)', () => {
  type Books = {
    salesCount: number;
    ledger: {
      entries: Array<{
        kind: string;
        transactions: number;
        accounts: Array<{ account: string; amount: number }>;
      }>;
      balances: Array<{ account: string; amount: number }>;
      imbalance: number;
      isReconciled: boolean;
    };
    journal: { rows: Array<{ kind: string; postings: Array<{ instructorName: string | null }> }> };
  };
  type Statement = {
    opening: number;
    earned: number;
    refunded: number;
    reassigned: number;
    salary: number;
    policyAdjustment: number;
    paidOut: number;
    net: number;
    closing: number;
    lines: Array<{ kind: string; amount: number; courseId: string | null }>;
    csv: { bn: string; en: string };
    stored: { version: number } | null;
  };
  type Earnings = {
    total: number;
    courseEarnings: number;
    reassigned: number;
    salary: number;
    policyAdjustment: number;
  };
  const thisMonth = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7);
  let staffer: Caller;
  const post = <T>(fn: (tx: Parameters<Parameters<typeof withTransaction>[1]>[0]) => Promise<T>) =>
    withTransaction(getDb(), fn);
  const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);

  beforeAll(async () => {
    staffer = await s.newInstructor();
    const occurredAt = new Date();
    await post(async (tx) => {
      ok(
        await recordSalaryAccrual(tx, {
          lineId: randomUUID(),
          instructorId: staffer.userId,
          amount: 2_000_000,
          occurredAt,
        }),
      );
      ok(
        await recordAttributionReassignment(tx, {
          caseId: randomUUID(),
          courseId: course.courseId,
          instructorId: staffer.userId,
          amount: 1_234,
          occurredAt,
        }),
      );
      ok(
        await recordInstructorPayout(tx, {
          lineId: randomUUID(),
          instructorId: staffer.userId,
          amount: 500,
          occurredAt,
        }),
      );
      const sourceId = randomUUID();
      for (const [kind, amountPoisha, src] of [
        ['referral_accrual', 5_000, sourceId],
        ['referral_clawback', 1_000, sourceId],
        ['referral_payout', 2_000, randomUUID()],
      ] as const)
        ok(
          await recordReferral(tx, {
            kind,
            sourceId: src,
            referrerId: buyer.userId,
            amountPoisha,
            occurredAt,
          }),
        );
    });
  });

  /** Per kind and account, straight from the postings (credit positive). */
  const rawByKind = async () =>
    (
      await s.t.pool.query<{ kind: string; account: string; credit: string }>(
        `SELECT t.kind, p.account, (-sum(p.amount_poisha))::text AS credit
           FROM ledger_posting p JOIN ledger_transaction t USING (transaction_id)
          GROUP BY t.kind, p.account`,
      )
    ).rows;

  it('the books list every entry type on its own line and reconcile to the poisha', async () => {
    const books = value<Books>(await s.call('getPlatformBooks', s.admin.request, {}));
    expect(books.ledger.isReconciled).toBe(true);
    expect(books.ledger.imbalance).toBe(0);
    const kinds = books.ledger.entries.map((e) => e.kind);
    for (const k of [
      'course_sale',
      'attribution_reassignment',
      'salary_accrual',
      'instructor_payout',
      'referral_accrual',
      'referral_clawback',
      'referral_payout',
    ])
      expect(kinds).toContain(k);
    // Every line equals the ledger's own postings for that kind and account.
    const raw = await rawByKind();
    for (const r of raw.filter((x) => Number(x.credit) !== 0)) {
      const entry = books.ledger.entries.find((e) => e.kind === r.kind);
      expect(entry?.accounts.find((a) => a.account === r.account)?.amount).toBe(Number(r.credit));
    }
    const salary = books.ledger.entries.find((e) => e.kind === 'salary_accrual');
    expect(salary?.accounts).toEqual([
      { account: 'instructor_payable', amount: 2_000_000 },
      { account: 'salary_expense', amount: -2_000_000 },
    ]);
    const balances = (
      await s.t.pool.query<{ account: string; amount: string }>(
        `SELECT account, (-sum(amount_poisha))::text AS amount FROM ledger_posting GROUP BY account`,
      )
    ).rows;
    expect(Object.fromEntries(books.ledger.balances.map((b) => [b.account, b.amount]))).toEqual(
      Object.fromEntries(balances.map((b) => [b.account, Number(b.amount)])),
    );
    expect(books.ledger.balances.reduce((x, b) => x + b.amount, 0)).toBe(0);
    // The journal shows the new entries too, with the referrer named on referral money.
    const journalKinds = books.journal.rows.map((r) => r.kind);
    expect(journalKinds).toEqual(expect.arrayContaining(['salary_accrual', 'referral_payout']));
    expect(
      books.journal.rows
        .find((r) => r.kind === 'referral_accrual')
        ?.postings.some((p) => (p.instructorName ?? '').length > 0),
    ).toBe(true);
    // "N sales" counts sales only, not every entry.
    const [sales] = (
      await s.t.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ledger_transaction WHERE kind IN ('course_sale', 'platform_sale')`,
      )
    ).rows;
    expect(books.salesCount).toBe(Number(sales?.n));
  });

  it('a policy adjustment is its own line, and the books still reconcile', async () => {
    await post(async (tx) =>
      ok(
        await recordPolicyAdjustment(tx, {
          lineId: randomUUID(),
          instructorId: staffer.userId,
          amount: -82_500,
          occurredAt: new Date(),
        }),
      ),
    );
    const books = value<Books>(await s.call('getPlatformBooks', s.admin.request, {}));
    expect(books.ledger.isReconciled).toBe(true);
    expect(books.ledger.entries.find((e) => e.kind === 'pay_policy_adjustment')).toEqual({
      kind: 'pay_policy_adjustment',
      transactions: 1,
      accounts: [
        { account: 'platform_revenue', amount: 82_500 },
        { account: 'instructor_payable', amount: -82_500 },
      ],
    });
  });

  it('the statement labels each line by its kind and its totals reconcile to the ledger', async () => {
    const st = value<Statement>(
      await s.call('getMyEarningStatement', staffer.request, { month: thisMonth }),
    );
    expect(st.lines.map((l) => l.kind).sort()).toEqual(
      [
        'attribution_reassignment',
        'instructor_payout',
        'pay_policy_adjustment',
        'salary_accrual',
      ].sort(),
    );
    expect(st).toMatchObject({
      earned: 0,
      refunded: 0,
      reassigned: 1_234,
      salary: 2_000_000,
      policyAdjustment: -82_500,
      paidOut: 500,
      net: 1_234 + 2_000_000 - 82_500,
    });
    expect(st.closing).toBe(st.opening + st.lines.reduce((x, l) => x + l.amount, 0));
    // The closing balance is the instructor's payable in the ledger, to the poisha.
    const [owed] = (
      await s.t.pool.query<{ owed: string }>(
        `SELECT (-coalesce(sum(amount_poisha), 0))::text AS owed FROM ledger_posting
          WHERE account = 'instructor_payable' AND instructor_id = $1`,
        [staffer.userId],
      )
    ).rows;
    expect(st.closing).toBe(Number(owed?.owed));
    expect(st.lines.find((l) => l.kind === 'attribution_reassignment')?.courseId).toBe(
      course.courseId,
    );
    expect(st.csv.en).toContain('Salary');
    expect(st.csv.en).toContain('Pay-policy adjustment');
    expect(st.csv.en).toContain('Attribution reassignment');
    expect(st.csv.bn).toContain('বেতন');
    expect(st.csv.bn).toContain('পে-পলিসি সমন্বয়');
    expect(st.csv.en).not.toMatch(/,Sale,/);
  });

  it('the earnings view shows salary, adjustment and reassignment, adding up to the total', async () => {
    const e = value<Earnings>(await s.call('getMyInstructorEarnings', staffer.request, {}));
    expect(e).toMatchObject({
      courseEarnings: 1_234,
      reassigned: 1_234,
      salary: 2_000_000,
      policyAdjustment: -82_500,
      total: 1_234 + 2_000_000 - 82_500,
    });
    // Total earned + paid out = everything credited to the payable.
    const [credited] = (
      await s.t.pool.query<{ total: string }>(
        `SELECT (-coalesce(sum(p.amount_poisha), 0))::text AS total
           FROM ledger_posting p JOIN ledger_transaction t USING (transaction_id)
          WHERE p.account = 'instructor_payable' AND p.instructor_id = $1
            AND t.kind <> 'instructor_payout'`,
        [staffer.userId],
      )
    ).rows;
    expect(e.total).toBe(Number(credited?.total));
  });

  it('a stored statement gets a new version when a salary month changes; the old one is kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'statements-new-kinds-'));
    const later = new Date(Date.now() + 40 * 86_400_000);
    setStatementStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)), () => later);
    const read = async () =>
      value<Statement>(await s.call('getMyEarningStatement', staffer.request, { month: thisMonth }))
        .stored;
    expect((await read())?.version).toBe(1);
    expect((await read())?.version).toBe(1);
    await post(async (tx) =>
      ok(
        await recordSalaryAccrual(tx, {
          lineId: randomUUID(),
          instructorId: staffer.userId,
          amount: 10_000,
          occurredAt: new Date(),
        }),
      ),
    );
    expect((await read())?.version).toBe(2);
    const rows = await getDb()
      .select()
      .from(earningsStatement)
      .where(
        and(
          eq(earningsStatement.instructorId, staffer.userId),
          eq(earningsStatement.month, thisMonth),
        ),
      );
    expect(rows.map((r) => r.version).sort()).toEqual([1, 1, 2, 2]);
    setStatementStoreForTests(createFileObjectStore(), () => new Date());
    rmSync(dir, { recursive: true, force: true });
  });
});
