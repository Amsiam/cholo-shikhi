// Course access windows (PRD FR-DIST-4: expiry must never come as a shock). Plain TypeScript,
// shared by Commerce (receipts) and Learning (course cards). Access is "expiring soon" in its last
// 14 days, so the Student is warned in time.

export const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessState = {
  /** Whole days left, rounded up (an access that ends later today has 1 day left); 0 once ended. */
  daysLeft: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
};

export function accessState(endsAt: Date, now: Date): AccessState {
  const ms = endsAt.getTime() - now.getTime();
  const isExpired = ms <= 0;
  const daysLeft = isExpired ? 0 : Math.ceil(ms / DAY_MS);
  return { daysLeft, isExpired, isExpiringSoon: !isExpired && daysLeft <= EXPIRY_WARNING_DAYS };
}
