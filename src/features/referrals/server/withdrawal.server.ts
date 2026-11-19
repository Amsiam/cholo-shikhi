// Referrer verification and withdrawals (US8.8, US8.9; FR8.2).
// - AC8.9.2: a referrer first declares they are 18 or older; without it they can keep referring but
//   no KYC is collected and the balance is "not payable". KYC and the bKash, Nagad or bank account
//   reuse the instructor KYC capture and Finance's review (US7.19–US7.21) with party `referrer`;
//   a holder name that does not match is rejected by Finance with a reason (AC8.9.3).
// - AC8.8.1: at or above the Admin-set threshold, with KYC cleared and no open referral fraud flag
//   (quarantine) or suspension, the referrer asks to withdraw the whole balance; the owner-operator
//   (an Admin with two-step sign-in) approves it in the product. Approval re-checks everything in
//   the same transaction, pays through the DISBURSEMENT STUB only (no live rail, no credentials;
//   automation never pays) and posts the referral_payout to the ledger, once. AC8.8.2: no threshold
//   means payouts are not available yet. Every decision is audit-logged.
import {
  type Actor,
  getIdentity,
  isAccountSuspended,
} from '#src/features/identity-access/index.ts';
import {
  getMyKyc,
  getVerificationStatus,
  type MyKyc,
  type SavePayoutAccountInput,
  type SubmitKycInput,
  savePayoutAccount,
  submitKyc,
} from '#src/features/kyc/index.ts';
import { recordReferral, referralBalance } from '#src/features/ledger/index.ts';
import { createAudit, settings } from '#src/features/platform/index.ts';
import { isReferralQuarantined } from '#src/features/trustops/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createReferralRepository, type WithdrawalRow } from '../data/referral.repository.ts';
import { type WithdrawalBlock, withdrawalBlock } from '../domain/referral.ts';
import { REFERRAL_SETTINGS } from '../domain/referral-settings.ts';
import { DecideWithdrawalInput } from './referral.schema.ts';
import { ensureReferralCode, shareBps } from './referral.server.ts';

const repo = createReferralRepository();
const audit = createAudit({ clock: systemClock });

type WithdrawalError = AppError<
  'FORBIDDEN' | 'INVALID_STATE' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT'
>;
const withKey = <C extends WithdrawalError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canApprove = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

/**
 * The development disbursement stub: it moves no money and needs no credentials. A live bKash,
 * Nagad or bank rail is out of scope until the human approves one; the stub's reference is
 * deterministic per withdrawal, so a retry never pays twice.
 */
export const disbursementStub = {
  async disburse(input: { withdrawalId: string; amountPoisha: number; rail: string }) {
    return { providerRef: `stub-${input.rail}-${input.withdrawalId}` };
  },
};

export async function payoutThreshold(): Promise<number | null> {
  const r = await settings().get(REFERRAL_SETTINGS.payoutThresholdPoisha);
  return r.ok ? r.value.value : null;
}

async function isAdult(userId: string): Promise<boolean> {
  await ensureReferralCode(userId);
  return Boolean((await repo.codeOf(getDb(), userId))?.adultDeclaredAt);
}

/** Every fact the withdrawal rule needs, read now. */
async function factsOf(userId: string, balance?: number) {
  const [adult, threshold, bal, verification, quarantined, suspended, open] = await Promise.all([
    isAdult(userId),
    payoutThreshold(),
    balance === undefined ? referralBalance(userId) : Promise.resolve(balance),
    getVerificationStatus(userId),
    isReferralQuarantined(userId),
    isAccountSuspended(userId),
    repo.openWithdrawalOf(getDb(), userId),
  ]);
  return {
    facts: {
      isAdult: adult,
      thresholdPoisha: threshold,
      balancePoisha: bal,
      kycStatus: verification.status,
      isQuarantined: quarantined,
      isSuspended: suspended,
      hasPendingWithdrawal: open !== null,
    },
    account: verification.account,
    open,
  };
}

export type WithdrawalView = {
  withdrawalId: string;
  amountPoisha: number;
  status: WithdrawalRow['status'];
  rail: WithdrawalRow['rail'];
  accountMasked: string;
  requestedAt: string;
  decidedAt: string | null;
  reason: string | null;
};
const viewOf = (w: WithdrawalRow): WithdrawalView => ({
  withdrawalId: w.withdrawalId,
  amountPoisha: w.amountPoisha,
  status: w.status,
  rail: w.rail,
  accountMasked: w.accountMasked,
  requestedAt: w.requestedAt.toISOString(),
  decidedAt: w.decidedAt?.toISOString() ?? null,
  reason: w.reason,
});

export type MyReferralPayout = {
  isAdult: boolean;
  thresholdPoisha: number | null;
  /** Why the balance cannot be withdrawn now, or null when it can. */
  block: WithdrawalBlock | null;
  kyc: MyKyc;
  withdrawals: WithdrawalView[];
};

/** S18: everything the payout part of Me → Refer shows. */
export async function myReferralPayout(actor: Actor): Promise<Result<MyReferralPayout, never>> {
  const [{ facts }, kyc, withdrawals] = await Promise.all([
    factsOf(actor.userId),
    getMyKyc(actor),
    repo.withdrawalsOf(getDb(), actor.userId, 20),
  ]);
  if (!kyc.ok) return kyc;
  return ok({
    isAdult: facts.isAdult,
    thresholdPoisha: facts.thresholdPoisha,
    block: withdrawalBlock(facts),
    kyc: kyc.value,
    withdrawals: withdrawals.map(viewOf),
  });
}

/** AC8.9.1/AC8.9.2: "I am 18 or older". Recorded once; it opens referrer KYC. */
export async function declareAdult(
  actor: Actor,
  correlationId: string,
): Promise<Result<{ isAdult: true }, never>> {
  await ensureReferralCode(actor.userId);
  await withTransaction(getDb(), async (tx) => {
    await repo.declareAdult(unwrapTx(tx), actor.userId, new Date());
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'referrals.adult.declared',
      subjectType: 'user_account',
      subjectId: actor.userId,
      correlationId,
    });
  });
  return ok({ isAdult: true as const });
}

const adultRequired = () => withKey('INVALID_STATE', 'errors.referral.adultRequired');

/** US8.9: referrer KYC (NID), only after the adult declaration (AC8.9.2). */
export async function submitReferrerKyc(actor: Actor, raw: SubmitKycInput) {
  if (!(await isAdult(actor.userId))) return err(adultRequired());
  return submitKyc(actor, raw, 'referrer');
}

/** US8.9: the referrer's bKash, Nagad or bank account; Finance checks the name (AC8.9.3). */
export async function saveReferrerPayoutAccount(
  actor: Actor,
  raw: SavePayoutAccountInput,
  correlationId: string,
) {
  if (!(await isAdult(actor.userId))) return err(adultRequired());
  return savePayoutAccount(actor, raw, correlationId);
}

/** AC8.8.1: asks to withdraw the whole balance; it waits for the owner-operator's approval. */
export async function requestWithdrawal(
  actor: Actor,
): Promise<Result<WithdrawalView, WithdrawalError>> {
  const { facts, account } = await factsOf(actor.userId);
  const block = withdrawalBlock(facts);
  if (block) return err(withKey('INVALID_STATE', `errors.referral.block.${block}`));
  if (!account) return err(withKey('INVALID_STATE', 'errors.referral.block.kyc_not_cleared'));
  const row = await repo.insertWithdrawal(getDb(), {
    userId: actor.userId,
    amountPoisha: facts.balancePoisha,
    status: 'requested',
    rail: account.rail,
    accountMasked: account.accountMasked,
    requestedAt: new Date(),
  });
  if (!row) return err(withKey('CONFLICT', 'errors.referral.block.pending'));
  return ok(viewOf(row));
}

export type WithdrawalQueueRow = WithdrawalView & { userId: string; name: string };
export type ReferralAdmin = {
  shareBps: number | null;
  thresholdPoisha: number | null;
  open: WithdrawalQueueRow[];
  decided: WithdrawalQueueRow[];
};

/** A1 referral payouts: the settings and the requests waiting for approval. Admin only. */
export async function referralAdmin(actor: Actor): Promise<Result<ReferralAdmin, WithdrawalError>> {
  if (!canApprove(actor)) return err(withKey('FORBIDDEN', 'errors.referral.forbidden'));
  const [bps, threshold, queue] = await Promise.all([
    shareBps(),
    payoutThreshold(),
    repo.withdrawalQueue(getDb(), 200),
  ]);
  const names = await getIdentity().displayNamesOf([
    ...new Set([...queue.open, ...queue.decided].map((w) => w.userId)),
  ]);
  const row = (w: WithdrawalRow) => ({
    ...viewOf(w),
    userId: w.userId,
    name: names[w.userId] ?? '',
  });
  return ok({
    shareBps: bps,
    thresholdPoisha: threshold,
    open: queue.open.map(row),
    decided: queue.decided.map(row),
  });
}

/**
 * The owner-operator's decision (US7.6 gate). Approve: every rule is checked again against the
 * balance read inside this transaction (it may have dropped after a clawback), the stub pays, and
 * the payout is posted to the ledger once. Reject: needs a reason. Both are audit-logged.
 */
export async function decideWithdrawal(
  actor: Actor,
  raw: DecideWithdrawalInput,
  correlationId: string,
): Promise<Result<WithdrawalView, WithdrawalError>> {
  if (!canApprove(actor)) return err(withKey('FORBIDDEN', 'errors.referral.forbidden'));
  const input = DecideWithdrawalInput.parse(raw);
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'reject' && reason.length < 10)
    return err(withKey('VALIDATION_FAILED', 'errors.referral.reason'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const w = await repo.withdrawalForUpdate(exec, input.withdrawalId);
    if (!w) return err(withKey('NOT_FOUND', 'errors.referral.noWithdrawal'));
    if (w.status !== 'requested') return err(withKey('INVALID_STATE', 'errors.referral.decided'));
    if (w.userId === actor.userId) return err(withKey('FORBIDDEN', 'errors.referral.ownDecision'));
    const now = new Date();
    if (input.decision === 'reject') {
      await repo.decideWithdrawal(exec, w.withdrawalId, {
        status: 'rejected',
        decidedBy: actor.userId,
        decidedAt: now,
        reason,
        providerRef: null,
      });
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'referrals.withdrawal.rejected',
        subjectType: 'referral_withdrawal',
        subjectId: w.withdrawalId,
        before: { status: w.status },
        after: { status: 'rejected', amountPoisha: w.amountPoisha },
        reason,
        correlationId,
      });
      return ok(viewOf({ ...w, status: 'rejected', decidedAt: now, reason }));
    }
    // Re-check with the balance as it is now, ignoring this request itself.
    const balance = await referralBalance(w.userId, tx);
    const { facts } = await factsOf(w.userId, balance);
    const block = withdrawalBlock({ ...facts, hasPendingWithdrawal: false });
    if (block) return err(withKey('INVALID_STATE', `errors.referral.block.${block}`));
    if (balance < w.amountPoisha)
      return err(withKey('INVALID_STATE', 'errors.referral.balanceChanged'));
    const paid = await disbursementStub.disburse({
      withdrawalId: w.withdrawalId,
      amountPoisha: w.amountPoisha,
      rail: w.rail,
    });
    const posted = await recordReferral(tx, {
      kind: 'referral_payout',
      sourceId: w.withdrawalId,
      referrerId: w.userId,
      amountPoisha: w.amountPoisha,
      occurredAt: now,
    });
    if (!posted.ok || !posted.value)
      throw new Error(`referral payout could not be posted: ${w.withdrawalId}`);
    await repo.decideWithdrawal(exec, w.withdrawalId, {
      status: 'paid',
      decidedBy: actor.userId,
      decidedAt: now,
      reason: reason || null,
      providerRef: paid.providerRef,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'referrals.withdrawal.paid',
      subjectType: 'referral_withdrawal',
      subjectId: w.withdrawalId,
      before: { status: w.status },
      after: { status: 'paid', amountPoisha: w.amountPoisha, providerRef: paid.providerRef },
      correlationId,
    });
    return ok(viewOf({ ...w, status: 'paid', decidedAt: now, reason: reason || null }));
  });
}
