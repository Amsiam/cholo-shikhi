// A payout cycle with every pay component (US7.2 under the payouts.payrollAndAttribution flag).
// Plain TypeScript. Builds on ./cycle.ts, which stays the single place the carry rule lives:
//   available = earned + salary + adjustment − carryIn
//   payout = max(0, available);  carryOut = max(0, −available)
// so payout − carryOut = earned + salary + adjustment − carryIn for every line (conservation), and
// nobody is paid a negative amount.
// - `earned`: the ledger's revenue share (and attribution money) for the cycle;
// - `salary`: the month's salary line (./payroll.ts), 0 for anyone not on payroll;
// - `adjustment`: a hybrid or salary policy's share less the ledger's credit (./hybrid.ts), signed,
//   0 for every other policy.
//
// With every salary and adjustment 0 the result and the input hash are exactly those of
// ./cycle.ts, so the approved golden examples and every cycle committed before the flag are
// unaffected.
import { assembleCycle, type CycleInput, type CycleLine, cycleInputHash } from './cycle.ts';

export type PayCycleInput = {
  month: string;
  instructors: ReadonlyArray<
    CycleInput['instructors'][number] & { salary: number; adjustment?: number }
  >;
};

export type PayLine = CycleLine & { salary: number; adjustment: number };

export type PayCycle = {
  lines: PayLine[];
  totals: {
    earned: number;
    salary: number;
    adjustment: number;
    payout: number;
    carryIn: number;
    carryOut: number;
  };
};

export function assemblePayCycle(input: PayCycleInput): PayCycle {
  for (const x of input.instructors) {
    if (!Number.isSafeInteger(x.salary) || x.salary < 0)
      throw new Error('salary must be whole, non-negative poisha');
    if (!Number.isSafeInteger(x.adjustment ?? 0))
      throw new Error('adjustment must be whole poisha');
  }
  const parts = new Map(
    input.instructors.map((x) => [
      x.instructorId,
      { salary: x.salary, adjustment: x.adjustment ?? 0 },
    ]),
  );
  const cycle = assembleCycle({
    month: input.month,
    instructors: input.instructors.map((x) => ({
      instructorId: x.instructorId,
      earned: x.earned + x.salary + (x.adjustment ?? 0),
      carryIn: x.carryIn,
      isVerified: x.isVerified,
    })),
  });
  const lines = cycle.lines.map((l) => {
    const { salary, adjustment } = parts.get(l.instructorId) ?? { salary: 0, adjustment: 0 };
    return { ...l, earned: l.earned - salary - adjustment, salary, adjustment };
  });
  const sum = (key: 'earned' | 'salary' | 'adjustment') => lines.reduce((s, l) => s + l[key], 0);
  return {
    lines,
    totals: {
      ...cycle.totals,
      earned: sum('earned'),
      salary: sum('salary'),
      adjustment: sum('adjustment'),
    },
  };
}

/** The input hash; identical to cycleInputHash when no instructor has a salary or adjustment. */
export function payCycleInputHash(input: PayCycleInput): string {
  const base = cycleInputHash(input);
  const extra = input.instructors.filter((x) => x.salary !== 0 || (x.adjustment ?? 0) !== 0);
  if (extra.length === 0) return base;
  const parts = extra
    .map((x) =>
      (x.adjustment ?? 0) === 0
        ? `${x.instructorId}:${x.salary}`
        : `${x.instructorId}:${x.salary}:${x.adjustment}`,
    )
    .sort()
    .join(',');
  return cycleInputHash({
    month: input.month,
    instructors: [
      { instructorId: `~pay:${base}:${parts}`, earned: 0, carryIn: 0, isVerified: true },
    ],
  });
}
