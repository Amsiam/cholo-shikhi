// Course switches (US2.17 request on S4, US2.18 decide on A2, US2.19 auto-expiry).
// - A Student with an active paid enrolment asks to switch it for another published course, after
//   reading the refund policy. One pending request at a time; a second attempt shows the first.
// - An Admin with two-step sign-in approves (full or unused-days refund) or denies with a reason
//   within 24 hours. Approval ends the old enrolment as "switched" and posts the refund to the
//   ledger in the same transaction; the Student then buys the new course.
// - At the deadline the request expires (job, and on every read); a stale action is refused.
import { randomUUID } from 'node:crypto';
import { courseTitlesOf, getPublishedCourse } from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { recordCourseRefund } from '#src/features/ledger/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { clawbackReferral } from '#src/features/referrals/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createSwitchRepository, type SwitchRow } from '../data/switch.repository.ts';
import { COMMERCE_TYPES } from '../domain/commerce-notifications.ts';
import {
  effectiveSwitchStatus,
  minutesLeft,
  NEAR_EXPIRY_MS,
  type SwitchPolicy,
  switchDeadline,
  switchRefund,
} from '../domain/switch.ts';
import { DecideSwitchInput, RequestSwitchInput, SwitchOptionsInput } from './commerce.schema.ts';

const repo = createSwitchRepository();
const audit = createAudit({ clock: systemClock });
type SwitchError = AppError<
  'NOT_FOUND' | 'INVALID_STATE' | 'VALIDATION_FAILED' | 'FORBIDDEN' | 'STALE'
>;
const fail = (code: SwitchError['code'], i18nKey: `errors.${string}`) =>
  err<SwitchError>({ code, i18nKey });

export type SwitchView = {
  switchId: string;
  fromCourseId: string;
  toCourseId: string;
  fromTitleBn: string;
  fromTitleEn: string;
  toTitleBn: string;
  toTitleEn: string;
  status: SwitchRow['status'];
  requestedAt: string;
  deadlineAt: string;
  minutesLeft: number;
  isNearExpiry: boolean;
  refundPoisha: number | null;
  reason: string | null;
};

async function viewsOf(rows: readonly SwitchRow[], now: Date): Promise<SwitchView[]> {
  const titles = await courseTitlesOf([
    ...new Set(rows.flatMap((r) => [r.fromCourseId, r.toCourseId])),
  ]);
  return rows.map((r) => ({
    switchId: r.switchId,
    fromCourseId: r.fromCourseId,
    toCourseId: r.toCourseId,
    fromTitleBn: titles[r.fromCourseId]?.titleBn ?? '',
    fromTitleEn: titles[r.fromCourseId]?.titleEn ?? '',
    toTitleBn: titles[r.toCourseId]?.titleBn ?? '',
    toTitleEn: titles[r.toCourseId]?.titleEn ?? '',
    status: effectiveSwitchStatus(r.status, r.deadlineAt, now),
    requestedAt: r.requestedAt.toISOString(),
    deadlineAt: r.deadlineAt.toISOString(),
    minutesLeft: minutesLeft(r.deadlineAt, now),
    isNearExpiry: r.deadlineAt.getTime() - now.getTime() < NEAR_EXPIRY_MS,
    refundPoisha: r.refundPoisha,
    reason: r.reason,
  }));
}

export type SwitchOptions = {
  /** The Student's pending request (shown instead of a new one, AC2.17.2). */
  pending: SwitchView | null;
  /** Paid courses this course could replace. */
  from: Array<{ courseId: string; titleBn: string; titleEn: string; endsAt: string }>;
};

/** S4: what the switch block shows on a course the Student does not own. */
export async function switchOptions(
  actor: Actor,
  raw: SwitchOptionsInput,
): Promise<Result<SwitchOptions, never>> {
  const { courseId } = SwitchOptionsInput.parse(raw);
  const db = getDb();
  const now = new Date();
  const pending = await repo.pendingOf(db, actor.userId);
  const paid = await repo.paidEnrolments(db, actor.userId);
  const owns = paid.some((e) => e.courseId === courseId);
  const from = owns ? [] : paid.filter((e) => e.endsAt.getTime() > now.getTime());
  const titles = await courseTitlesOf(from.map((e) => e.courseId));
  const pendingView =
    pending && effectiveSwitchStatus(pending.status, pending.deadlineAt, now) === 'pending'
      ? ((await viewsOf([pending], now))[0] ?? null)
      : null;
  return ok({
    pending: pendingView,
    from: from.map((e) => ({
      courseId: e.courseId,
      titleBn: titles[e.courseId]?.titleBn ?? '',
      titleEn: titles[e.courseId]?.titleEn ?? '',
      endsAt: e.endsAt.toISOString(),
    })),
  });
}

/** US2.17: queue a request for an Admin with a 24-hour deadline; the enrolment is unchanged. */
export async function requestSwitch(
  actor: Actor,
  raw: RequestSwitchInput,
): Promise<Result<{ request: SwitchView; isExisting: boolean }, SwitchError>> {
  const input = RequestSwitchInput.parse(raw);
  if (input.fromCourseId === input.toCourseId)
    return fail('VALIDATION_FAILED', 'errors.switch.sameCourse');
  const db = getDb();
  const now = new Date();
  // A request past its deadline is closed first, so the Student can ask again.
  await expireDueSwitches(now);
  const existing = await repo.pendingOf(db, actor.userId);
  if (existing)
    return ok({ request: (await viewsOf([existing], now))[0] as SwitchView, isExisting: true });
  const to = await getPublishedCourse(input.toCourseId);
  if (!to.ok) return fail('NOT_FOUND', 'errors.switch.noCourse');
  const paid = await repo.paidEnrolments(db, actor.userId);
  if (paid.some((e) => e.courseId === input.toCourseId))
    return fail('INVALID_STATE', 'errors.switch.alreadyOwned');
  const from = paid.find(
    (e) => e.courseId === input.fromCourseId && e.endsAt.getTime() > now.getTime(),
  );
  if (!from) return fail('NOT_FOUND', 'errors.switch.noEnrolment');
  const row = await repo.insert(db, {
    userId: actor.userId,
    enrolmentId: from.enrolmentId,
    paymentId: from.paymentId,
    fromCourseId: input.fromCourseId,
    toCourseId: input.toCourseId,
    status: 'pending',
    requestedAt: now,
    deadlineAt: switchDeadline(now),
  });
  const saved = row ?? (await repo.pendingOf(db, actor.userId));
  if (!saved) return fail('INVALID_STATE', 'errors.switch.generic');
  return ok({ request: (await viewsOf([saved], now))[0] as SwitchView, isExisting: !row });
}

export type SwitchQueueRow = SwitchView & {
  studentName: string;
  paidPoisha: number;
  unusedRefundPoisha: number;
};

const canDecide = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

/** A2: pending requests, soonest deadline first, with both refund options worked out. */
export async function switchQueue(actor: Actor): Promise<Result<SwitchQueueRow[], SwitchError>> {
  if (!canDecide(actor)) return fail('FORBIDDEN', 'errors.switch.forbidden');
  const db = getDb();
  const now = new Date();
  const rows = await repo.queue(db, now);
  const views = await viewsOf(rows, now);
  const names = await getIdentity().displayNamesOf([...new Set(rows.map((r) => r.userId))]);
  const contexts = await Promise.all(
    rows.map(async (r) =>
      (await repo.paidEnrolments(db, r.userId)).find((e) => e.enrolmentId === r.enrolmentId),
    ),
  );
  return ok(
    views.map((v, i) => {
      const ctx = contexts[i];
      const row = rows[i] as SwitchRow;
      return {
        ...v,
        studentName: names[row.userId] ?? '',
        paidPoisha: ctx?.paidPoisha ?? 0,
        unusedRefundPoisha: ctx ? switchRefund('unused', ctx.paidPoisha, ctx, now) : 0,
      };
    }),
  );
}

async function notifyStudent(
  tx: TxHandle,
  row: SwitchRow,
  templateKey: string,
  correlationId: string,
) {
  await getNotifications().notify(
    tx,
    {
      recipientUserId: row.userId,
      templateKey,
      dedupeKey: `${templateKey}-${row.switchId}`,
      params: {},
      channels: ['in_app', 'email'],
      priority: 'high',
    },
    correlationId,
  );
}

/** US2.18: approve with a refund policy, or deny with a reason. */
export async function decideSwitch(
  actor: Actor,
  raw: DecideSwitchInput,
  correlationId: string,
): Promise<Result<{ status: SwitchRow['status']; refundPoisha: number | null }, SwitchError>> {
  if (!canDecide(actor)) return fail('FORBIDDEN', 'errors.switch.forbidden');
  const input = DecideSwitchInput.parse(raw);
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'deny' && reason.length < 5)
    return fail('VALIDATION_FAILED', 'errors.switch.reason');
  if (input.decision === 'approve' && !input.policy)
    return fail('VALIDATION_FAILED', 'errors.switch.policy');
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const row = await repo.forUpdate(exec, input.switchId);
    if (!row) return fail('NOT_FOUND', 'errors.switch.notFound');
    // AC2.18.5: expired or already decided → stale.
    if (effectiveSwitchStatus(row.status, row.deadlineAt, now) !== 'pending')
      return fail('STALE', 'errors.switch.stale');
    if (input.decision === 'deny') {
      await repo.update(exec, row.switchId, {
        status: 'denied',
        reason,
        decidedBy: actor.userId,
        decidedAt: now,
      });
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'commerce.switch.denied',
        subjectType: 'course_switch_request',
        subjectId: row.switchId,
        after: { status: 'denied' },
        reason,
        correlationId,
      });
      await notifyStudent(tx, row, COMMERCE_TYPES.switchDenied, correlationId);
      return ok({ status: 'denied' as const, refundPoisha: null });
    }
    const ctx = (await repo.paidEnrolments(exec, row.userId)).find(
      (e) => e.enrolmentId === row.enrolmentId,
    );
    if (!ctx || !(await repo.endEnrolmentAsSwitched(exec, row.enrolmentId)))
      return fail('STALE', 'errors.switch.stale');
    const policy = input.policy as SwitchPolicy;
    const refund = switchRefund(policy, ctx.paidPoisha, ctx, now);
    if (refund > 0) {
      const posted = await recordCourseRefund(tx, {
        paymentId: row.paymentId,
        amountPoisha: refund,
        occurredAt: now,
      });
      if (!posted.ok) throw new Error(`switch refund could not be posted: ${posted.error.code}`);
      // AC8.7.2: the referrer's share of the refunded payment comes back in proportion.
      await clawbackReferral(tx, {
        paymentId: row.paymentId,
        paidPoisha: ctx.paidPoisha,
        refundedPoisha: refund,
        occurredAt: now,
      });
    }
    await repo.update(exec, row.switchId, {
      status: 'approved',
      policy,
      refundPoisha: refund,
      reason: reason || null,
      decidedBy: actor.userId,
      decidedAt: now,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'commerce.switch.approved',
      subjectType: 'course_switch_request',
      subjectId: row.switchId,
      after: { status: 'approved', policy, refundPoisha: refund },
      correlationId,
    });
    await notifyStudent(tx, row, COMMERCE_TYPES.switchApproved, correlationId);
    return ok({ status: 'approved' as const, refundPoisha: refund });
  });
}

/** US2.19: expire every pending request at or past its deadline and tell the Students. */
export async function expireDueSwitches(now: Date = new Date()): Promise<number> {
  return withTransaction(getDb(), async (tx) => {
    const expired = await repo.expireDue(unwrapTx(tx), now);
    const correlationId = `commerce.switch.expire:${randomUUID()}`;
    for (const row of expired)
      await notifyStudent(tx, row, COMMERCE_TYPES.switchExpired, correlationId);
    return expired.length;
  });
}
