// Refund policy rules (US2.26, US2.27). A Student may ask within the Admin-set window after paying,
// for a first purchase whose access is still active and has not been extended by a renewal. An
// Admin decides: the full amount, the unused share of the access time, or a partial amount up to
// what was paid. Plain TypeScript, integer poisha only.

export type RefundPolicy = 'full' | 'unused' | 'partial';

export type RefundBlock =
  | 'windowUnset'
  | 'notPaid'
  | 'renewal'
  | 'renewed'
  | 'notActive'
  | 'windowClosed'
  | 'alreadyRequested';

export type RefundEligibility = {
  paymentStatus: 'pending' | 'succeeded' | 'failed';
  kind: 'purchase' | 'renewal';
  settledAt: Date | null;
  enrolmentStatus: 'active' | 'expired' | 'revoked' | 'switched' | null;
  hasRenewal: boolean;
  hasOpenOrApprovedRequest: boolean;
  windowDays: number | null;
};

/** Why a refund cannot be asked for now, or null when it can. */
export function refundBlock(e: RefundEligibility, now: Date): RefundBlock | null {
  if (e.windowDays === null) return 'windowUnset';
  if (e.paymentStatus !== 'succeeded' || !e.settledAt) return 'notPaid';
  if (e.kind === 'renewal') return 'renewal';
  if (e.hasOpenOrApprovedRequest) return 'alreadyRequested';
  if (e.enrolmentStatus !== 'active') return 'notActive';
  if (e.hasRenewal) return 'renewed';
  if (now.getTime() - e.settledAt.getTime() > e.windowDays * 86_400_000) return 'windowClosed';
  return null;
}

/** The paid amount for the access time not yet used, rounded down to the poisha. */
export function unusedDaysRefund(paid: number, startsAt: Date, endsAt: Date, now: Date): number {
  const total = endsAt.getTime() - startsAt.getTime();
  if (total <= 0) return 0;
  const left = Math.min(
    total,
    Math.max(0, endsAt.getTime() - Math.max(now.getTime(), startsAt.getTime())),
  );
  return Number((BigInt(paid) * BigInt(Math.floor(left))) / BigInt(total));
}

/** The refund for a decision, or null when the amount is not allowed (nothing, or over the paid). */
export function refundAmount(
  policy: RefundPolicy,
  paid: number,
  window: { startsAt: Date; endsAt: Date },
  now: Date,
  partial?: number,
): number | null {
  const amount =
    policy === 'full'
      ? paid
      : policy === 'unused'
        ? unusedDaysRefund(paid, window.startsAt, window.endsAt, now)
        : (partial ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > paid) return null;
  return amount;
}
