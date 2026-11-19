// HR records (US7.1, US7.10, US7.24; screens A7, A8), Finance or Admin with two-step sign-in.
// Pay-policy versions, employee records and leave entries are stored and audit-logged here; no
// payroll or payout amount is computed here. U9 Payouts reads them through payrollRecords (US7.16)
// to compute salary lines, behind its payouts.payrollAndAttribution flag.
// - A pay policy is saved as a new version, effective from the next cycle (AC7.1.1, AC7.1.3).
// - Employee records (salary, joining and exit dates, leave balance) exist for Employee
//   instructors only; for a Contractor they are unavailable (AC7.10.2).
// - Leave reduces the balance; an absence beyond it is marked "absence without leave" (AC7.24.2).
import { type Actor, getIdentity } from '#src/features/identity-access/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  createHrRepository,
  type LeaveRow,
  type PolicyRow,
  type RecordRow,
} from '../data/hr.repository.ts';
import {
  applyLeave,
  daysInclusive,
  nextCycleStart,
  policyInEffect,
  validateEmployeeRecord,
  validatePolicy,
} from '../domain/hr.ts';
import {
  FindInstructorInput,
  InstructorRefInput,
  RecordLeaveInput,
  SavePolicyInput,
  SaveRecordInput,
} from './hr.schema.ts';

const repo = createHrRepository();
const audit = createAudit({ clock: systemClock });
type HrServiceError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'VALIDATION_FAILED'>;
const withKey = <C extends HrServiceError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canManage = (actor: Actor) =>
  (actor.roles.includes('finance') || actor.roles.includes('admin')) && actor.hasStepUp;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let now: () => Date = () => new Date();
/** Tests move the clock to check which version is in effect. */
export function setHrClockForTests(clock: () => Date) {
  now = clock;
}

type InstructorType = 'employee' | 'contractor';
async function instructorTypeOf(instructorId: string): Promise<InstructorType | null> {
  const r = await getIdentity().getInstructorType(instructorId);
  if (!r.ok) return null;
  return r.value === 'employee' || r.value === 'contractor' ? r.value : null;
}

export type InstructorHr = {
  instructorId: string;
  name: string;
  instructorType: InstructorType;
  /** Null for a Contractor: salary and leave are unavailable (AC7.10.2). */
  record: {
    salaryPoisha: number | null;
    joinedOn: string | null;
    exitOn: string | null;
    leaveBalanceDays: number;
  } | null;
  policies: Array<
    Omit<PolicyRow, 'effectiveFrom' | 'createdAt'> & {
      effectiveFrom: string;
      createdAt: string;
      isInEffect: boolean;
    }
  >;
  leave: Array<Omit<LeaveRow, 'recordedAt'> & { recordedAt: string }>;
};

async function hrOf(instructorId: string): Promise<InstructorHr | null> {
  const type = await instructorTypeOf(instructorId);
  if (!type) return null;
  const db = getDb();
  const [names, policies, record, leave] = await Promise.all([
    getIdentity().displayNamesOf([instructorId]),
    repo.policiesOf(db, instructorId),
    repo.recordOf(db, instructorId),
    repo.leaveOf(db, instructorId, 100),
  ]);
  const current = policyInEffect(policies, now());
  const recordView = (r: RecordRow | null) => ({
    salaryPoisha: r?.salaryPoisha ?? null,
    joinedOn: r?.joinedOn ?? null,
    exitOn: r?.exitOn ?? null,
    leaveBalanceDays: r?.leaveBalanceDays ?? 0,
  });
  return {
    instructorId,
    name: names[instructorId] ?? '',
    instructorType: type,
    record: type === 'employee' ? recordView(record) : null,
    policies: policies.map((p) => ({
      ...p,
      effectiveFrom: p.effectiveFrom.toISOString(),
      createdAt: p.createdAt.toISOString(),
      isInEffect: current?.versionId === p.versionId,
    })),
    leave:
      type === 'employee'
        ? leave.map((l) => ({ ...l, recordedAt: l.recordedAt.toISOString() }))
        : [],
  };
}

/** A8 list: instructors with any HR record or pay policy. */
export async function hrOverview(
  actor: Actor,
): Promise<Result<Array<{ instructorId: string; name: string }>, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const ids = await repo.knownInstructors(getDb());
  const names = await getIdentity().displayNamesOf(ids);
  return ok(ids.map((instructorId) => ({ instructorId, name: names[instructorId] ?? '' })));
}

/** Finds an instructor by email or account ID; anyone else answers NOT_FOUND. */
export async function findInstructorHr(
  actor: Actor,
  raw: FindInstructorInput,
): Promise<Result<InstructorHr, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const text = FindInstructorInput.parse(raw).instructor;
  const id = UUID.test(text)
    ? text.toLowerCase()
    : await getIdentity().userIdByEmail(text.toLowerCase());
  const found = id ? await hrOf(id) : null;
  return found ? ok(found) : err(withKey('NOT_FOUND', 'errors.hr.noInstructor'));
}

export async function instructorHr(
  actor: Actor,
  raw: InstructorRefInput,
): Promise<Result<InstructorHr, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const found = await hrOf(InstructorRefInput.parse(raw).instructorId);
  return found ? ok(found) : err(withKey('NOT_FOUND', 'errors.hr.noInstructor'));
}

/** AC7.1.1–AC7.1.4: a new version with the actor's ID, effective from the next cycle. */
export async function savePolicy(
  actor: Actor,
  raw: SavePolicyInput,
  correlationId: string,
): Promise<Result<{ version: number; effectiveFrom: string }, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const input = SavePolicyInput.parse(raw);
  const valid = validatePolicy(input);
  if (!valid.ok) return valid;
  if (!(await instructorTypeOf(input.instructorId)))
    return err(withKey('NOT_FOUND', 'errors.hr.noInstructor'));
  const at = now();
  const effectiveFrom = nextCycleStart(at);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    await repo.lockInstructor(exec, input.instructorId);
    const latest = (await repo.policiesOf(exec, input.instructorId))[0];
    const row = await repo.insertPolicy(exec, {
      instructorId: input.instructorId,
      version: (latest?.version ?? 0) + 1,
      ...valid.value,
      effectiveFrom,
      createdBy: actor.userId,
      createdAt: at,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'hr.payPolicy.versioned',
      subjectType: 'pay_policy_version',
      subjectId: row.versionId,
      before: latest ? { version: latest.version, kind: latest.kind } : undefined,
      after: {
        instructorId: input.instructorId,
        version: row.version,
        kind: row.kind,
        shareBps: row.shareBps,
        salaryPoisha: row.salaryPoisha,
        perPiecePoisha: row.perPiecePoisha,
        effectiveFrom: effectiveFrom.toISOString(),
      },
      correlationId,
    });
    return ok({ version: row.version, effectiveFrom: effectiveFrom.toISOString() });
  });
}

/** AC7.10.1 / AC7.10.2: Employee instructors only; stored, shown and audit-logged. */
export async function saveRecord(
  actor: Actor,
  raw: SaveRecordInput,
  correlationId: string,
): Promise<Result<{ saved: true }, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const input = SaveRecordInput.parse(raw);
  const type = await instructorTypeOf(input.instructorId);
  if (!type) return err(withKey('NOT_FOUND', 'errors.hr.noInstructor'));
  if (type !== 'employee') return err(withKey('INVALID_STATE', 'errors.hr.contractor'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    await repo.lockInstructor(exec, input.instructorId);
    const before = await repo.recordOf(exec, input.instructorId);
    const next = {
      salaryPoisha:
        input.salaryPoisha === undefined ? (before?.salaryPoisha ?? null) : input.salaryPoisha,
      joinedOn: input.joinedOn === undefined ? (before?.joinedOn ?? null) : input.joinedOn,
      exitOn: input.exitOn === undefined ? (before?.exitOn ?? null) : input.exitOn,
      leaveBalanceDays: input.leaveBalanceDays ?? before?.leaveBalanceDays ?? 0,
    };
    const valid = validateEmployeeRecord(next);
    if (!valid.ok) return valid;
    await repo.upsertRecord(exec, {
      instructorId: input.instructorId,
      ...next,
      updatedBy: actor.userId,
      updatedAt: now(),
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'hr.employeeRecord.saved',
      subjectType: 'employee_record',
      subjectId: input.instructorId,
      before: before
        ? {
            salaryPoisha: before.salaryPoisha,
            joinedOn: before.joinedOn,
            exitOn: before.exitOn,
            leaveBalanceDays: before.leaveBalanceDays,
          }
        : undefined,
      after: next,
      correlationId,
    });
    return ok({ saved: true as const });
  });
}

/** AC7.24.1–AC7.24.3: a leave or absence entry, updating the balance. */
export async function recordLeave(
  actor: Actor,
  raw: RecordLeaveInput,
  correlationId: string,
): Promise<Result<{ entryId: string; balance: number; isWithoutLeave: boolean }, HrServiceError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.hr.forbidden'));
  const input = RecordLeaveInput.parse(raw);
  const days = daysInclusive(input.startsOn, input.endsOn);
  if (days === null) return err(withKey('VALIDATION_FAILED', 'errors.hr.leaveDates'));
  const type = await instructorTypeOf(input.instructorId);
  if (!type) return err(withKey('NOT_FOUND', 'errors.hr.noInstructor'));
  if (type !== 'employee') return err(withKey('INVALID_STATE', 'errors.hr.contractor'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    await repo.lockInstructor(exec, input.instructorId);
    const record = await repo.recordOf(exec, input.instructorId);
    const balance = record?.leaveBalanceDays ?? 0;
    const applied = applyLeave(balance, input.kind, days);
    if (!applied.ok) return applied;
    const at = now();
    await repo.upsertRecord(exec, {
      instructorId: input.instructorId,
      salaryPoisha: record?.salaryPoisha ?? null,
      joinedOn: record?.joinedOn ?? null,
      exitOn: record?.exitOn ?? null,
      leaveBalanceDays: applied.value.balance,
      updatedBy: actor.userId,
      updatedAt: at,
    });
    const row = await repo.insertLeave(exec, {
      instructorId: input.instructorId,
      kind: input.kind,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      days,
      isWithoutLeave: applied.value.isWithoutLeave,
      balanceAfter: applied.value.balance,
      note: input.note ?? null,
      recordedBy: actor.userId,
      recordedAt: at,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'hr.leave.recorded',
      subjectType: 'leave_entry',
      subjectId: row.entryId,
      before: { leaveBalanceDays: balance },
      after: {
        instructorId: input.instructorId,
        kind: input.kind,
        days,
        leaveBalanceDays: applied.value.balance,
        isWithoutLeave: applied.value.isWithoutLeave,
      },
      correlationId,
    });
    return ok({ entryId: row.entryId, ...applied.value });
  });
}

export type PayrollRecord = {
  instructorId: string;
  instructorType: InstructorType | null;
  /** The policy version in effect at the month's start (AC7.1.3), or null. */
  policy: { kind: PolicyRow['kind']; salaryPoisha: number | null; shareBps: number | null } | null;
  record: { salaryPoisha: number | null; joinedOn: string | null; exitOn: string | null } | null;
  /** Leave and absence entries overlapping the month. */
  absences: Array<{ startsOn: string; endsOn: string; isWithoutLeave: boolean }>;
};

/**
 * US7.16, for U9 Payouts: the HR inputs of a month's payroll for every instructor with an HR record
 * or a pay policy, and every active Employee instructor even with neither (AC7.16.4: an Employee
 * with no HR record has no salary, so Payouts names them and refuses the commit). Read-only;
 * Payouts decides who is on payroll.
 */
export async function payrollRecords(month: {
  start: Date;
  firstDay: string;
  lastDay: string;
}): Promise<PayrollRecord[]> {
  const db = getDb();
  const [known, employees] = await Promise.all([
    repo.knownInstructors(db),
    getIdentity().instructorIdsOfType('employee'),
  ]);
  const ids = [...new Set([...known, ...employees])];
  const [policies, records, leave, types] = await Promise.all([
    repo.policiesOfMany(db, ids),
    repo.recordsOfMany(db, ids),
    repo.leaveOverlapping(db, month.firstDay, month.lastDay),
    Promise.all(ids.map((id) => instructorTypeOf(id))),
  ]);
  return ids.map((instructorId, i) => {
    const policy = policyInEffect(
      policies.filter((p) => p.instructorId === instructorId),
      month.start,
    );
    const record = records.find((r) => r.instructorId === instructorId) ?? null;
    return {
      instructorId,
      instructorType: types[i] ?? null,
      policy: policy
        ? { kind: policy.kind, salaryPoisha: policy.salaryPoisha, shareBps: policy.shareBps }
        : null,
      record: record
        ? { salaryPoisha: record.salaryPoisha, joinedOn: record.joinedOn, exitOn: record.exitOn }
        : null,
      absences: leave
        .filter((l) => l.instructorId === instructorId)
        .map((l) => ({ startsOn: l.startsOn, endsOn: l.endsOn, isWithoutLeave: l.isWithoutLeave })),
    };
  });
}
