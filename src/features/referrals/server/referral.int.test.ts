// [LT] US8.6 / US8.7: a Student's referral link carries an opaque code only; a friend who opens it
// is attributed once (never oneself, never from the referrer's own device); the friend's confirmed
// payment accrues the Admin-set share to the referrer in the ledger (80000 poisha at 500 bp is
// 4000); a refund claws it back; with no share set the 1000 bp default applies; nothing accrues
// without a confirmed payment.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { ledgerTransaction, referralAttribution } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import type { MyReferral } from './referral.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let other: PublishedCourse;
type Caller = { request: Request; userId: string };

const withCookie = (request: Request, cookie: string) => {
  const headers = new Headers(request.headers);
  headers.set('cookie', [headers.get('cookie'), cookie].filter(Boolean).join('; '));
  return new Request(request.url, { headers });
};

beforeAll(async () => {
  s = await createServerFnHarness();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
    ['commerce.refund.windowDays', 7],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call(
      'saveSegment',
      s.admin.request,
      buildSegmentInput({ segmentType: 'job_aspirant' }),
    ),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  course = await p.published(goalId, { sections: 1, price: '৮০০' });
  other = await p.published(goalId, { sections: 1, price: '৮০০' });
}, 240_000);
afterAll(async () => {
  await s?.close();
});

async function buy(st: Caller, courseId = course.courseId) {
  const c = value<{ paymentId: string; amountPoisha: number }>(
    await s.call('startCourseCheckout', st.request, { courseId }),
  );
  value(
    await s.call('settleMyFakePayment', st.request, { paymentId: c.paymentId, outcome: 'succeed' }),
  );
  return c;
}
const referralOf = async (st: Caller) =>
  value<MyReferral>(await s.call('getMyReferral', st.request, {}));
const open = (request: Request, code: string) =>
  s.call('openReferralLink', request, { code }) as Promise<{
    ok: boolean;
    value?: { outcome: string };
  }>;
const setShare = async (bps: number) =>
  value(
    await s.call('saveSetting', s.admin.request, {
      settingKey: 'referrals.shareBps',
      value: bps,
      reason: 'LT referral share',
    }),
  );

describe('referral links and earnings', () => {
  it('AC8.6.1: one opaque link per account, with nothing personal in it', async () => {
    const r = await s.h.verifiedStudent();
    const caller = { request: r.browser.request('/'), userId: r.userId };
    const mine = await referralOf(caller);
    expect(mine.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(mine.link.endsWith(`/r/${mine.code}`)).toBe(true);
    expect(mine.link).not.toContain(r.userId);
    expect(mine.link).not.toContain(r.person.email.split('@')[0] as string);
    expect((await referralOf(caller)).code).toBe(mine.code);
    expect((await s.call('getMyReferral', s.anonymous(), {})).ok).toBe(false);
  });

  it('AC8.7.1/AC8.7.2: a referred purchase accrues 500 bp; its refund claws it back', async () => {
    const referrer = await s.newStudent();
    const { code } = await referralOf(referrer);
    // Before the Admin sets a share, the default 10% (1000 bp) applies: 80000 poisha earns 8000.
    const defaulted = await s.newStudent();
    const { code: defaultedCode, shareBps } = await referralOf(defaulted);
    expect(shareBps).toBe(1000);
    const early = await s.newStudent();
    expect((await open(early.request, defaultedCode)).value?.outcome).toBe('attributed');
    await buy(early, other.courseId);
    expect((await referralOf(defaulted)).balancePoisha).toBe(8000);

    await setShare(500);
    const friend = await s.newStudent();
    expect((await open(friend.request, code)).value?.outcome).toBe('attributed');
    // A second link does not move an attributed account.
    const { code: otherCode } = await referralOf(await s.newStudent());
    expect((await open(friend.request, otherCode)).value?.outcome).toBe('already_attributed');
    // AC8.7.4: an unpaid checkout accrues nothing.
    value(await s.call('startCourseCheckout', friend.request, { courseId: other.courseId }));
    expect((await referralOf(referrer)).balancePoisha).toBe(0);

    const { paymentId, amountPoisha } = await buy(friend);
    expect(amountPoisha).toBe(80_000);
    const after = await referralOf(referrer);
    expect(after.balancePoisha).toBe(4000);
    expect(after.referredCount).toBe(1);
    expect(after.lines).toEqual([
      expect.objectContaining({ kind: 'referral_accrual', amountPoisha: 4000 }),
    ]);

    const { refundId } = value<{ refundId: string }>(
      await s.call('requestMyRefund', friend.request, {
        paymentId,
        reason: 'Bought the wrong course.',
      }),
    );
    value(
      await s.call('decideRefundRequest', s.admin.request, {
        refundId,
        decision: 'approve',
        policy: 'full',
      }),
    );
    const refunded = await referralOf(referrer);
    expect(refunded.balancePoisha).toBe(0);
    expect(refunded.lines.map((l) => [l.kind, l.amountPoisha])).toEqual(
      expect.arrayContaining([
        ['referral_accrual', 4000],
        ['referral_clawback', -4000],
      ]),
    );
    const kinds = (
      await getDb()
        .select()
        .from(ledgerTransaction)
        .where(eq(ledgerTransaction.sourcePaymentId, paymentId))
    ).map((t) => t.kind);
    expect(kinds.sort()).toEqual(
      ['course_refund', 'course_sale', 'referral_accrual', 'referral_clawback'].sort(),
    );
  });

  it('AC8.6.2: no credit for oneself, nor for an account opened on the referrer’s device', async () => {
    await setShare(500);
    const r = await s.newStudent();
    const { code } = await referralOf(r);
    expect((await open(r.request, code)).value?.outcome).toBe('own_code');
    const second = await s.newStudent();
    const fromOwnDevice = withCookie(second.request, `cs_ref_self=${code}`);
    expect((await open(fromOwnDevice, code)).value?.outcome).toBe('own_device');
    await buy(second);
    expect((await referralOf(r)).balancePoisha).toBe(0);
    expect(
      await getDb()
        .select()
        .from(referralAttribution)
        .where(eq(referralAttribution.referredUserId, second.userId)),
    ).toEqual([]);
    expect((await open(second.request, 'ZZZZZZZZZZ')).value?.outcome).toBe('unknown_code');
  });

  it('a visitor’s link is kept until they sign in, then claimed by the app shell', async () => {
    const r = await s.newStudent();
    const { code } = await referralOf(r);
    expect((await open(s.anonymous(), code)).value?.outcome).toBe('pending');
    const visitor = await s.newStudent();
    value(await s.call('getShellState', withCookie(visitor.request, `cs_ref=${code}`), {}));
    const [row] = await getDb()
      .select()
      .from(referralAttribution)
      .where(eq(referralAttribution.referredUserId, visitor.userId));
    expect(row).toMatchObject({ referrerUserId: r.userId, code });
  });
});
