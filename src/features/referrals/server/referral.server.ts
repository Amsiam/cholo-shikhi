// Referrals (US8.6, US8.7; FR8.2). A Student's link carries an opaque code and nothing personal
// (AC8.6.1). A new account opened through someone's link is attributed to them once; never to
// oneself, and never from a device the referrer marked as their own by opening their Refer page
// or their own link (AC8.6.2). Each confirmed payment by a referred account accrues the Admin-set
// share of the amount paid after promo to the referrer, in the ledger (AC8.7.1); a refund claws it
// back in proportion, which can take the balance below 0 (AC8.7.2/AC8.7.3). Nothing accrues
// without a confirmed payment (AC8.7.4): Commerce calls accrueReferral only in its settlement
// transaction. Earnings are separate from instructor payouts.
import { randomBytes } from 'node:crypto';
import type { Actor } from '#src/features/identity-access/index.ts';
import {
  type ReferralKind,
  recordReferral,
  referralAccrualOf,
  referralBalance,
  referralLines,
} from '#src/features/ledger/index.ts';
import { settings } from '#src/features/platform/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx } from '#src/server/db.ts';
import { createReferralRepository } from '../data/referral.repository.ts';
import { clawbackFor, REFERRAL_CODE_ALPHABET, referralShare } from '../domain/referral.ts';
import { REFERRAL_SETTINGS } from '../domain/referral-settings.ts';
import { ReferralCodeInput } from './referral.schema.ts';

const repo = createReferralRepository();

/** The device cookie that marks a browser as a referrer's own (AC8.6.2). */
export const SELF_REFERRAL_COOKIE = 'cs_ref_self';
/** The code of the link a visitor opened, until they sign in (claimed by the app shell). */
export const PENDING_REFERRAL_COOKIE = 'cs_ref';

function newCode(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => REFERRAL_CODE_ALPHABET[b % REFERRAL_CODE_ALPHABET.length]).join(
    '',
  );
}

/** The user's referral code, created on first use. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await repo.codeOf(db, userId);
    if (existing) return existing.code;
    const created = await repo.insertCode(db, userId, newCode());
    if (created) return created.code;
  }
  throw new Error('could not create a referral code');
}

export const referralLink = (code: string) => `${getEnv().APP_BASE_URL}/r/${code}`;

export async function shareBps(): Promise<number | null> {
  const r = await settings().get(REFERRAL_SETTINGS.shareBps);
  return r.ok ? r.value.value : null;
}

export type ReferralLine = {
  kind: ReferralKind;
  amountPoisha: number;
  occurredAt: string;
};

export type MyReferral = {
  code: string;
  link: string;
  referredCount: number;
  /** The share of each paid enrolment, or null while the Admin has not set it. */
  shareBps: number | null;
  /** The referral balance in poisha; negative after a clawback of money already withdrawn. */
  balancePoisha: number;
  lines: ReferralLine[];
};

/** S18 Me → Refer: the link, the balance and its history. */
export async function myReferral(actor: Actor): Promise<Result<MyReferral, never>> {
  const code = await ensureReferralCode(actor.userId);
  const [count, bps, balance, lines] = await Promise.all([
    repo.referredCount(getDb(), actor.userId),
    shareBps(),
    referralBalance(actor.userId),
    referralLines(actor.userId),
  ]);
  return ok({
    code,
    link: referralLink(code),
    referredCount: count,
    shareBps: bps,
    balancePoisha: balance,
    lines: lines.map((l) => ({ kind: l.kind, amountPoisha: l.amount, occurredAt: l.occurredAt })),
  });
}

export type ClaimOutcome =
  | 'pending'
  | 'attributed'
  | 'unknown_code'
  | 'own_code'
  | 'own_device'
  | 'already_attributed';

/**
 * Attributes the signed-in account to the code's owner, once. Refused for one's own code, from a
 * device marked as the owner's (AC8.6.2), or when the account already has a referrer.
 */
export async function claimReferral(
  actor: Actor,
  raw: ReferralCodeInput,
  selfMarkedCode: string | undefined,
): Promise<Result<{ outcome: ClaimOutcome }, never>> {
  const parsed = ReferralCodeInput.safeParse(raw);
  if (!parsed.success) return ok({ outcome: 'unknown_code' as const });
  const { code } = parsed.data;
  const db = getDb();
  const owner = await repo.byCode(db, code);
  if (!owner) return ok({ outcome: 'unknown_code' as const });
  if (owner.userId === actor.userId) return ok({ outcome: 'own_code' as const });
  if (selfMarkedCode === code) return ok({ outcome: 'own_device' as const });
  const inserted = await repo.insertAttribution(db, {
    referredUserId: actor.userId,
    referrerUserId: owner.userId,
    code,
  });
  return ok({ outcome: inserted ? ('attributed' as const) : ('already_attributed' as const) });
}

/** Whether the code belongs to this user (opening one's own link marks the device). */
export async function isOwnCode(userId: string, code: string): Promise<boolean> {
  return (await repo.byCode(getDb(), code))?.userId === userId;
}

/**
 * AC8.7.1: accrues the referrer's share of a confirmed payment by a referred account, inside the
 * settlement transaction. Nothing when the account has no referrer, the share is not set or rounds
 * to 0 poisha. Once per payment. Returns the amount accrued (0 when nothing).
 */
export async function accrueReferral(
  tx: TxHandle,
  payment: { paymentId: string; userId: string; amountPoisha: number; occurredAt: Date },
): Promise<number> {
  const attribution = await repo.attributionOf(unwrapTx(tx), payment.userId);
  if (!attribution) return 0;
  const bps = await shareBps();
  if (bps === null) return 0;
  const share = referralShare(payment.amountPoisha, bps);
  if (share <= 0) return 0;
  const posted = await recordReferral(tx, {
    kind: 'referral_accrual',
    sourceId: payment.paymentId,
    referrerId: attribution.referrerUserId,
    amountPoisha: share,
    occurredAt: payment.occurredAt,
  });
  if (!posted.ok) throw new Error(`ledger refused referral accrual ${payment.paymentId}`);
  return posted.value ? share : 0;
}

/**
 * AC8.7.2/AC8.7.3: claws back a refunded payment's accrual in proportion, inside the refund
 * transaction. Nothing when the payment accrued nothing. Returns the amount clawed back.
 */
export async function clawbackReferral(
  tx: TxHandle,
  refund: { paymentId: string; paidPoisha: number; refundedPoisha: number; occurredAt: Date },
): Promise<number> {
  const accrual = await referralAccrualOf(tx, refund.paymentId);
  if (!accrual) return 0;
  const back = clawbackFor({
    accrued: accrual.amount,
    paid: refund.paidPoisha,
    refunded: Math.min(refund.refundedPoisha, refund.paidPoisha),
  });
  if (back <= 0) return 0;
  const posted = await recordReferral(tx, {
    kind: 'referral_clawback',
    sourceId: refund.paymentId,
    referrerId: accrual.referrerId,
    amountPoisha: back,
    occurredAt: refund.occurredAt,
  });
  if (!posted.ok) throw new Error(`ledger refused referral clawback ${refund.paymentId}`);
  return posted.value ? back : 0;
}
