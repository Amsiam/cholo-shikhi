// Course switch rules (US2.17-US2.19, FR2.8). Plain TypeScript, integer poisha only.
// A request waits at most 24 hours for an Admin. Approving ends the old enrolment as "switched"
// and refunds either the full price or the unused share of the access time (rounded down); the
// Student then buys the requested course. A request past its deadline is expired, and acting on
// an expired or decided request is refused as stale.
import { unusedDaysRefund } from './refund.ts';

export const SWITCH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Requests with less than this left are marked as near expiry on A2. */
export const NEAR_EXPIRY_MS = 3 * 60 * 60 * 1000;
export type SwitchPolicy = 'full' | 'unused';
export type SwitchStatus = 'pending' | 'approved' | 'denied' | 'expired';

export function switchDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + SWITCH_WINDOW_MS);
}

/** The status as of now: a pending request at or past its deadline counts as expired. */
export function effectiveSwitchStatus(
  status: SwitchStatus,
  deadlineAt: Date,
  now: Date,
): SwitchStatus {
  return status === 'pending' && now.getTime() >= deadlineAt.getTime() ? 'expired' : status;
}

/** The refund for an approved switch. */
export function switchRefund(
  policy: SwitchPolicy,
  paidPoisha: number,
  access: { startsAt: Date; endsAt: Date },
  now: Date,
): number {
  return policy === 'full'
    ? paidPoisha
    : unusedDaysRefund(paidPoisha, access.startsAt, access.endsAt, now);
}

/** Whole minutes left before the request expires (0 once due). */
export function minutesLeft(deadlineAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadlineAt.getTime() - now.getTime()) / 60_000));
}
