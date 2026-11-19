// The ambiguous-attribution queue (US7.13; screen A7), Finance or Admin with two-step sign-in.
// - Open a case for a section of a published course, naming the instructors who claim it.
// - Resolve it by confirming one claimant as the section's owner with a reason: the override is
//   recorded and audit-logged with the actor's ID and the reason.
// - Open cases are flagged on the A1 dry run and the affected instructors' lines are marked.
// - Attribution money (the human's choice): resolving also computes the disputed section's share of
//   the unassigned pool for the course's sales so far (../domain/attribution-money.ts) and records
//   it once per case. While the payouts.payrollAndAttribution flag is on and the draft golden set is
//   approved, it is posted to the ledger at once (unassigned pool → owner's payable) and the next
//   payout cycle pays it through its usual window; otherwise it waits as pending and is posted
//   later by postPendingReassignments. A share is never moved twice.
import { getPublishedCourse, getSectionsAt } from '#src/features/catalog/index.ts';
import { type Actor, getIdentity } from '#src/features/identity-access/index.ts';
import { recordAttributionReassignment, unassignedSalesOf } from '#src/features/ledger/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { type CaseRow, createAttributionRepository } from '../data/attribution.repository.ts';
import { disputedInstructors, resolveRefusal } from '../domain/attribution.ts';
import { planReassignment } from '../domain/attribution-money.ts';
import { CaseCourseInput, OpenCaseInput, ResolveCaseInput } from './attribution.schema.ts';
import { mayApplyNewRules, type NewRulesState, newRulesState } from './new-rules.server.ts';

const repo = createAttributionRepository();
const audit = createAudit({ clock: systemClock });
type AttributionError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'VALIDATION_FAILED'>;
const withKey = <C extends AttributionError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canManage = (actor: Actor) =>
  (actor.roles.includes('finance') || actor.roles.includes('admin')) && actor.hasStepUp;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type CaseCourse = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  sections: Array<{ sectionId: string; titleBn: string; titleEn: string }>;
  instructors: Array<{ instructorId: string; displayName: string; role: string }>;
};

/** The published course's sections and instructors, to choose what a case names. */
export async function caseCourse(
  actor: Actor,
  raw: CaseCourseInput,
): Promise<Result<CaseCourse, AttributionError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.attribution.forbidden'));
  const id = UUID.exec(CaseCourseInput.parse(raw).course)?.[0]?.toLowerCase();
  const course = id ? await getPublishedCourse(id) : null;
  if (!id || !course?.ok) return err(withKey('NOT_FOUND', 'errors.attribution.noCourse'));
  return ok({
    courseId: id,
    titleBn: course.value.titleBn,
    titleEn: course.value.titleEn,
    sections: course.value.outline.map((s) => ({
      sectionId: s.sectionId,
      titleBn: s.titleBn,
      titleEn: s.titleEn,
    })),
    instructors: course.value.instructors.map((i) => ({
      instructorId: i.instructorId,
      displayName: i.displayName,
      role: i.role,
    })),
  });
}

export async function openCase(
  actor: Actor,
  raw: OpenCaseInput,
  correlationId: string,
): Promise<Result<{ caseId: string }, AttributionError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.attribution.forbidden'));
  const input = OpenCaseInput.parse(raw);
  const course = await getPublishedCourse(input.courseId);
  if (!course.ok) return err(withKey('NOT_FOUND', 'errors.attribution.noCourse'));
  if (!course.value.outline.some((s) => s.sectionId === input.sectionId))
    return err(withKey('NOT_FOUND', 'errors.attribution.noSection'));
  const instructorIds = new Set(course.value.instructors.map((i) => i.instructorId));
  const claimantIds = [...new Set(input.claimantIds)];
  if (!claimantIds.every((id) => instructorIds.has(id)))
    return err(withKey('VALIDATION_FAILED', 'errors.attribution.claimants'));
  return withTransaction(getDb(), async (tx) => {
    const row = await repo.insert(unwrapTx(tx), {
      courseId: input.courseId,
      sectionId: input.sectionId,
      claimantIds,
      description: input.description,
      openedBy: actor.userId,
      openedAt: new Date(),
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payouts.attribution.opened',
      subjectType: 'attribution_case',
      subjectId: row.caseId,
      after: { courseId: row.courseId, sectionId: row.sectionId, claimants: claimantIds.length },
      correlationId,
    });
    return ok({ caseId: row.caseId });
  });
}

/** The disputed section's share of the course's unassigned sales so far, less what already moved. */
async function planFor(tx: TxHandle, c: { courseId: string; sectionId: string }) {
  const exec = unwrapTx(tx);
  await repo.lockSection(exec, c.sectionId);
  const sales = (await unassignedSalesOf(tx, c.courseId)).filter((x) => x.netUnassigned > 0);
  const withSections = await Promise.all(
    sales.map(async (x) => ({
      paymentId: x.paymentId,
      netUnassigned: x.netUnassigned,
      sectionIds: await getSectionsAt(c.courseId, x.saleAt.toISOString()),
    })),
  );
  return planReassignment(withSections, c.sectionId, await repo.movedFor(exec, c.sectionId));
}

/** Posts one reassignment to the ledger and marks it posted (inside the caller's transaction). */
async function post(
  tx: TxHandle,
  r: { caseId: string; courseId: string; ownerId: string; totalPoisha: number },
  at: Date,
): Promise<boolean> {
  if (r.totalPoisha === 0) return true;
  const posted = await recordAttributionReassignment(tx, {
    caseId: r.caseId,
    courseId: r.courseId,
    instructorId: r.ownerId,
    amount: r.totalPoisha,
    occurredAt: at,
  });
  return posted.ok;
}

/**
 * AC7.13.1: confirms a claimant as the section's owner, with a logged reason; the owner's share of
 * the unassigned pool is recorded (and posted when the new rules may apply).
 */
export async function resolveCase(
  actor: Actor,
  raw: ResolveCaseInput,
  correlationId: string,
): Promise<
  Result<{ state: 'resolved'; movedPoisha: number; isPosted: boolean }, AttributionError>
> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.attribution.forbidden'));
  const input = ResolveCaseInput.parse(raw);
  const rules = await newRulesState();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const found = await repo.forUpdate(exec, input.caseId);
    if (!found) return err(withKey('NOT_FOUND', 'errors.attribution.noCase'));
    const refusal = resolveRefusal(found, input.ownerId, input.reason);
    if (refusal)
      return err(
        withKey(
          refusal === 'errors.attribution.resolved' ? 'INVALID_STATE' : 'VALIDATION_FAILED',
          refusal,
        ),
      );
    const reason = (input.reason as string).trim();
    await repo.resolve(exec, found.caseId, {
      ownerId: input.ownerId,
      reason,
      resolvedBy: actor.userId,
      resolvedAt: new Date(),
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payouts.attribution.override',
      subjectType: 'attribution_case',
      subjectId: found.caseId,
      before: { state: found.state, claimants: found.claimantIds.join(',') },
      after: { state: 'resolved', ownerId: input.ownerId, sectionId: found.sectionId },
      reason,
      correlationId,
    });
    const at = new Date();
    const plan = await planFor(tx, found);
    const row = {
      caseId: found.caseId,
      courseId: found.courseId,
      ownerId: input.ownerId,
      totalPoisha: plan.total,
    };
    // Nothing to move counts as posted; otherwise post now only if the new rules may apply.
    const isPosted = plan.total === 0 || (mayApplyNewRules(rules) && (await post(tx, row, at)));
    await repo.insertReassignment(
      exec,
      {
        ...row,
        sectionId: found.sectionId,
        computedAt: at,
        ...(isPosted ? { postedAt: at, postedBy: actor.userId } : {}),
      },
      plan.items,
    );
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'payouts.attribution.reassigned',
      subjectType: 'attribution_case',
      subjectId: found.caseId,
      after: {
        ownerId: input.ownerId,
        sectionId: found.sectionId,
        movedPoisha: plan.total,
        sales: plan.items.length,
        state: isPosted ? 'posted' : 'pending',
      },
      correlationId,
    });
    return ok({ state: 'resolved' as const, movedPoisha: plan.total, isPosted });
  });
}

/**
 * Posts every pending reassignment (resolved while the new rules were off or the drafts were not
 * approved). Only when the flag is on and the drafts are approved; each is posted once.
 */
export async function postPendingReassignments(
  actor: Actor,
  correlationId: string,
): Promise<Result<{ posted: number; totalPoisha: number }, AttributionError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.attribution.forbidden'));
  if (!mayApplyNewRules(await newRulesState()))
    return err(withKey('INVALID_STATE', 'errors.attribution.rulesOff'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const at = new Date();
    let posted = 0;
    let totalPoisha = 0;
    for (const r of await repo.pendingForUpdate(exec)) {
      if (!(await post(tx, r, at))) continue;
      await repo.markPosted(exec, r.caseId, actor.userId, at);
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'payouts.attribution.posted',
        subjectType: 'attribution_case',
        subjectId: r.caseId,
        before: { state: 'pending' },
        after: { state: 'posted', ownerId: r.ownerId, movedPoisha: r.totalPoisha },
        correlationId,
      });
      posted += 1;
      totalPoisha += r.totalPoisha;
    }
    return ok({ posted, totalPoisha });
  });
}

export type CaseView = Omit<CaseRow, 'openedAt' | 'resolvedAt'> & {
  openedAt: string;
  resolvedAt: string | null;
  courseTitleBn: string;
  courseTitleEn: string;
  sectionTitleBn: string;
  sectionTitleEn: string;
  claimants: Array<{ instructorId: string; name: string }>;
  /** The owner's share of the unassigned pool moved by this case, and whether it is posted. */
  reassignment: { movedPoisha: number; isPosted: boolean } | null;
};

export async function attributionQueue(
  actor: Actor,
): Promise<
  Result<
    { open: CaseView[]; resolved: CaseView[]; pendingReassignments: number; rules: NewRulesState },
    AttributionError
  >
> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.attribution.forbidden'));
  const db = getDb();
  const [open, resolved] = await Promise.all([repo.open(db), repo.recentlyResolved(db, 20)]);
  const rows = [...open, ...resolved];
  const [moved, pendingReassignments, rules] = await Promise.all([
    repo.reassignmentsOf(
      db,
      resolved.map((r) => r.caseId),
    ),
    repo.pendingCount(db),
    newRulesState(),
  ]);
  const movedOf = new Map(moved.map((m) => [m.caseId, m]));
  const names = await getIdentity().displayNamesOf([
    ...new Set(rows.flatMap((r) => [...r.claimantIds, ...(r.ownerId ? [r.ownerId] : [])])),
  ]);
  const courses = new Map<string, Awaited<ReturnType<typeof getPublishedCourse>>>();
  for (const courseId of new Set(rows.map((r) => r.courseId)))
    courses.set(courseId, await getPublishedCourse(courseId));
  const view = (r: CaseRow): CaseView => {
    const c = courses.get(r.courseId);
    const section = c?.ok ? c.value.outline.find((s) => s.sectionId === r.sectionId) : undefined;
    return {
      ...r,
      openedAt: r.openedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      courseTitleBn: c?.ok ? c.value.titleBn : '',
      courseTitleEn: c?.ok ? c.value.titleEn : '',
      sectionTitleBn: section?.titleBn ?? '',
      sectionTitleEn: section?.titleEn ?? '',
      claimants: r.claimantIds.map((id) => ({ instructorId: id, name: names[id] ?? '' })),
      reassignment: (() => {
        const m = movedOf.get(r.caseId);
        return m ? { movedPoisha: m.totalPoisha, isPosted: m.postedAt !== null } : null;
      })(),
    };
  };
  return ok({
    open: open.map(view),
    resolved: resolved.map(view),
    pendingReassignments,
    rules,
  });
}

/** AC7.13.2, for the A1 dry run: the instructors with open cases, and how many cases are open. */
export async function openAttributionFlags(): Promise<{
  openCases: number;
  instructorIds: Set<string>;
}> {
  const open = await repo.open(getDb());
  return { openCases: open.length, instructorIds: disputedInstructors(open) };
}
