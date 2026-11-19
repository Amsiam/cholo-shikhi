// Payout cycles, revenue share only (US7.2, US7.3, US7.5; the human's scope choice). Plain
// TypeScript: no framework, DB or env access. Money is integer poisha.
//
// For each instructor, `earned` is what the ledger's instructor_payable account gained since the
// previous committed cycle (sales minus refunds, already split by section ownership at sale time),
// and `carryIn` is what they still owed back from the last cycle. Then
//   available = earned − carryIn;  payout = max(0, available);  carryOut = max(0, −available)
// so payout − carryOut = earned − carryIn exactly (conservation), and nobody is paid a negative
// amount. A line whose instructor is not verified (KYC and payout account) is held, not dropped.
import { createHash } from 'node:crypto';

export type CycleInput = {
  /** The Asia/Dhaka month the cycle closes ("2026-11"). */
  month: string;
  instructors: ReadonlyArray<{
    instructorId: string;
    earned: number;
    carryIn: number;
    isVerified: boolean;
  }>;
};

export type LineState = 'pending' | 'held' | 'disbursed';

export type CycleLine = {
  instructorId: string;
  earned: number;
  carryIn: number;
  payout: number;
  carryOut: number;
  state: LineState;
  holdReason?: 'kyc';
};

export type Cycle = {
  lines: CycleLine[];
  totals: { earned: number; payout: number; carryIn: number; carryOut: number };
};

function assertPoisha(value: number, name: string, allowNegative: boolean) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be whole poisha`);
  if (!allowNegative && value < 0) throw new Error(`${name} must not be negative`);
}

const byInstructor = <T extends { instructorId: string }>(a: T, b: T) =>
  Number(a.instructorId > b.instructorId) - Number(a.instructorId < b.instructorId);

export function assembleCycle(input: CycleInput): Cycle {
  if (new Set(input.instructors.map((x) => x.instructorId)).size !== input.instructors.length)
    throw new Error('an instructor appears twice in one cycle');
  const lines: CycleLine[] = [];
  for (const x of [...input.instructors].sort(byInstructor)) {
    assertPoisha(x.earned, 'earned', true);
    assertPoisha(x.carryIn, 'carryIn', false);
    if (x.earned === 0 && x.carryIn === 0) continue;
    const available = x.earned - x.carryIn;
    const payout = Math.max(0, available);
    const carryOut = Math.max(0, -available);
    lines.push({
      instructorId: x.instructorId,
      earned: x.earned,
      carryIn: x.carryIn,
      payout,
      carryOut,
      ...(x.isVerified || payout === 0
        ? { state: 'pending' as const }
        : { state: 'held' as const, holdReason: 'kyc' as const }),
    });
  }
  const sum = (key: 'earned' | 'payout' | 'carryIn' | 'carryOut') =>
    lines.reduce((s, l) => s + l[key], 0);
  return {
    lines,
    totals: {
      earned: sum('earned'),
      payout: sum('payout'),
      carryIn: sum('carryIn'),
      carryOut: sum('carryOut'),
    },
  };
}

/** A hash of everything the cycle depends on; a commit is refused if it changed (dry_run_stale). */
export function cycleInputHash(input: CycleInput): string {
  const canonical = JSON.stringify({
    month: input.month,
    instructors: [...input.instructors]
      .sort(byInstructor)
      .map((x) => [x.instructorId, x.earned, x.carryIn, x.isVerified]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * A line's lifecycle: pending → disbursed (paid once) or held (failed, re-verification needed);
 * held → pending only when released after re-verification. A disbursed line never changes.
 */
export function nextLineState(
  from: LineState,
  event: 'disbursed' | 'failed' | 'release',
): LineState | null {
  if (from === 'pending' && event === 'disbursed') return 'disbursed';
  if (from === 'pending' && event === 'failed') return 'held';
  if (from === 'held' && event === 'release') return 'pending';
  return null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Asia/Dhaka is UTC+6 all year. */
const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

/** The instant a Dhaka month ends (00:00 on the 1st of the next month, Dhaka); null if malformed. */
export function cycleCutoff(month: string): Date | null {
  const m = MONTH.exec(month);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - DHAKA_OFFSET_MS);
}

/** The last `count` Dhaka months that have fully ended at `now`, newest first. */
export function endedMonths(now: Date, count: number): string[] {
  const dhaka = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(dhaka.getUTCFullYear(), dhaka.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
