// Refunds (US2.26 request, US2.27 decide). A Student asks within the Admin-set window with a
// reason; an Admin approves (full, unused share, or a partial amount) or rejects with a note. An
// approval revokes the enrolment and posts the refund to the ledger in the same transaction, so
// instructors' shares come back in proportion. The fake gateway moves no money.
import { courseTitlesOf } from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { recordCourseRefund } from '#src/features/ledger/index.ts';
import { settings } from '#src/features/platform/index.ts';
import { clawbackReferral } from '#src/features/referrals/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createRefundRepository, type RefundRow } from '../data/refund.repository.ts';
import { COMMERCE_SETTINGS, DEFAULT_PENDING_EXPIRY_MINUTES } from '../domain/commerce-settings.ts';
import { type RefundBlock, refundAmount, refundBlock, unusedDaysRefund } from '../domain/refund.ts';
import { DecideRefundInput, RefundQueueInput, RequestRefundInput } from './commerce.schema.ts';

const repo = createRefundRepository();
type RefundError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'VALIDATION_FAILED' | 'CONFLICT'>;

async function windowDays(): Promise<number | null> {
  const r = await settings().get(COMMERCE_SETTINGS.refundWindowDays);
  return r.ok ? r.value.value : null;
}

/** How long an unpaid checkout stays open (Admin setting with a default). */
export async function pendingExpiryMinutes(): Promise<number> {
  const r = await settings().get(COMMERCE_SETTINGS.pendingPaymentExpiryMinutes);
  return r.ok ? r.value.value : DEFAULT_PENDING_EXPIRY_MINUTES;
}

export type RefundState = {
  /** The latest request on this payment, if any. */
  request: {
    refundId: string;
    status: RefundRow['status'];
    requestedAt: string;
    refundPoisha: number | null;
    decisionNote: string | null;
  } | null;
  /** Why the Student cannot ask now, or null when they can. */
  block: RefundBlock | null;
  windowEndsAt: string | null;
};

/** Refund state of the caller's payments, for the purchase history. */
export async function refundStatesOf(
  userId: string,
  purchases: ReadonlyArray<{
    paymentId: string;
    status: 'pending' | 'succeeded' | 'failed';
    kind: 'purchase' | 'renewal';
    settledAt: Date | null;
    enrolmentId: string | null;
    enrolmentStatus: 'active' | 'expired' | 'revoked' | 'switched' | null;
  }>,
): Promise<Map<string, RefundState>> {
  const db = getDb();
  const [days, requests, renewed] = await Promise.all([
    windowDays(),
    repo.requestsForPayments(
      db,
      purchases.map((p) => p.paymentId),
    ),
    repo.renewedEnrolments(
      db,
      purchases.flatMap((p) => (p.enrolmentId ? [p.enrolmentId] : [])),
    ),
  ]);
  const now = new Date();
  return new Map(
    purchases.map((p) => {
      const mine = requests.filter((r) => r.paymentId === p.paymentId && r.userId === userId);
      const latest = mine[0] ?? null;
      return [
        p.paymentId,
        {
          request: latest
            ? {
                refundId: latest.refundId,
                status: latest.status,
                requestedAt: latest.requestedAt.toISOString(),
                refundPoisha: latest.refundPoisha,
                decisionNote: latest.decisionNote,
              }
            : null,
          block: refundBlock(
            {
              paymentStatus: p.status,
              kind: p.kind,
              settledAt: p.settledAt,
              enrolmentStatus: p.enrolmentStatus,
              hasRenewal: p.enrolmentId ? renewed.has(p.enrolmentId) : false,
              hasOpenOrApprovedRequest: mine.some((r) => r.status !== 'rejected'),
              windowDays: days,
            },
            now,
          ),
          windowEndsAt:
            days && p.settledAt
              ? new Date(p.settledAt.getTime() + days * 86_400_000).toISOString()
              : null,
        },
      ];
    }),
  );
}

export async function requestRefund(
  actor: Actor,
  raw: RequestRefundInput,
): Promise<Result<{ refundId: string }, RefundError>> {
  const input = RequestRefundInput.parse(raw);
  const db = getDb();
  const ctx = await repo.paymentContext(db, input.paymentId);
  if (!ctx || ctx.payment.userId !== actor.userId) return err(appError('NOT_FOUND'));
  const block = refundBlock(
    {
      paymentStatus: ctx.payment.status,
      kind: ctx.payment.kind,
      settledAt: ctx.payment.settledAt,
      enrolmentStatus: ctx.enrolment?.status ?? null,
      hasRenewal: ctx.renewals > 0,
      hasOpenOrApprovedRequest: ctx.requests.some((r) => r.status !== 'rejected'),
      windowDays: await windowDays(),
    },
    new Date(),
  );
  if (block) return err({ ...appError('INVALID_STATE'), i18nKey: `errors.refund.${block}` });
  try {
    const row = await repo.insert(db, {
      paymentId: input.paymentId,
      userId: actor.userId,
      reason: input.reason,
    });
    return ok({ refundId: row.refundId });
  } catch (e) {
    // Only the partial unique index (another request on this payment landed first) is expected.
    if ((e as { code?: string }).code !== '23505') throw e;
    return err({ ...appError('CONFLICT'), i18nKey: 'errors.refund.alreadyRequested' });
  }
}

export type RefundQueueRow = {
  refundId: string;
  status: RefundRow['status'];
  studentName: string;
  courseId: string;
  titleBn: string;
  titleEn: string;
  paidPoisha: number;
  paidAt: string | null;
  requestedAt: string;
  reason: string;
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  /** What each policy would pay back now. */
  options: { full: number; unused: number };
  policy: RefundRow['policy'];
  refundPoisha: number | null;
  decisionNote: string | null;
  decidedAt: string | null;
};

const QUEUE_PAGE = 20;

export async function refundQueue(raw: RefundQueueInput): Promise<
  Result<
    {
      rows: RefundQueueRow[];
      total: number;
      page: number;
      pageCount: number;
      windowDays: number | null;
      pendingExpiryMinutes: number;
    },
    never
  >
> {
  const input = RefundQueueInput.parse(raw);
  const db = getDb();
  const { rows, total } = await repo.queue(
    db,
    input.status ?? null,
    QUEUE_PAGE,
    (input.page - 1) * QUEUE_PAGE,
  );
  const [titles, names, days, expiryMinutes] = await Promise.all([
    courseTitlesOf([...new Set(rows.map((r) => r.payment.courseId))]),
    getIdentity().displayNamesOf([...new Set(rows.map((r) => r.request.userId))]),
    windowDays(),
    pendingExpiryMinutes(),
  ]);
  const now = new Date();
  return ok({
    rows: rows.map(({ request: q, payment: p, enrolment: e }) => ({
      refundId: q.refundId,
      status: q.status,
      studentName: names[q.userId] ?? '',
      courseId: p.courseId,
      titleBn: titles[p.courseId]?.titleBn ?? '',
      titleEn: titles[p.courseId]?.titleEn ?? '',
      paidPoisha: p.amountPoisha,
      paidAt: p.settledAt?.toISOString() ?? null,
      requestedAt: q.requestedAt.toISOString(),
      reason: q.reason,
      accessStartsAt: e?.startsAt.toISOString() ?? null,
      accessEndsAt: e?.endsAt.toISOString() ?? null,
      options: {
        full: p.amountPoisha,
        unused: e ? unusedDaysRefund(p.amountPoisha, e.startsAt, e.endsAt, now) : 0,
      },
      policy: q.policy,
      refundPoisha: q.refundPoisha,
      decisionNote: q.decisionNote,
      decidedAt: q.decidedAt?.toISOString() ?? null,
    })),
    total,
    page: input.page,
    pageCount: Math.max(1, Math.ceil(total / QUEUE_PAGE)),
    windowDays: days,
    pendingExpiryMinutes: expiryMinutes,
  });
}

export async function decideRefund(
  actor: Actor,
  raw: DecideRefundInput,
): Promise<
  Result<
    { refundId: string; status: RefundRow['status']; refundPoisha: number | null },
    RefundError
  >
> {
  const input = DecideRefundInput.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const request = await repo.forUpdate(exec, input.refundId);
    if (!request) return err(appError('NOT_FOUND'));
    if (request.status !== 'pending')
      return err({ ...appError('INVALID_STATE'), i18nKey: 'errors.refund.decided' });
    if (input.decision === 'reject') {
      if (!input.note?.trim())
        return err(
          appError('VALIDATION_FAILED', { fieldErrors: { note: ['errors.refund.noteRequired'] } }),
        );
      const row = await repo.decide(exec, request.refundId, {
        status: 'rejected',
        decisionNote: input.note.trim(),
        decidedBy: actor.userId,
        decidedAt: now,
      });
      return ok({ refundId: row.refundId, status: row.status, refundPoisha: null });
    }
    const ctx = await repo.paymentContext(exec, request.paymentId);
    if (!ctx?.enrolment) return err(appError('NOT_FOUND'));
    const policy = input.policy ?? 'full';
    const amount = refundAmount(
      policy,
      ctx.payment.amountPoisha,
      { startsAt: ctx.enrolment.startsAt, endsAt: ctx.enrolment.endsAt },
      now,
      input.partialPoisha,
    );
    if (amount === null)
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: { partialPoisha: ['errors.refund.amountInvalid'] },
        }),
      );
    await repo.revokeEnrolment(exec, ctx.enrolment.enrolmentId);
    const posted = await recordCourseRefund(tx, {
      paymentId: request.paymentId,
      amountPoisha: amount,
      occurredAt: now,
    });
    // Without a sale in the ledger (a sale from before the ledger) the refund cannot be balanced.
    if (!posted.ok) throw new Error(`refund could not be posted: ${posted.error.code}`);
    // AC8.7.2: a referrer's share of this payment comes back in proportion to the refund.
    await clawbackReferral(tx, {
      paymentId: request.paymentId,
      paidPoisha: ctx.payment.amountPoisha,
      refundedPoisha: amount,
      occurredAt: now,
    });
    const row = await repo.decide(exec, request.refundId, {
      status: 'approved',
      policy,
      refundPoisha: amount,
      decisionNote: input.note?.trim() || null,
      decidedBy: actor.userId,
      decidedAt: now,
    });
    return ok({ refundId: row.refundId, status: row.status, refundPoisha: amount });
  });
}
