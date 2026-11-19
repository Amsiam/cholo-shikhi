// Checkout rules for the development fake gateway. Plain TypeScript: no framework, DB or env access.
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';

export const COMMERCE_FLAGS = {
  /** Turns the fake gateway on outside development (e.g. in tests). Never honoured in production. */
  fakeGateway: 'commerce.fakeGateway',
} as const;

export type NodeEnv = 'development' | 'test' | 'production';

/**
 * The fake gateway exists so the purchase flow can be exercised before a real gateway is wired.
 * It is never available in production, always available in development, and elsewhere only when
 * the flag is on.
 */
export function isFakeGatewayAllowed(nodeEnv: NodeEnv, isFlagOn: boolean): boolean {
  if (nodeEnv === 'production') return false;
  return nodeEnv === 'development' || isFlagOn;
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
export type GatewayOutcome = 'succeed' | 'fail';

export type CommerceError = AppError<
  'NOT_FOUND' | 'FEATURE_DISABLED' | 'ALREADY_ENROLLED' | 'PAYMENT_SETTLED'
>;

export const alreadyEnrolled = (): CommerceError =>
  appError('ALREADY_ENROLLED', { namespace: 'commerce' });
export const paymentSettled = (): CommerceError =>
  appError('PAYMENT_SETTLED', { namespace: 'commerce' });

/**
 * Settling a payment is idempotent: repeating the outcome a payment already has is a no-op that
 * answers the same result; a pending payment takes the outcome once; a settled payment never
 * changes to the other outcome.
 */
export function decideSettlement(
  current: PaymentStatus,
  outcome: GatewayOutcome,
): Result<{ next: PaymentStatus; isNew: boolean }, CommerceError> {
  const target: PaymentStatus = outcome === 'succeed' ? 'succeeded' : 'failed';
  if (current === 'pending') return ok({ next: target, isNew: true });
  if (current === target) return ok({ next: target, isNew: false });
  return err(paymentSettled());
}

/**
 * Pending payments created before this instant are abandoned: the expiry job fails them and gives
 * their promo use back. Whole minutes, at least one.
 */
export function pendingExpiryCutoff(now: Date, expiryMinutes: number): Date {
  const minutes = Math.max(1, Math.trunc(expiryMinutes));
  return new Date(now.getTime() - minutes * 60_000);
}
