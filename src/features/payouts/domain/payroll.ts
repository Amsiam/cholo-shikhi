// Monthly payroll: salary lines (US7.16, AC7.10.3). Plain TypeScript: no framework, DB or env
// access. Money is integer poisha; dates are Asia/Dhaka calendar dates (YYYY-MM-DD).
//
// The rounding rule, once: the salary line for a month is
//   floor(monthly salary × days employed in the month / days in the month)
// computed exactly with BigInt. Days employed run from the later of the 1st and the joining date to
// the earlier of the month's last day and the exit date, both included. A full month pays the
// salary exactly; the fraction of a poisha dropped by the floor is never paid (it stays with the
// platform). A month with no day employed gives no line at all (AC7.10.3).
//
// Absence without leave (US7.24) inside the paid days is counted and flagged for review; it is never
// deducted automatically (AC7.16.3). An Employee with no salary set in a month they worked is a
// refusal that names them (AC7.16.4).

export type PayrollEmployee = {
  instructorId: string;
  salaryPoisha: number | null;
  joinedOn: string | null;
  exitOn: string | null;
  absences: ReadonlyArray<{ startsOn: string; endsOn: string; isWithoutLeave: boolean }>;
};

export type SalaryLine = {
  instructorId: string;
  salary: number;
  daysPaid: number;
  daysInMonth: number;
  /** AC7.16.3: flagged for review only. */
  absenceWithoutLeaveDays: number;
};

export type PayrollRefusal = { code: 'NO_SALARY'; instructorId: string };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function daysInMonth(month: string): number {
  const m = MONTH.exec(month);
  if (!m) throw new Error('month must be YYYY-MM');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** Whole calendar days from start to end, both included; null when the end is before the start. */
function daysInclusive(startsOn: string, endsOn: string): number | null {
  if (endsOn < startsOn) return null;
  return (
    Math.round(
      (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

/** The employee's salary line for a month, null when they were not employed in it. */
export function salaryLine(
  month: string,
  e: PayrollEmployee,
): { ok: true; value: SalaryLine | null } | { ok: false; error: PayrollRefusal } {
  const total = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(total).padStart(2, '0')}`;
  const from = e.joinedOn ? max(first, e.joinedOn) : first;
  const to = e.exitOn ? min(last, e.exitOn) : last;
  const days = daysInclusive(from, to);
  if (days === null) return { ok: true, value: null };
  if (e.salaryPoisha === null)
    return { ok: false, error: { code: 'NO_SALARY', instructorId: e.instructorId } };
  if (!Number.isSafeInteger(e.salaryPoisha) || e.salaryPoisha < 0)
    throw new Error('salary must be whole, non-negative poisha');
  const salary = Number((BigInt(e.salaryPoisha) * BigInt(days)) / BigInt(total));
  // Distinct days of absence without leave inside the paid days.
  const absent = new Set<string>();
  for (const a of e.absences) {
    if (!a.isWithoutLeave) continue;
    const s = max(a.startsOn, from);
    const t = min(a.endsOn, to);
    const n = daysInclusive(s, t);
    if (n === null) continue;
    const start = Date.parse(`${s}T00:00:00Z`);
    for (let i = 0; i < n; i += 1)
      absent.add(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return {
    ok: true,
    value: {
      instructorId: e.instructorId,
      salary,
      daysPaid: days,
      daysInMonth: total,
      absenceWithoutLeaveDays: absent.size,
    },
  };
}

/** A month's payroll: the salary lines (by instructor ID) and the Employees with no salary set. */
export function payroll(
  month: string,
  employees: readonly PayrollEmployee[],
): { lines: SalaryLine[]; missingSalary: string[] } {
  const lines: SalaryLine[] = [];
  const missingSalary: string[] = [];
  for (const e of employees) {
    const r = salaryLine(month, e);
    if (!r.ok) missingSalary.push(r.error.instructorId);
    else if (r.value) lines.push(r.value);
  }
  const byId = (a: { instructorId: string }, b: { instructorId: string }) =>
    a.instructorId < b.instructorId ? -1 : a.instructorId > b.instructorId ? 1 : 0;
  return { lines: lines.sort(byId), missingSalary: missingSalary.sort() };
}

export type PayrollSource = {
  instructorId: string;
  instructorType: 'employee' | 'contractor' | null;
  policy: {
    kind: 'revenue_share' | 'salary' | 'per_piece' | 'hybrid';
    salaryPoisha: number | null;
  } | null;
  record: { salaryPoisha: number | null; joinedOn: string | null; exitOn: string | null } | null;
  absences: PayrollEmployee['absences'];
};

/**
 * Who is on a month's payroll, and on what salary (the one selection rule):
 * - every Employee instructor, and anyone whose policy in effect at the month's start is `salary`
 *   or `hybrid`;
 * - the salary is the policy's when that policy is `salary` or `hybrid` (versioned, so a past month
 *   never changes), otherwise the HR record's (US7.10); none set is a refusal (AC7.16.4);
 * - joining and exit dates come from the HR record (none: employed all month).
 */
export function toPayrollEmployees(sources: readonly PayrollSource[]): PayrollEmployee[] {
  return sources.flatMap((x) => {
    const isSalariedPolicy = x.policy?.kind === 'salary' || x.policy?.kind === 'hybrid';
    if (x.instructorType !== 'employee' && !isSalariedPolicy) return [];
    return [
      {
        instructorId: x.instructorId,
        salaryPoisha: isSalariedPolicy
          ? (x.policy?.salaryPoisha ?? null)
          : (x.record?.salaryPoisha ?? null),
        joinedOn: x.record?.joinedOn ?? null,
        exitOn: x.record?.exitOn ?? null,
        absences: x.absences,
      },
    ];
  });
}
