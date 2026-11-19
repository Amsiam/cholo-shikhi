// Payout cycles (U9; US7.2–US7.5, US7.8 per cycle, US7.9). Screen A1 for Finance, and the
// instructor's earnings page. Revenue share from the ledger; with the payouts.payrollAndAttribution
// flag on, also the month's salary lines (US7.16) from the HR records and the hybrid or salary
// policy share in place of the default credit (US7.27). With that flag on, a cycle
// commits only once the human approved the draft golden examples of those rules.
// - Dry run: for a fully ended Dhaka month, each instructor's earned amount is what the ledger's
//   instructor_payable gained since the previous committed cycle's cut-off; the previous cycle's
//   carry-outs come in. Nothing is saved; the screen keeps the input hash.
// - Commit (Finance or Admin): recomputes, refuses if the input hash changed (dry_run_stale), then
//   locks the snapshot and writes one audit entry per line. Months commit in order, once.
// - Paying is recorded by the Admin with two-step sign-in (the human's in-product approval), and
//   only once the human has approved the golden payout examples. A retry with the same key never
//   pays twice. A failure holds the line and flags the instructor for re-verification; a held line
//   is released (after re-verification) and then paid once, under its original cycle.

import { createHash } from 'node:crypto';
import { courseTitlesOf, getOwnershipSnapshot } from '#src/features/catalog/index.ts';
import { payrollRecords } from '#src/features/hr/index.ts';
import { type Actor, getIdentity } from '#src/features/identity-access/index.ts';
import { flagForReverification, getVerificationStatus } from '#src/features/kyc/index.ts';
import {
  instructorCycleLines,
  instructorSalesInCycle,
  payableForCycle,
  recordInstructorPayout,
  recordPolicyAdjustment,
  recordSalaryAccrual,
} from '#src/features/ledger/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import {
  createAudit,
  createFileObjectStore,
  createRenderer,
  defineCsvTemplate,
  type ObjectStore,
  settings,
} from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import type { Executor } from '#src/server/db.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createPayoutsRepository, type LineRow } from '../data/payouts.repository.ts';
import { cycleCutoff, endedMonths, nextLineState } from '../domain/cycle.ts';
import { isGoldenApproved } from '../domain/golden/golden.ts';
import { type AttributedTransaction, policyAdjustment } from '../domain/hybrid.ts';
import { assemblePayCycle, type PayCycleInput, payCycleInputHash } from '../domain/pay-cycle.ts';
import { PAYOUT_TYPES } from '../domain/payout-notifications.ts';
import { PAYOUT_SETTINGS } from '../domain/payout-settings.ts';
import { daysInMonth, payroll, toPayrollEmployees } from '../domain/payroll.ts';
import { openAttributionFlags } from './attribution.server.ts';
import { type NewRulesState, newRulesState } from './new-rules.server.ts';
import {
  CommitCycleInput,
  CycleMonthInput,
  LineRefInput,
  RecordFailureInput,
  RecordPaymentInput,
} from './payouts.schema.ts';

const repo = createPayoutsRepository();
const audit = createAudit({ clock: systemClock });

type PayoutError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'CONFLICT'>;
const withKey = <C extends PayoutError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});

let goldenGate: () => boolean = isGoldenApproved;
let now: () => Date = () => new Date();
/** Tests move time forward so a month has ended. */
export function setPayoutClockForTests(clock: () => Date) {
  now = clock;
}
/** Tests stand in for the human's golden-set approval. */
export function setGoldenGateForTests(gate: () => boolean) {
  goldenGate = gate;
}

type PayrollView = {
  /** AC7.16.3: days of absence without leave per salaried instructor (flagged, not deducted). */
  absence: Map<string, number>;
  /** AC7.16.4: Employees with no salary set; the cycle cannot be committed while any is listed. */
  missingSalary: string[];
};

/**
 * US7.16: the month's salary lines from the HR records (only with the new rules switched on).
 * The month starts at 00:00 Asia/Dhaka on the 1st; the policy in effect then applies (AC7.1.3).
 */
async function payrollOf(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const records = await payrollRecords({
    start: new Date(Date.UTC(y, m - 1, 1) - 6 * 3600 * 1000),
    firstDay: `${month}-01`,
    lastDay: `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
  });
  // US7.27: hybrid and salary policies replace the ledger's default share for the cycle.
  const policies = new Map(
    records.flatMap((r) =>
      r.policy && (r.policy.kind === 'hybrid' || r.policy.kind === 'salary')
        ? [[r.instructorId, { kind: r.policy.kind, shareBps: r.policy.shareBps }] as const]
        : [],
    ),
  );
  return { ...payroll(month, toPayrollEmployees(records)), policies };
}

/**
 * US7.27: a hybrid or salary policy's adjustment for the cycle: the instructor's sales and refunds
 * in the cycle window, attributed by their sections at the moment of each sale.
 */
async function adjustmentOf(
  instructorId: string,
  policy: { kind: 'hybrid' | 'salary'; shareBps: number | null },
  periodEnd: Date,
  previous: { cutoff: Date; committedAt: Date } | null,
): Promise<number> {
  const txs = await instructorSalesInCycle(instructorId, periodEnd, previous);
  const attributed: AttributedTransaction[] = [];
  for (const t of txs) {
    const snapshot = await getOwnershipSnapshot(t.courseId, t.saleAt.toISOString());
    const owned = snapshot.ok ? snapshot.value.sections : [];
    attributed.push({
      amount: t.amount,
      kind: t.kind,
      sections: owned.filter((x) => x.instructorId === instructorId).length,
      totalSections: owned.length,
      credited: t.credited,
    });
  }
  return policyAdjustment(policy, attributed).adjustment;
}

/** The inputs of a month's cycle, or why it cannot run yet. */
async function cycleInputs(
  exec: Executor,
  month: string,
  now: Date,
  rules: NewRulesState,
): Promise<Result<{ input: PayCycleInput; periodEnd: Date; payroll: PayrollView }, PayoutError>> {
  const periodEnd = cycleCutoff(month);
  if (!periodEnd) return err(withKey('NOT_FOUND', 'errors.payouts.badMonth'));
  if (now < periodEnd) return err(withKey('INVALID_STATE', 'errors.payouts.cycleOpen'));
  if (await repo.cycleByMonth(exec, month))
    return err(withKey('CONFLICT', 'errors.payouts.alreadyCommitted'));
  const latest = await repo.latestCycle(exec);
  if (latest && latest.month > month)
    return err(withKey('INVALID_STATE', 'errors.payouts.outOfOrder'));
  const previous = await repo.previousCycle(exec, month);
  const window = previous
    ? { cutoff: previous.periodEnd, committedAt: previous.committedAt }
    : null;
  const [earned, previousLines] = await Promise.all([
    payableForCycle(periodEnd, window),
    previous ? repo.linesOf(exec, previous.cycleId) : Promise.resolve([]),
  ]);
  const carry = new Map(previousLines.map((l) => [l.instructorId, l.carryOut]));
  const run = rules.isOn
    ? await payrollOf(month)
    : { lines: [], missingSalary: [], policies: new Map() };
  const salary = new Map(run.lines.map((l) => [l.instructorId, l.salary]));
  const adjustment = new Map<string, number>();
  for (const [id, policy] of run.policies) {
    const a = await adjustmentOf(id, policy, periodEnd, window);
    if (a !== 0) adjustment.set(id, a);
  }
  const ids = [
    ...new Set([
      ...earned.map((e) => e.instructorId),
      ...carry.keys(),
      ...salary.keys(),
      ...adjustment.keys(),
    ]),
  ];
  const earnedOf = new Map(earned.map((e) => [e.instructorId, e.earned]));
  const verified = await Promise.all(
    ids.map(async (id) => (await getVerificationStatus(id)).status === 'verified'),
  );
  return ok({
    periodEnd,
    input: {
      month,
      instructors: ids.map((instructorId, i) => ({
        instructorId,
        earned: earnedOf.get(instructorId) ?? 0,
        salary: salary.get(instructorId) ?? 0,
        adjustment: adjustment.get(instructorId) ?? 0,
        carryIn: carry.get(instructorId) ?? 0,
        isVerified: verified[i] ?? false,
      })),
    },
    payroll: {
      absence: new Map(
        run.lines
          .filter((l) => l.absenceWithoutLeaveDays > 0)
          .map((l) => [l.instructorId, l.absenceWithoutLeaveDays]),
      ),
      missingSalary: run.missingSalary,
    },
  });
}

export type DryRun = {
  month: string;
  inputHash: string;
  totals: {
    earned: number;
    salary: number;
    adjustment: number;
    payout: number;
    carryIn: number;
    carryOut: number;
  };
  lines: Array<{
    instructorId: string;
    name: string;
    earned: number;
    /** US7.27: a hybrid or salary policy's share less the ledger's credit (signed). */
    adjustment: number;
    /** US7.16: the salary line (0 when not on payroll or with the new rules off). */
    salary: number;
    /** AC7.16.3: days of absence without leave, flagged for review (never deducted). */
    absenceWithoutLeaveDays: number;
    carryIn: number;
    payout: number;
    carryOut: number;
    state: 'pending' | 'held';
    /** AC7.13.2: an open attribution case names this instructor (amounts are unchanged). */
    isAttributionDisputed: boolean;
  }>;
  /** AC7.13.2: unresolved attribution cases, flagged on A1. */
  openAttributionCases: number;
  /** AC7.16.4: Employees with no salary set, named; commit is refused while any is listed. */
  missingSalary: Array<{ instructorId: string; name: string }>;
  isGoldenApproved: boolean;
  /** The payouts.payrollAndAttribution flag and the draft golden set's approval. */
  rules: NewRulesState;
};

/** US7.2: the cycle as it would be committed now; nothing is saved. */
export async function dryRunCycle(raw: CycleMonthInput): Promise<Result<DryRun, PayoutError>> {
  const input = CycleMonthInput.parse(raw);
  const rules = await newRulesState();
  const built = await cycleInputs(getDb(), input.month, now(), rules);
  if (!built.ok) return built;
  const cycle = assemblePayCycle(built.value.input);
  const { absence, missingSalary } = built.value.payroll;
  const names = await getIdentity().displayNamesOf([
    ...cycle.lines.map((l) => l.instructorId),
    ...missingSalary,
  ]);
  const flags = await openAttributionFlags();
  return ok({
    month: input.month,
    inputHash: payCycleInputHash(built.value.input),
    totals: cycle.totals,
    lines: cycle.lines.map((l) => ({
      instructorId: l.instructorId,
      name: names[l.instructorId] ?? '',
      earned: l.earned,
      adjustment: l.adjustment,
      salary: l.salary,
      absenceWithoutLeaveDays: absence.get(l.instructorId) ?? 0,
      carryIn: l.carryIn,
      payout: l.payout,
      carryOut: l.carryOut,
      state: l.state === 'held' ? ('held' as const) : ('pending' as const),
      isAttributionDisputed: flags.instructorIds.has(l.instructorId),
    })),
    openAttributionCases: flags.openCases,
    missingSalary: missingSalary.map((id) => ({ instructorId: id, name: names[id] ?? '' })),
    isGoldenApproved: goldenGate(),
    rules,
  });
}

const notifyLine = (
  tx: TxHandle,
  line: { lineId: string; instructorId: string },
  templateKey: string,
  correlationId: string,
) =>
  getNotifications().notify(
    tx,
    {
      recipientUserId: line.instructorId,
      templateKey,
      dedupeKey: `${templateKey}-${line.lineId}-${Date.now()}`,
      params: {},
      channels: ['in_app', 'email'],
      priority: 'high',
    },
    correlationId,
  );

/** US7.3: locks the snapshot, refusing a stale dry run; one audit entry per line. */
export async function commitCycle(
  actor: Actor,
  raw: CommitCycleInput,
  correlationId: string,
): Promise<Result<{ cycleId: string; lines: number }, PayoutError>> {
  const input = CommitCycleInput.parse(raw);
  const at = now();
  // With the new rules switched on, nothing commits until the human approves their draft golden set.
  const rules = await newRulesState();
  if (rules.isOn && !rules.isApproved)
    return err(withKey('INVALID_STATE', 'errors.payouts.draftsUnapproved'));
  const committed = await withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const built = await cycleInputs(exec, input.month, at, rules);
    if (!built.ok) return built;
    if (payCycleInputHash(built.value.input) !== input.inputHash)
      return err(withKey('CONFLICT', 'errors.payouts.dryRunStale'));
    // AC7.16.4: an Employee with no salary set stops the commit, and is named.
    const { missingSalary } = built.value.payroll;
    if (missingSalary.length > 0) {
      const names = await getIdentity().displayNamesOf(missingSalary);
      return err({
        ...withKey('INVALID_STATE', 'errors.payouts.noSalary'),
        fieldErrors: { instructors: missingSalary.map((id) => names[id] || id) },
      });
    }
    const cycle = assemblePayCycle(built.value.input);
    const created = await repo.insertCycle(
      exec,
      {
        month: input.month,
        periodEnd: built.value.periodEnd,
        inputHash: input.inputHash,
        totalEarned: cycle.totals.earned,
        totalPayout: cycle.totals.payout,
        totalCarryIn: cycle.totals.carryIn,
        totalCarryOut: cycle.totals.carryOut,
        totalSalary: cycle.totals.salary,
        totalAdjustment: cycle.totals.adjustment,
        committedBy: actor.userId,
        committedAt: new Date(),
      },
      cycle.lines.map((l) => ({
        instructorId: l.instructorId,
        earned: l.earned,
        carryIn: l.carryIn,
        payout: l.payout,
        carryOut: l.carryOut,
        salary: l.salary,
        adjustment: l.adjustment,
        state: l.state,
        holdReason: l.state === 'held' ? ('kyc' as const) : null,
        updatedAt: at,
      })),
    );
    for (const line of await repo.linesOf(exec, created.cycleId)) {
      // US7.16: the salary becomes the instructor's payable in the ledger (paid by this line).
      if (line.salary > 0) {
        const posted = await recordSalaryAccrual(tx, {
          lineId: line.lineId,
          instructorId: line.instructorId,
          amount: line.salary,
          occurredAt: new Date(built.value.periodEnd.getTime() - 1),
        });
        if (!posted.ok) throw new Error('salary accrual refused');
      }
      // US7.27: the policy's share replaces the default credit (payable ↔ platform revenue).
      if (line.adjustment !== 0) {
        const posted = await recordPolicyAdjustment(tx, {
          lineId: line.lineId,
          instructorId: line.instructorId,
          amount: line.adjustment,
          occurredAt: new Date(built.value.periodEnd.getTime() - 1),
        });
        if (!posted.ok) throw new Error('policy adjustment refused');
      }
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'payout.line.committed',
        subjectType: 'payout_line',
        subjectId: line.lineId,
        after: {
          cycle: input.month,
          instructorId: line.instructorId,
          policy:
            line.adjustment !== 0
              ? 'policy_share'
              : line.salary > 0
                ? 'salary_and_revenue_share'
                : 'revenue_share',
          inputs: {
            earned: line.earned,
            salary: line.salary,
            adjustment: line.adjustment,
            carryIn: line.carryIn,
            inputHash: input.inputHash,
          },
          payout: line.payout,
          carryOut: line.carryOut,
          state: line.state,
        },
        correlationId,
      });
      if (line.state === 'held') await notifyLine(tx, line, PAYOUT_TYPES.held, correlationId);
    }
    return ok({ cycleId: created.cycleId, lines: cycle.lines.length });
  });
  if (committed.ok) await storeCycleStatements(input.month, correlationId);
  return committed;
}

/**
 * US7.4 / US7.6: records a line as paid. Admin with two-step sign-in only (the human's in-product
 * approval), and only once the golden payout examples are approved. Idempotent by key.
 */
export async function recordPayment(
  actor: Actor,
  raw: RecordPaymentInput,
  correlationId: string,
): Promise<Result<{ state: 'disbursed' }, PayoutError>> {
  const input = RecordPaymentInput.parse(raw);
  if (!actor.hasStepUp) return err(withKey('FORBIDDEN', 'errors.payouts.stepUp'));
  if (!goldenGate()) return err(withKey('INVALID_STATE', 'errors.payouts.goldenUnapproved'));
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const line = await repo.lineById(exec, input.lineId, true);
    if (!line) return err(withKey('NOT_FOUND', 'errors.payouts.noLine'));
    // A retry of the same payment: already recorded, nothing changes (never paid twice).
    if (line.state === 'disbursed' && line.idempotencyKey === input.idempotencyKey)
      return ok({ state: 'disbursed' as const });
    const used = await repo.lineByIdempotencyKey(exec, input.idempotencyKey);
    if (used && used.lineId !== line.lineId)
      return err(withKey('CONFLICT', 'errors.payouts.keyReused'));
    if (line.payout === 0 || nextLineState(line.state, 'disbursed') === null)
      return err(withKey('INVALID_STATE', 'errors.payouts.notPayable'));
    // The payment leaves the instructor's payable in the ledger, in the same transaction.
    const posted = await recordInstructorPayout(tx, {
      lineId: line.lineId,
      instructorId: line.instructorId,
      amount: line.payout,
      occurredAt: now,
    });
    if (!posted.ok) return err(withKey('INVALID_STATE', 'errors.payouts.notPayable'));
    await repo.updateLine(exec, line.lineId, {
      state: 'disbursed',
      providerRef: input.providerRef,
      idempotencyKey: input.idempotencyKey,
      disbursedAt: now,
      disbursedBy: actor.userId,
      updatedAt: now,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payout.line.disbursed',
      subjectType: 'payout_line',
      subjectId: line.lineId,
      before: { state: line.state },
      after: { state: 'disbursed', payout: line.payout },
      correlationId,
    });
    await notifyLine(tx, line, PAYOUT_TYPES.paid, correlationId);
    return ok({ state: 'disbursed' as const });
  });
}

/** US7.5: a failed payment holds the line and flags the instructor for re-verification. */
export async function recordFailure(
  actor: Actor,
  raw: RecordFailureInput,
  correlationId: string,
): Promise<Result<{ state: 'held' }, PayoutError>> {
  const input = RecordFailureInput.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const line = await repo.lineById(exec, input.lineId, true);
    if (!line) return err(withKey('NOT_FOUND', 'errors.payouts.noLine'));
    if (nextLineState(line.state, 'failed') === null)
      return err(withKey('INVALID_STATE', 'errors.payouts.notPayable'));
    await repo.updateLine(exec, line.lineId, {
      state: 'held',
      holdReason: 'failed',
      holdNote: input.note,
      updatedAt: now,
    });
    await flagForReverification(exec, line.instructorId, input.note);
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payout.line.held',
      subjectType: 'payout_line',
      subjectId: line.lineId,
      before: { state: line.state },
      after: { state: 'held', reason: 'failed' },
      reason: input.note,
      correlationId,
    });
    await notifyLine(tx, line, PAYOUT_TYPES.held, correlationId);
    return ok({ state: 'held' as const });
  });
}

/** AC7.5.2 / US7.22: a held line goes back to payable once the instructor is verified again. */
export async function releaseLine(
  actor: Actor,
  raw: LineRefInput,
  correlationId: string,
): Promise<Result<{ state: 'pending' }, PayoutError>> {
  const input = LineRefInput.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const line = await repo.lineById(exec, input.lineId, true);
    if (!line) return err(withKey('NOT_FOUND', 'errors.payouts.noLine'));
    if (nextLineState(line.state, 'release') === null)
      return err(withKey('INVALID_STATE', 'errors.payouts.notHeld'));
    if ((await getVerificationStatus(line.instructorId)).status !== 'verified')
      return err(withKey('INVALID_STATE', 'errors.payouts.notVerified'));
    await repo.updateLine(exec, line.lineId, {
      state: 'pending',
      holdReason: null,
      holdNote: null,
      releasedAt: now,
      updatedAt: now,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payout.line.released',
      subjectType: 'payout_line',
      subjectId: line.lineId,
      before: { state: 'held', reason: line.holdReason },
      after: { state: 'pending' },
      correlationId,
    });
    return ok({ state: 'pending' as const });
  });
}

export type PayoutLineView = {
  lineId: string;
  instructorId: string;
  name: string;
  earned: number;
  salary: number;
  adjustment: number;
  carryIn: number;
  payout: number;
  carryOut: number;
  state: LineRow['state'];
  holdReason: LineRow['holdReason'];
  holdNote: string | null;
  providerRef: string | null;
  disbursedAt: string | null;
  releasedAt: string | null;
};

export type PayoutsOverview = {
  /** Ended months with no committed cycle yet, oldest first; only the oldest can be committed. */
  openMonths: string[];
  cycles: Array<{
    cycleId: string;
    month: string;
    committedAt: string;
    totals: {
      earned: number;
      salary: number;
      adjustment: number;
      payout: number;
      carryIn: number;
      carryOut: number;
    };
    lines: PayoutLineView[];
  }>;
  isGoldenApproved: boolean;
};

/** A1: committed cycles with their lines, and the months waiting to be run. */
export async function payoutsOverview(): Promise<Result<PayoutsOverview, never>> {
  const db = getDb();
  const cycles = await repo.cycles(db, 12);
  const latest = cycles[0]?.month ?? null;
  const openMonths = endedMonths(now(), 12)
    .filter((m) => latest === null || m > latest)
    .reverse();
  const lines = await Promise.all(cycles.map((c) => repo.linesOf(db, c.cycleId)));
  const names = await getIdentity().displayNamesOf([
    ...new Set(lines.flat().map((l) => l.instructorId)),
  ]);
  return ok({
    openMonths,
    isGoldenApproved: goldenGate(),
    cycles: cycles.map((c, i) => ({
      cycleId: c.cycleId,
      month: c.month,
      committedAt: c.committedAt.toISOString(),
      totals: {
        earned: c.totalEarned,
        salary: c.totalSalary,
        adjustment: c.totalAdjustment,
        payout: c.totalPayout,
        carryIn: c.totalCarryIn,
        carryOut: c.totalCarryOut,
      },
      lines: (lines[i] ?? []).map((l) => lineView(l, names[l.instructorId] ?? '')),
    })),
  });
}

function lineView(l: LineRow, name: string): PayoutLineView {
  return {
    lineId: l.lineId,
    instructorId: l.instructorId,
    name,
    earned: l.earned,
    salary: l.salary,
    adjustment: l.adjustment,
    carryIn: l.carryIn,
    payout: l.payout,
    carryOut: l.carryOut,
    state: l.state,
    holdReason: l.holdReason,
    holdNote: l.holdNote,
    providerRef: l.providerRef,
    disbursedAt: l.disbursedAt?.toISOString() ?? null,
    releasedAt: l.releasedAt?.toISOString() ?? null,
  };
}

// ================================================================= Instructors (their own only)

export type MyPayoutCycle = Omit<PayoutLineView, 'instructorId' | 'name' | 'providerRef'> & {
  month: string;
};

/** US7.9: the caller's own cycles with their state, newest first. */
export async function myPayoutCycles(actor: Actor): Promise<Result<MyPayoutCycle[], never>> {
  return payoutCyclesOf(actor.userId);
}

/** One instructor's payout cycles, newest first (the instructor's own view, or an Admin's). */
export async function payoutCyclesOf(
  instructorId: string,
): Promise<Result<MyPayoutCycle[], never>> {
  const rows = await repo.linesOfInstructor(getDb(), instructorId);
  return ok(
    rows.map((r) => {
      const { instructorId: _i, name: _n, providerRef: _p, ...view } = lineView(r.line, '');
      return { ...view, month: r.month };
    }),
  );
}

export type CycleStatement = MyPayoutCycle & {
  instructorName: string;
  lines: Array<{
    occurredAt: string;
    kind: 'course_sale' | 'course_refund' | 'attribution_reassignment';
    amount: number;
    titleBn: string;
    titleEn: string;
  }>;
  /** The stored statement files (the downloads), and until when they are kept. */
  csv: { bn: string; en: string };
  storedAt: string;
  retainUntil: string;
};

const takaText = (poisha: number) => {
  const sign = poisha < 0 ? '-' : '';
  const abs = Math.abs(poisha);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
const WORDS = {
  en: {
    course_sale: 'Sale',
    course_refund: 'Refund',
    attribution_reassignment: 'Attribution reassignment',
    salary: 'Salary',
    adjustment: 'Pay-policy share adjustment',
    carryIn: 'Owed back from last cycle',
    payout: 'Payout',
    carryOut: 'Owed back to next cycle',
  },
  bn: {
    course_sale: 'বিক্রি',
    course_refund: 'ফেরত',
    attribution_reassignment: 'মালিকানা নিষ্পত্তির পুনর্বণ্টন',
    salary: 'বেতন',
    adjustment: 'পে-পলিসি অনুযায়ী অংশ সমন্বয়',
    carryIn: 'গত চক্র থেকে ফেরতযোগ্য',
    payout: 'পেআউট',
    carryOut: 'পরের চক্রে ফেরতযোগ্য',
  },
} as const;

/** The stored statement's layout: its column headers in both languages (BR14.1). */
const CYCLE_STATEMENT_TEMPLATE = defineCsvTemplate({
  name: 'payouts.cycleStatement',
  owner: 'payouts',
  columns: [
    { key: 'date', header: { en: 'Date (Asia/Dhaka)', bn: 'তারিখ (ঢাকা)' } },
    { key: 'item', header: { en: 'Item', bn: 'বিষয়' } },
    { key: 'course', header: { en: 'Course', bn: 'কোর্স' } },
    { key: 'amount', header: { en: 'Amount (BDT)', bn: 'পরিমাণ (টাকা)' } },
  ],
});

let store: ObjectStore = createFileObjectStore();
/** Tests keep stored statements in a temporary folder. */
export function setPayoutStoreForTests(next: ObjectStore) {
  store = next;
}
const renderer = () =>
  createRenderer({ db: getDb(), clock: systemClock, store, templates: [CYCLE_STATEMENT_TEMPLATE] });

type LineWithCycle = {
  line: LineRow;
  month: string;
  periodEnd: Date;
  committedAt: Date;
};

/** One line's statement: exactly the ledger lines its cycle counted, and its totals. */
async function statementData(row: LineWithCycle) {
  const db = getDb();
  const previous = await repo.previousCycle(db, row.month);
  const ledgerLines = await instructorCycleLines(
    row.line.instructorId,
    { cutoff: row.periodEnd, committedAt: row.committedAt },
    previous ? { cutoff: previous.periodEnd, committedAt: previous.committedAt } : null,
  );
  const ids = [...new Set(ledgerLines.flatMap((l) => (l.courseId ? [l.courseId] : [])))];
  const titles = await courseTitlesOf(ids);
  const lines = ledgerLines.map((l) => ({
    occurredAt: l.occurredAt.toISOString(),
    kind: l.kind,
    amount: l.amount,
    titleBn: (l.courseId ? titles[l.courseId]?.titleBn : '') ?? '',
    titleEn: (l.courseId ? titles[l.courseId]?.titleEn : '') ?? '',
  }));
  const dhakaDate = (iso: string) =>
    new Date(new Date(iso).getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = (locale: 'bn' | 'en') => {
    const w = WORDS[locale];
    const r = (date: string, item: string, course: string, amount: number) => ({
      date,
      item,
      course,
      amount: takaText(amount),
    });
    return [
      ...lines.map((l) =>
        r(
          dhakaDate(l.occurredAt),
          w[l.kind],
          (locale === 'bn' ? l.titleBn : l.titleEn) || l.titleBn || l.titleEn,
          l.amount,
        ),
      ),
      ...(row.line.salary > 0 ? [r('', w.salary, '', row.line.salary)] : []),
      ...(row.line.adjustment !== 0 ? [r('', w.adjustment, '', row.line.adjustment)] : []),
      r('', w.carryIn, '', -row.line.carryIn),
      r('', w.carryOut, '', row.line.carryOut),
      r('', w.payout, '', row.line.payout),
    ];
  };
  return { lines, rows };
}

/**
 * US7.8 / FR7.4: renders and stores a line's statement (CSV in Bangla and English) once, kept for
 * the retention setting (at least 10 years). Already stored statements are left as they are.
 */
async function storeStatements(row: LineWithCycle, correlationId: string) {
  const db = getDb();
  const existing = await repo.statementsOf(db, row.line.lineId);
  const missing = (['bn', 'en'] as const).filter((l) => !existing.some((e) => e.locale === l));
  if (missing.length === 0) return existing;
  const years = await settings().get(PAYOUT_SETTINGS.statementRetentionYears);
  const keep = years.ok ? years.value.value : 10;
  const now = new Date();
  const retainUntil = new Date(now);
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + Math.max(10, keep));
  const data = await statementData(row);
  for (const locale of missing) {
    const rendered = await renderer().render(
      {
        template: CYCLE_STATEMENT_TEMPLATE.name,
        locale,
        format: 'csv',
        data: data.rows(locale),
        retainUntil: retainUntil.toISOString(),
      },
      correlationId,
    );
    if (!rendered.ok) continue;
    const bytes = await store.get(rendered.value.objectKey);
    await repo.insertStatement(db, {
      lineId: row.line.lineId,
      locale,
      format: 'csv',
      objectKey: rendered.value.objectKey,
      sha256: createHash('sha256')
        .update(bytes ?? Buffer.alloc(0))
        .digest('hex'),
      createdAt: now,
      retainUntil,
    });
  }
  return repo.statementsOf(db, row.line.lineId);
}

/** After a commit: stores every line's statement (a failure is retried on first download). */
async function storeCycleStatements(month: string, correlationId: string) {
  const db = getDb();
  const cycle = await repo.cycleByMonth(db, month);
  if (!cycle) return;
  for (const line of await repo.linesOf(db, cycle.cycleId))
    await storeStatements(
      { line, month, periodEnd: cycle.periodEnd, committedAt: cycle.committedAt },
      correlationId,
    ).catch(() => undefined);
}

/**
 * US7.8 per cycle: the caller's own statement for a committed cycle, served from the stored file
 * (stored now if it is missing). It matches the committed snapshot exactly.
 */
export async function myCycleStatement(
  actor: Actor,
  raw: CycleMonthInput,
): Promise<Result<CycleStatement, AppError<'NOT_FOUND'>>> {
  return cycleStatementOf(actor.userId, raw);
}

/** One instructor's statement for one cycle month (their own view, or an Admin's). */
export async function cycleStatementOf(
  instructorId: string,
  raw: CycleMonthInput,
): Promise<Result<CycleStatement, AppError<'NOT_FOUND'>>> {
  const input = CycleMonthInput.parse(raw);
  const db = getDb();
  const row = await repo.lineOfInstructorInMonth(db, instructorId, input.month);
  if (!row) return err(appError('NOT_FOUND'));
  const [data, stored, names] = await Promise.all([
    statementData(row),
    storeStatements(row, `statement-${row.line.lineId}`),
    getIdentity().displayNamesOf([instructorId]),
  ]);
  const fileOf = async (locale: 'bn' | 'en') => {
    const s = stored.find((x) => x.locale === locale);
    const bytes = s ? await store.get(s.objectKey) : null;
    return bytes ? bytes.toString('utf8') : '';
  };
  const first = stored[0];
  if (!first) return err(appError('NOT_FOUND'));
  const { instructorId: _i, name: _n, providerRef: _p, ...view } = lineView(row.line, '');
  return ok({
    ...view,
    month: row.month,
    instructorName: names[instructorId] ?? '',
    lines: data.lines,
    csv: { bn: await fileOf('bn'), en: await fileOf('en') },
    storedAt: first.createdAt.toISOString(),
    retainUntil: first.retainUntil.toISOString(),
  });
}
