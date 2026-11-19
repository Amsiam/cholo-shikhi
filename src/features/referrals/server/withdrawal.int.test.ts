// [LT] US8.8 / US8.9: a referrer declares they are 18 or older (no KYC without it, AC8.9.2), passes
// Finance's KYC and wallet review (party referrer; a name mismatch is rejected with a reason,
// AC8.9.3), and once at the Admin-set threshold asks to withdraw. The owner-operator approves in the
// product: paid once through the disbursement stub, posted as a referral_payout (AC8.8.1). With no
// threshold set the ৳500 default applies; KYC not cleared or an open referral fraud flag blocks them
// with the reason (AC8.8.3). A refund after the payout takes the balance to −4000 (AC8.7.3), and
// a clawback before approval makes the approval refuse. Students and Finance cannot approve.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setKycStoreForTests } from '#src/features/kyc/server/kyc.server.ts';
import { createFileObjectStore } from '#src/features/platform/index.ts';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry, ledgerTransaction } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import type { MyReferral } from './referral.server.ts';
import type { MyReferralPayout, ReferralAdmin, WithdrawalView } from './withdrawal.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;
let finance: Caller;
let dir: string;
type Caller = { request: Request; userId: string };

const jpeg = (seed: number) => {
  const b = Buffer.alloc(8192, seed);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b.toString('base64');
};
const kycInput = {
  legalName: 'Rumi Akter',
  nidNumber: '1990123456789',
  front: jpeg(3),
  back: jpeg(4),
};

const setting = async (settingKey: string, v: number) =>
  value(await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT setup' }));

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  dir = mkdtempSync(join(tmpdir(), 'ref-kyc-'));
  setKycStoreForTests(createFileObjectStore(pathToFileURL(`${dir}/`)));
  const p = createPublishHelper(s);
  await setting('catalog.coursePrice.minPoisha', 10_000);
  await setting('catalog.coursePrice.maxPoisha', 5_000_000);
  await setting('commerce.refund.windowDays', 7);
  await setting('referrals.shareBps', 500);
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
}, 240_000);
afterAll(async () => {
  await s?.close();
  rmSync(dir, { recursive: true, force: true });
});

const payout = async (c: Caller) =>
  value<MyReferralPayout>(await s.call('getMyReferralPayout', c.request, {}));
const balance = async (c: Caller) =>
  value<MyReferral>(await s.call('getMyReferral', c.request, {})).balancePoisha;

/** A referrer whose friend bought the 80000-poisha course: 4000 accrued. */
async function referrerWithSale() {
  const referrer = await s.newStudent();
  const { code } = value<MyReferral>(await s.call('getMyReferral', referrer.request, {}));
  const friend = await s.newStudent();
  value(await s.call('openReferralLink', friend.request, { code }));
  const c = value<{ paymentId: string }>(
    await s.call('startCourseCheckout', friend.request, { courseId: course.courseId }),
  );
  value(
    await s.call('settleMyFakePayment', friend.request, {
      paymentId: c.paymentId,
      outcome: 'succeed',
    }),
  );
  return { referrer, friend, paymentId: c.paymentId };
}

async function refund(friend: Caller, paymentId: string) {
  const { refundId } = value<{ refundId: string }>(
    await s.call('requestMyRefund', friend.request, { paymentId, reason: 'Changed my plans now.' }),
  );
  value(
    await s.call('decideRefundRequest', s.admin.request, {
      refundId,
      decision: 'approve',
      policy: 'full',
    }),
  );
}

type QueueItem = {
  kind: 'kyc' | 'account';
  id: string;
  userId: string;
  details: Record<string, string>;
};
const queueItem = async (userId: string, kind: 'kyc' | 'account') =>
  value<QueueItem[]>(await s.call('listKycQueue', finance.request, {})).find(
    (i) => i.userId === userId && i.kind === kind,
  );
const decideKyc = async (id: string | undefined, kind: 'kyc' | 'account', reason?: string) =>
  value(
    await s.call('decideKycItem', finance.request, {
      kind,
      id,
      decision: reason ? 'reject' : 'approve',
      ...(reason ? { reason } : {}),
    }),
  );

async function verify(referrer: Caller) {
  value(await s.call('declareReferrerAdult', referrer.request, {}));
  value(await s.call('submitMyReferrerKyc', referrer.request, kycInput));
  const kyc = await queueItem(referrer.userId, 'kyc');
  expect(kyc?.details.party).toBe('referrer');
  await decideKyc(kyc?.id, 'kyc');
  value(
    await s.call('saveMyReferrerPayoutAccount', referrer.request, {
      rail: 'bkash',
      accountName: 'Rumi Akter',
      accountNumber: '01712-345678',
    }),
  );
  await decideKyc((await queueItem(referrer.userId, 'account'))?.id, 'account');
}

describe('referral withdrawals', () => {
  it('walks AC8.9.2, AC8.8.2, AC8.8.3, then pays once (AC8.8.1) and goes to −4000 (AC8.7.3)', async () => {
    const { referrer, friend, paymentId } = await referrerWithSale();
    expect(await balance(referrer)).toBe(4000);
    // AC8.9.2: no adult declaration: not payable, and no KYC is collected.
    expect((await payout(referrer)).block).toBe('adult_required');
    expect(await s.call('submitMyReferrerKyc', referrer.request, kycInput)).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.referral.adultRequired' },
    });
    value(await s.call('declareReferrerAdult', referrer.request, {}));
    // No threshold set yet: the ৳500 default applies (the Admin can change it).
    expect(await payout(referrer)).toMatchObject({ thresholdPoisha: 50_000 });
    await setting('referrals.payoutThresholdPoisha', 3000);
    // AC8.8.3: KYC not cleared.
    expect((await payout(referrer)).block).toBe('kyc_not_cleared');
    value(await s.call('submitMyReferrerKyc', referrer.request, kycInput));
    await decideKyc((await queueItem(referrer.userId, 'kyc'))?.id, 'kyc');
    // AC8.9.3: a wallet in another name is rejected with a reason.
    value(
      await s.call('saveMyReferrerPayoutAccount', referrer.request, {
        rail: 'nagad',
        accountName: 'Somebody Else',
        accountNumber: '01812-345678',
      }),
    );
    await decideKyc(
      (await queueItem(referrer.userId, 'account'))?.id,
      'account',
      'The wallet name does not match the NID.',
    );
    expect((await payout(referrer)).kyc.account).toMatchObject({
      status: 'rejected',
      reason: 'The wallet name does not match the NID.',
    });
    value(
      await s.call('saveMyReferrerPayoutAccount', referrer.request, {
        rail: 'bkash',
        accountName: 'Rumi Akter',
        accountNumber: '01712-345678',
      }),
    );
    await decideKyc((await queueItem(referrer.userId, 'account'))?.id, 'account');

    // An open referral fraud flag holds the earnings (quarantine).
    const { flagId } = value<{ flagId: string }>(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'referral_fraud',
        user: referrer.userId,
        reason: 'Checking a cluster of new sign-ups.',
      }),
    );
    expect((await payout(referrer)).block).toBe('quarantined');
    value(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'clear',
        reason: 'Real friends; nothing wrong found.',
      }),
    );
    expect((await payout(referrer)).block).toBeNull();

    const w = value<WithdrawalView>(
      await s.call('requestReferralWithdrawal', referrer.request, {}),
    );
    expect(w).toMatchObject({ amountPoisha: 4000, status: 'requested', rail: 'bkash' });
    expect(await s.call('requestReferralWithdrawal', referrer.request, {})).toMatchObject({
      ok: false,
    });
    expect((await payout(referrer)).block).toBe('pending');

    // Only the owner-operator approves: not the referrer, not Finance.
    const decide = (c: Caller, decision: 'approve' | 'reject', reason?: string) =>
      s.call('decideReferralWithdrawal', c.request, {
        withdrawalId: w.withdrawalId,
        decision,
        ...(reason ? { reason } : {}),
      });
    expect((await decide(referrer, 'approve')).ok).toBe(false);
    expect((await decide(finance, 'approve')).ok).toBe(false);
    const queue = value<ReferralAdmin>(await s.call('getReferralAdmin', s.admin.request, {}));
    expect(queue).toMatchObject({ shareBps: 500, thresholdPoisha: 3000 });
    expect(queue.open.map((r) => r.withdrawalId)).toContain(w.withdrawalId);

    expect(value<WithdrawalView>(await decide(s.admin, 'approve')).status).toBe('paid');
    expect(await decide(s.admin, 'approve')).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.referral.decided' },
    });
    const posted = await getDb()
      .select()
      .from(ledgerTransaction)
      .where(eq(ledgerTransaction.sourcePaymentId, w.withdrawalId));
    expect(posted.map((t) => [t.kind, Number(t.amountPoisha)])).toEqual([
      ['referral_payout', 4000],
    ]);
    expect(await balance(referrer)).toBe(0);
    const audit = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.subjectId, w.withdrawalId));
    expect(audit.map((a) => a.action)).toContain('referrals.withdrawal.paid');

    // AC8.7.3: the referred sale is refunded after the payout: the balance is −4000, not payable.
    await refund(friend, paymentId);
    expect(await balance(referrer)).toBe(-4000);
    expect((await payout(referrer)).block).toBe('nothing_to_pay');
  });

  it('refuses to pay a request whose balance a refund took back, and rejects it with a reason', async () => {
    const { referrer, friend, paymentId } = await referrerWithSale();
    await setting('referrals.payoutThresholdPoisha', 3000);
    await verify(referrer);
    const w = value<WithdrawalView>(
      await s.call('requestReferralWithdrawal', referrer.request, {}),
    );
    await refund(friend, paymentId);
    expect(
      await s.call('decideReferralWithdrawal', s.admin.request, {
        withdrawalId: w.withdrawalId,
        decision: 'approve',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.referral.block.nothing_to_pay' } });
    expect(
      await s.call('decideReferralWithdrawal', s.admin.request, {
        withdrawalId: w.withdrawalId,
        decision: 'reject',
        reason: 'short',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.referral.reason' } });
    expect(
      value<WithdrawalView>(
        await s.call('decideReferralWithdrawal', s.admin.request, {
          withdrawalId: w.withdrawalId,
          decision: 'reject',
          reason: 'The referred purchase was refunded.',
        }),
      ).status,
    ).toBe('rejected');
    expect(
      await getDb()
        .select()
        .from(ledgerTransaction)
        .where(eq(ledgerTransaction.sourcePaymentId, w.withdrawalId)),
    ).toEqual([]);
    expect((await s.call('getReferralAdmin', referrer.request, {})).ok).toBe(false);
  });
});
