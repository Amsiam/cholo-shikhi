// Receipt numbers, and the access window rule re-exported from src/lib/access-window.ts.

import { accessState } from '#src/lib/access-window.ts';

export { type AccessState, accessState, EXPIRY_WARNING_DAYS } from '#src/lib/access-window.ts';

/** A short, stable receipt number for a payment: CS-YYMMDD-XXXXXXXX (date in Asia/Dhaka). */
export function receiptNumber(paymentId: string, createdAt: Date): string {
  const dhaka = new Date(createdAt.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const ymd = `${dhaka.slice(2, 4)}${dhaka.slice(5, 7)}${dhaka.slice(8, 10)}`;
  return `CS-${ymd}-${paymentId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

/** A course can be renewed in the last 14 days of its access (the window the warning shows in). */
export function canRenew(endsAt: Date, now: Date): boolean {
  return accessState(endsAt, now).isExpiringSoon;
}

/**
 * The new end date of a renewal: the current end plus the bought months, in UTC, clamped to the
 * last day of the target month (31 January + 1 month = 28 or 29 February, never 3 March).
 */
export function extendEnd(endsAt: Date, months: number): Date {
  const d = new Date(endsAt.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
