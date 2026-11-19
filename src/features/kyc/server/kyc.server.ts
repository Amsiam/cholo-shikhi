// KYC and payout accounts (U9; US7.19–US7.21), screen I6 for instructors and A6 for Finance.
// - Submit: legal name, NID number (stored encrypted, shown masked) and NID front/back photos. The
//   photos are checked by their first bytes and size, then stored in Bangladesh-hosted object
//   storage; the server never decodes them. A new submission waits for Finance.
// - Payout account: only after KYC is verified. bKash/Nagad need a Bangladesh mobile number, a bank
//   account 8–20 digits with a 9-digit routing number. Any change waits for Finance and holds
//   payouts until verified; the instructor is notified (AC7.20.3).
// - Finance (admin or finance role) approves or rejects with a reason; every decision is
//   audit-logged and notified. Nobody decides their own KYC or account.
// Nothing here logs or returns an NID number, an account number or an image (AC7.19.3).
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import {
  createAudit,
  createFileObjectStore,
  type ObjectStore,
} from '#src/features/platform/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { encryptSecret } from '#src/server/crypto.server.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createKycRepository, type KycRow } from '../data/kyc.repository.ts';
import {
  CONTENT_TYPE,
  maskNumber,
  normaliseBankAccount,
  normaliseNid,
  normaliseRouting,
  normaliseWallet,
  sniffImage,
  verificationStatus,
} from '../domain/kyc.ts';
import { KYC_TYPES } from '../domain/kyc-notifications.ts';
import {
  KycDecisionInput,
  KycDocumentInput,
  SavePayoutAccountInput,
  SubmitKycInput,
} from './kyc.schema.ts';

const repo = createKycRepository();
const audit = createAudit({ clock: systemClock });
let store: ObjectStore = createFileObjectStore();
/** Tests point the store at a temporary folder. */
export function setKycStoreForTests(next: ObjectStore) {
  store = next;
}

type KycError = AppError<'VALIDATION_FAILED' | 'INVALID_STATE' | 'NOT_FOUND' | 'FORBIDDEN'>;
const fieldError = (field: string, key: string): KycError =>
  appError('VALIDATION_FAILED', { fieldErrors: { [field]: [`errors.kyc.${key}`] } });
const withKey = <C extends KycError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});

const seal = (plain: string) => encryptSecret(getEnv().KYC_ENCRYPTION_KEY, plain);

export type MyKyc = {
  status: ReturnType<typeof verificationStatus>;
  kyc: {
    status: KycRow['status'];
    legalName: string;
    nidMasked: string;
    reason: string | null;
    submittedAt: string;
  } | null;
  account: {
    rail: 'bkash' | 'nagad' | 'bank';
    accountName: string;
    accountMasked: string;
    bankName: string | null;
    status: 'pending' | 'verified' | 'rejected';
    reason: string | null;
  } | null;
};

async function kycOf(userId: string): Promise<MyKyc> {
  const db = getDb();
  const [kyc, account] = await Promise.all([
    repo.latestKyc(db, userId),
    repo.currentAccount(db, userId),
  ]);
  return {
    status: verificationStatus(kyc?.status ?? null, account?.status ?? null),
    kyc: kyc
      ? {
          status: kyc.status,
          legalName: kyc.legalName,
          nidMasked: kyc.nidMasked,
          reason: kyc.reason,
          submittedAt: kyc.submittedAt.toISOString(),
        }
      : null,
    account: account
      ? {
          rail: account.rail,
          accountName: account.accountName,
          accountMasked: account.accountMasked,
          bankName: account.bankName,
          status: account.status,
          reason: account.reason,
        }
      : null,
  };
}

export async function getMyKyc(actor: Actor): Promise<Result<MyKyc, never>> {
  return ok(await kycOf(actor.userId));
}

/** One instructor's KYC and payout account, masked as the instructor sees them (an Admin's view). */
export async function kycOfInstructor(instructorId: string): Promise<Result<MyKyc, never>> {
  return ok(await kycOf(instructorId));
}

/** Contract 17: whether a person can be paid, with a masked account (for Payouts and Referrals). */
export async function getVerificationStatus(userId: string) {
  const mine = await kycOf(userId);
  return { status: mine.status, account: mine.account };
}

function photoBytes(base64: string, field: 'front' | 'back') {
  const bytes = Buffer.from(base64, 'base64');
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok) return err(fieldError(field, `photo.${sniffed.reason}`));
  return ok({ bytes, kind: sniffed.kind });
}

/**
 * US7.19: submit (or resubmit) KYC; the status becomes "submitted". US8.9 reuses it for referrers
 * (party `referrer`); Finance reviews both in the same queue.
 */
export async function submitKyc(
  actor: Actor,
  raw: SubmitKycInput,
  partyType: 'instructor' | 'referrer' = 'instructor',
): Promise<Result<{ status: 'submitted' }, KycError>> {
  const input = SubmitKycInput.parse(raw);
  const nid = normaliseNid(input.nidNumber);
  if (!nid) return err(fieldError('nidNumber', 'nid'));
  const latest = await repo.latestKyc(getDb(), actor.userId);
  if (latest?.status === 'submitted')
    return err(withKey('INVALID_STATE', 'errors.kyc.alreadySubmitted'));
  const front = photoBytes(input.front, 'front');
  if (!front.ok) return front;
  const back = photoBytes(input.back, 'back');
  if (!back.ok) return back;
  const keyOf = (side: string, kind: string) =>
    `kyc/${actor.userId}/${randomUUID()}-${side}.${kind === 'jpeg' ? 'jpg' : kind}`;
  const frontKey = keyOf('front', front.value.kind);
  const backKey = keyOf('back', back.value.kind);
  await store.put(frontKey, front.value.bytes, CONTENT_TYPE[front.value.kind]);
  await store.put(backKey, back.value.bytes, CONTENT_TYPE[back.value.kind]);
  try {
    await repo.insertKyc(getDb(), {
      userId: actor.userId,
      partyType,
      legalName: input.legalName,
      nidNumberSealed: seal(nid),
      nidMasked: maskNumber(nid),
      frontObjectKey: frontKey,
      backObjectKey: backKey,
      frontSha256: createHash('sha256').update(front.value.bytes).digest('hex'),
      backSha256: createHash('sha256').update(back.value.bytes).digest('hex'),
      status: 'submitted',
      submittedAt: new Date(),
    });
  } catch (error) {
    // Never keep photos without their record.
    await store.delete(frontKey);
    await store.delete(backKey);
    throw error;
  }
  return ok({ status: 'submitted' as const });
}

/** US7.20: register or change the payout account; it waits for Finance (payouts held). */
export async function savePayoutAccount(
  actor: Actor,
  raw: SavePayoutAccountInput,
  correlationId: string,
): Promise<Result<{ status: 'pending' }, KycError>> {
  const input = SavePayoutAccountInput.parse(raw);
  const kyc = await repo.latestKyc(getDb(), actor.userId);
  if (kyc?.status !== 'verified') return err(withKey('INVALID_STATE', 'errors.kyc.notVerified'));
  let number: string | null;
  let routing: string | null = null;
  if (input.rail === 'bank') {
    number = normaliseBankAccount(input.accountNumber);
    if (!number) return err(fieldError('accountNumber', 'bankAccount'));
    if (!input.bankName) return err(fieldError('bankName', 'bankName'));
    routing = normaliseRouting(input.routingNumber ?? '');
    if (!routing) return err(fieldError('routingNumber', 'routing'));
  } else {
    number = normaliseWallet(input.accountNumber);
    if (!number) return err(fieldError('accountNumber', 'wallet'));
  }
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const previous = await repo.currentAccount(exec, actor.userId);
    const created = await repo.replaceAccount(exec, {
      userId: actor.userId,
      rail: input.rail,
      accountName: input.accountName,
      accountSealed: seal(number),
      accountMasked: maskNumber(number),
      bankName: input.rail === 'bank' ? (input.bankName ?? null) : null,
      branchName: input.rail === 'bank' ? (input.branchName ?? null) : null,
      routingNumber: routing,
      status: 'pending',
      createdAt: now,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'kyc.payoutAccount.changed',
      subjectType: 'payout_account',
      subjectId: created.payoutAccountId,
      before: previous ? { rail: previous.rail, masked: previous.accountMasked } : null,
      after: { rail: created.rail, masked: created.accountMasked },
      correlationId,
    });
    // AC7.20.3: a change holds payouts until Finance re-verifies; the instructor is told.
    if (previous)
      await getNotifications().notify(
        tx,
        {
          recipientUserId: actor.userId,
          templateKey: KYC_TYPES.accountChanged,
          dedupeKey: `kyc-account-changed-${created.payoutAccountId}`,
          params: {},
          channels: ['in_app', 'email'],
          priority: 'high',
        },
        correlationId,
      );
    return ok({ status: 'pending' as const });
  });
}

export type KycQueueItem = {
  kind: 'kyc' | 'account';
  id: string;
  userId: string;
  displayName: string;
  submittedAt: string;
  /** KYC: legal name and masked NID. Account: rail, holder name, masked number, bank. */
  details: Record<string, string>;
};

/** A6: KYC submissions and payout accounts waiting for Finance, oldest first. */
export async function kycQueue(): Promise<Result<KycQueueItem[], never>> {
  const db = getDb();
  const [kycs, accounts] = await Promise.all([repo.kycQueue(db), repo.accountQueue(db)]);
  const names = await getIdentity().displayNamesOf([
    ...new Set([...kycs, ...accounts].map((r) => r.userId)),
  ]);
  const items: KycQueueItem[] = [
    ...kycs.map((k) => ({
      kind: 'kyc' as const,
      id: k.submissionId,
      userId: k.userId,
      displayName: names[k.userId] ?? '',
      submittedAt: k.submittedAt.toISOString(),
      details: { legalName: k.legalName, nid: k.nidMasked, party: k.partyType },
    })),
    ...accounts.map((a) => ({
      kind: 'account' as const,
      id: a.payoutAccountId,
      userId: a.userId,
      displayName: names[a.userId] ?? '',
      submittedAt: a.createdAt.toISOString(),
      details: {
        rail: a.rail,
        accountName: a.accountName,
        account: a.accountMasked,
        ...(a.bankName ? { bank: a.bankName } : {}),
        ...(a.routingNumber ? { routing: a.routingNumber } : {}),
      },
    })),
  ];
  return ok(items.sort((x, y) => x.submittedAt.localeCompare(y.submittedAt)));
}

/** US7.21: approve or reject; audit-logged and notified. Nobody decides their own. */
export async function decideKyc(
  actor: Actor,
  raw: KycDecisionInput,
  correlationId: string,
): Promise<Result<{ decided: true }, KycError>> {
  const input = KycDecisionInput.parse(raw);
  if (input.decision === 'reject' && !input.reason)
    return err(fieldError('reason', 'reasonRequired'));
  const status = input.decision === 'approve' ? ('verified' as const) : ('rejected' as const);
  const patch = { status, reason: input.reason ?? null, at: new Date(), by: actor.userId };
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const owner =
      input.kind === 'kyc'
        ? (await repo.kycById(exec, input.id))?.userId
        : (await repo.accountById(exec, input.id))?.userId;
    if (!owner) return err(withKey('NOT_FOUND', 'errors.kyc.alreadyDecided'));
    if (owner === actor.userId) return err(withKey('FORBIDDEN', 'errors.kyc.ownDecision'));
    const decided =
      input.kind === 'kyc'
        ? await repo.decideKyc(exec, input.id, patch)
        : await repo.decideAccount(exec, input.id, patch);
    if (!decided) return err(withKey('NOT_FOUND', 'errors.kyc.alreadyDecided'));
    await audit.record(tx, {
      actorId: actor.userId,
      action: input.kind === 'kyc' ? 'kyc.submission.decided' : 'kyc.payoutAccount.decided',
      subjectType: input.kind === 'kyc' ? 'kyc_submission' : 'payout_account',
      subjectId: input.id,
      after: { status },
      ...(input.reason ? { reason: input.reason } : {}),
      correlationId,
    });
    const templateKey =
      input.kind === 'kyc'
        ? status === 'verified'
          ? KYC_TYPES.kycVerified
          : KYC_TYPES.kycRejected
        : status === 'verified'
          ? KYC_TYPES.accountVerified
          : KYC_TYPES.accountRejected;
    await getNotifications().notify(
      tx,
      {
        recipientUserId: owner,
        templateKey,
        dedupeKey: `kyc-decision-${input.id}`,
        params: {},
        channels: ['in_app', 'email'],
        priority: 'high',
      },
      correlationId,
    );
    return ok({ decided: true as const });
  });
}

/**
 * A6 document view: one NID photo of a waiting submission, as a data URL, for Finance only (the
 * server function checks the role). Re-checked by its first bytes before it is sent.
 */
export async function kycDocument(
  raw: KycDocumentInput,
): Promise<Result<{ dataUrl: string }, AppError<'NOT_FOUND'>>> {
  const input = KycDocumentInput.parse(raw);
  const row = await repo.kycById(getDb(), input.submissionId);
  if (!row) return err(appError('NOT_FOUND'));
  const bytes = await store.get(input.side === 'front' ? row.frontObjectKey : row.backObjectKey);
  const sniffed = bytes ? sniffImage(bytes) : null;
  if (!bytes || !sniffed?.ok) return err(appError('NOT_FOUND'));
  return ok({ dataUrl: `data:${CONTENT_TYPE[sniffed.kind]};base64,${bytes.toString('base64')}` });
}

/**
 * US7.5: a failed payout flags the instructor for re-verification: the current payout account goes
 * back to Finance's queue with the reason, inside the caller's transaction.
 */
export async function flagForReverification(
  exec: Parameters<typeof repo.markForReverification>[0],
  userId: string,
  reason: string,
): Promise<boolean> {
  return repo.markForReverification(exec, userId, reason);
}
