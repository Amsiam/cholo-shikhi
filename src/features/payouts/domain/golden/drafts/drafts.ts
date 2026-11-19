// DRAFT golden payout examples for the rules behind the `payouts.payrollAndAttribution` flag
// (attribution money US7.13, payroll US7.16, hybrid US7.27). AI-drafted; the expected values belong
// to the human and are NOT approved until the human approves them.
//
// This set is separate from the approved set in ../golden-cases.json, which it never changes.
// isGoldenApproved() (the approved set) does not read it. A payout cycle refuses to commit with the
// flag on until isDraftGoldenApproved() is true.
//
// How the human approves (the same mechanism as the approved set, commit 639e805): review every case
// in draft-cases.json, then edit draft-manifest.json and set "status" to "approved", "approvedBy" to
// your name and "approvedAt" to the date (and optionally an "approvalNote"). The manifest's "sha256"
// must equal the cases file's hash (the test prints a mismatch); any later change to the cases file
// needs a new approval. An AI agent never makes this edit.
import { createHash } from 'node:crypto';
import { planReassignment } from '../../attribution-money.ts';
import { assembleCycle } from '../../cycle.ts';
import { type AttributedTransaction, policyAdjustment } from '../../hybrid.ts';
import { assemblePayCycle } from '../../pay-cycle.ts';
import { type PayrollEmployee, payroll } from '../../payroll.ts';
import { manifestApproves } from '../golden.ts';
import casesFile from './draft-cases.json' with { type: 'json' };
import manifest from './draft-manifest.json' with { type: 'json' };

type CycleInstructor = {
  instructorId: string;
  earned: number;
  carryIn: number;
  isVerified: boolean;
};
type ExpectedLine = { payout: number; carryOut: number; state: string };

export type AttributionDraft = {
  id: string;
  kind: 'attribution';
  explanation: string;
  input: {
    month: string;
    sectionId: string;
    ownerId: string;
    sales: Array<{ paymentId: string; unassigned: number; sectionIds: string[] }>;
    alreadyMoved: Record<string, number>;
    instructors: CycleInstructor[];
  };
  expected: { moved: number; poolLeft: number; lines: Record<string, ExpectedLine> };
};

export type PayrollDraft = {
  id: string;
  kind: 'payroll';
  explanation: string;
  input: { month: string; employees: PayrollEmployee[]; instructors: CycleInstructor[] };
  expected: {
    salaries: Record<
      string,
      { salary: number; daysPaid: number; daysInMonth: number; absenceWithoutLeaveDays: number }
    >;
    missingSalary: string[];
    lines: Record<string, ExpectedLine>;
  };
};

export type HybridDraft = {
  id: string;
  kind: 'hybrid';
  explanation: string;
  input: {
    month: string;
    employee: PayrollEmployee;
    policy: { kind: 'hybrid' | 'salary'; shareBps: number | null };
    transactions: AttributedTransaction[];
    carryIn: number;
    isVerified: boolean;
  };
  expected: {
    salary: number;
    attributed: number;
    share: number;
    credited: number;
    adjustment: number;
    lines: Record<string, ExpectedLine>;
  };
};

export type DraftCase = AttributionDraft | PayrollDraft | HybridDraft;

type Manifest = Parameters<typeof manifestApproves>[0];

/** The SHA-256 of the draft cases exactly as committed (canonical JSON). */
export function draftCasesHash(): string {
  return createHash('sha256').update(JSON.stringify(casesFile)).digest('hex');
}

export function draftManifest() {
  return manifest;
}

/** True only when the human approved this exact draft set. */
export function isDraftGoldenApproved(): boolean {
  return manifestApproves(manifest as Manifest, draftCasesHash());
}

export function draftCases(): DraftCase[] {
  return casesFile.cases as unknown as DraftCase[];
}

const linesOf = (month: string, instructors: CycleInstructor[]) =>
  Object.fromEntries(
    assembleCycle({ month, instructors }).lines.map((l) => [
      l.instructorId,
      { payout: l.payout, carryOut: l.carryOut, state: l.state },
    ]),
  );

function runAttribution(c: AttributionDraft) {
  const { input } = c;
  const plan = planReassignment(
    input.sales.map((s) => ({
      paymentId: s.paymentId,
      netUnassigned: s.unassigned,
      sectionIds: s.sectionIds,
    })),
    input.sectionId,
    new Map(Object.entries(input.alreadyMoved)),
  );
  const pool = input.sales.reduce((s, x) => s + x.unassigned, 0);
  const already = Object.values(input.alreadyMoved).reduce((s, x) => s + x, 0);
  const instructors = input.instructors.map((x) =>
    x.instructorId === input.ownerId ? { ...x, earned: x.earned + plan.total } : x,
  );
  return {
    moved: plan.total,
    poolLeft: pool - already - plan.total,
    lines: linesOf(input.month, instructors),
  };
}

function runPayroll(c: PayrollDraft) {
  const { input } = c;
  const run = payroll(input.month, input.employees);
  const salaryOf = new Map(run.lines.map((l) => [l.instructorId, l.salary]));
  // A refused payroll commits nothing, so no line is expected.
  const cycle =
    run.missingSalary.length > 0
      ? { lines: [] }
      : assemblePayCycle({
          month: input.month,
          instructors: input.instructors.map((x) => ({
            ...x,
            salary: salaryOf.get(x.instructorId) ?? 0,
          })),
        });
  return {
    salaries: Object.fromEntries(
      run.lines.map(({ instructorId, ...rest }) => [instructorId, rest]),
    ),
    missingSalary: run.missingSalary,
    lines: Object.fromEntries(
      cycle.lines.map((l) => [
        l.instructorId,
        { payout: l.payout, carryOut: l.carryOut, state: l.state },
      ]),
    ),
  };
}

function runHybrid(c: HybridDraft) {
  const { input } = c;
  const id = input.employee.instructorId;
  const salary = payroll(input.month, [input.employee]).lines[0]?.salary ?? 0;
  const adj = policyAdjustment(input.policy, input.transactions);
  const cycle = assemblePayCycle({
    month: input.month,
    instructors: [
      {
        instructorId: id,
        earned: adj.credited,
        salary,
        adjustment: adj.adjustment,
        carryIn: input.carryIn,
        isVerified: input.isVerified,
      },
    ],
  });
  return {
    salary,
    attributed: adj.attributed,
    share: adj.share,
    credited: adj.credited,
    adjustment: adj.adjustment,
    lines: Object.fromEntries(
      cycle.lines.map((l) => [
        l.instructorId,
        { payout: l.payout, carryOut: l.carryOut, state: l.state },
      ]),
    ),
  };
}

/** Runs one draft case with the code under the flag; the result is compared with `expected`. */
export function runDraftCase(c: DraftCase) {
  const actual =
    c.kind === 'attribution'
      ? runAttribution(c)
      : c.kind === 'payroll'
        ? runPayroll(c)
        : runHybrid(c);
  return { actual, expected: c.expected };
}
