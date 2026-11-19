// HR records (US7.1, US7.10, US7.24). Plain TypeScript. Records only: nothing here computes a pay
// or payroll amount; U9 Payouts computes salary lines from them (payouts/domain/payroll.ts).
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { dhakaDateParts } from '#src/lib/time.ts';

export type PolicyKind = 'revenue_share' | 'salary' | 'per_piece' | 'hybrid';
export type HrError = AppError<'VALIDATION_FAILED' | 'INVALID_STATE'>;

const refused = (i18nKey: `errors.hr.${string}`, field?: string): HrError => ({
  ...appError('VALIDATION_FAILED'),
  i18nKey,
  ...(field ? { fieldErrors: { [field]: [i18nKey] } } : {}),
});

const isPoisha = (v: number | undefined | null): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isBps = (v: number | undefined | null): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000;

export type PolicyComponents = {
  kind: PolicyKind;
  shareBps: number | null;
  salaryPoisha: number | null;
  perPiecePoisha: number | null;
};

/** AC7.1.2 / AC7.1.4: each kind stores exactly its components, all whole and in range. */
export function validatePolicy(input: {
  kind: PolicyKind;
  shareBps?: number | null;
  salaryPoisha?: number | null;
  perPiecePoisha?: number | null;
}): Result<PolicyComponents, HrError> {
  const needsShare = input.kind === 'revenue_share' || input.kind === 'hybrid';
  const needsSalary = input.kind === 'salary' || input.kind === 'hybrid';
  const needsPiece = input.kind === 'per_piece';
  if (needsShare && !isBps(input.shareBps)) return err(refused('errors.hr.share', 'shareBps'));
  if (needsSalary && !isPoisha(input.salaryPoisha))
    return err(refused('errors.hr.amount', 'salaryPoisha'));
  if (needsPiece && !isPoisha(input.perPiecePoisha))
    return err(refused('errors.hr.amount', 'perPiecePoisha'));
  return ok({
    kind: input.kind,
    shareBps: needsShare ? (input.shareBps as number) : null,
    salaryPoisha: needsSalary ? (input.salaryPoisha as number) : null,
    perPiecePoisha: needsPiece ? (input.perPiecePoisha as number) : null,
  });
}

/** AC7.1.1: 00:00 Asia/Dhaka on the 1st of the month after the one this instant falls in. */
export function nextCycleStart(at: Date): Date {
  const { year, month } = dhakaDateParts(at.toISOString());
  // Date.UTC(year, month, 1) is the 1st of the next month (month is 1-based); Dhaka is UTC+6.
  return new Date(Date.UTC(year, month, 1) - 6 * 60 * 60 * 1000);
}

/** AC7.1.3: the latest version already in effect at this instant, or null. */
export function policyInEffect<T extends { version: number; effectiveFrom: Date }>(
  versions: readonly T[],
  at: Date,
): T | null {
  return (
    [...versions]
      .filter((v) => v.effectiveFrom.getTime() <= at.getTime())
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/** US7.10: an exit is not before joining; a salary is whole, non-negative poisha. */
export function validateEmployeeRecord(input: {
  salaryPoisha?: number | null;
  joinedOn?: string | null;
  exitOn?: string | null;
}): Result<void, HrError> {
  if (input.salaryPoisha != null && !isPoisha(input.salaryPoisha))
    return err(refused('errors.hr.amount', 'salaryPoisha'));
  if (input.joinedOn && input.exitOn && input.exitOn < input.joinedOn)
    return err(refused('errors.hr.exitBeforeJoin', 'exitOn'));
  return ok(undefined);
}

/** Whole calendar days from start to end, both included; null when the end is before the start. */
export function daysInclusive(startsOn: string, endsOn: string): number | null {
  if (endsOn < startsOn) return null;
  const ms = Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * AC7.24.1 / AC7.24.2: leave comes out of the balance (refused beyond it); an absence comes out of
 * the balance when it covers it, and otherwise is marked "absence without leave" and takes nothing.
 */
export function applyLeave(
  balance: number,
  kind: 'leave' | 'absence',
  days: number,
): Result<{ balance: number; isWithoutLeave: boolean }, HrError> {
  if (days <= balance) return ok({ balance: balance - days, isWithoutLeave: false });
  if (kind === 'leave') return err({ ...refused('errors.hr.balance'), code: 'INVALID_STATE' });
  return ok({ balance, isWithoutLeave: true });
}
