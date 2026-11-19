// Copyright takedowns (US9.7; screen A11), Admin with two-step sign-in only.
// - Log a notice naming a published course, section or lesson, with the claimant and evidence.
// - Honour it with a reason: the content is hidden from Students through Catalog (contract 5) in
//   the same transaction, the course's instructors are notified, and it is audit-logged.
// - Reject it with a reason (nothing is hidden), or reverse an honoured one with a justification:
//   the content is restored and instructors are notified. A missing reason is refused.

import { getPublishedCourse, hideContent, restoreContent } from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createTakedownRepository, type NoticeRow } from '../data/takedown.repository.ts';
import { courseIdFrom, isReason, nextTakedownState } from '../domain/takedown.ts';
import { TRUSTOPS_TYPES } from '../domain/trustops-notifications.ts';
import { DecideTakedownInput, LogTakedownInput, TargetsInput } from './takedown.schema.ts';

const repo = createTakedownRepository();
const audit = createAudit({ clock: systemClock });
type TakedownError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'VALIDATION_FAILED'>;
const withKey = <C extends TakedownError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canManage = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

export type TakedownTargets = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  sections: Array<{
    sectionId: string;
    titleBn: string;
    titleEn: string;
    lessons: Array<{ lessonId: string; titleBn: string | null; titleEn: string | null }>;
  }>;
};

/** The published course's sections and lessons, to choose what a notice names. */
export async function takedownTargets(
  actor: Actor,
  raw: TargetsInput,
): Promise<Result<TakedownTargets, TakedownError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.takedown.forbidden'));
  const courseId = courseIdFrom(TargetsInput.parse(raw).course);
  if (!courseId) return err(withKey('NOT_FOUND', 'errors.takedown.noCourse'));
  const course = await getPublishedCourse(courseId);
  if (!course.ok) return err(withKey('NOT_FOUND', 'errors.takedown.noCourse'));
  return ok({
    courseId,
    titleBn: course.value.titleBn,
    titleEn: course.value.titleEn,
    sections: course.value.outline.map((s) => ({
      sectionId: s.sectionId,
      titleBn: s.titleBn,
      titleEn: s.titleEn,
      lessons: s.lessons.map((l) => ({
        lessonId: l.lessonId,
        titleBn: l.titleBn,
        titleEn: l.titleEn,
      })),
    })),
  });
}

export async function logTakedown(
  actor: Actor,
  raw: LogTakedownInput,
  correlationId: string,
): Promise<Result<{ noticeId: string }, TakedownError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.takedown.forbidden'));
  const input = LogTakedownInput.parse(raw);
  const course = await getPublishedCourse(input.courseId);
  if (!course.ok) return err(withKey('NOT_FOUND', 'errors.takedown.noCourse'));
  const inCourse =
    input.contentType === 'course'
      ? input.contentId === input.courseId
      : course.value.outline.some((s) =>
          input.contentType === 'section'
            ? s.sectionId === input.contentId
            : s.lessons.some((l) => l.lessonId === input.contentId),
        );
  if (!inCourse) return err(withKey('NOT_FOUND', 'errors.takedown.noContent'));
  return withTransaction(getDb(), async (tx) => {
    const row = await repo.insert(unwrapTx(tx), {
      contentType: input.contentType,
      contentId: input.contentId,
      courseId: input.courseId,
      claimant: input.claimant,
      claimantContact: input.claimantContact,
      claim: input.claim,
      evidence: input.evidence,
      state: 'open',
      loggedBy: actor.userId,
      loggedAt: new Date(),
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'trustops.takedown.logged',
      subjectType: 'takedown_notice',
      subjectId: row.noticeId,
      after: { contentType: row.contentType, contentId: row.contentId, courseId: row.courseId },
      correlationId,
    });
    return ok({ noticeId: row.noticeId });
  });
}

async function notifyInstructors(
  tx: TxHandle,
  notice: NoticeRow,
  instructorIds: readonly string[],
  templateKey: string,
  correlationId: string,
) {
  for (const recipientUserId of instructorIds)
    await getNotifications().notify(
      tx,
      {
        recipientUserId,
        templateKey,
        dedupeKey: `${templateKey}-${notice.noticeId}-${recipientUserId}`,
        params: {},
        channels: ['in_app', 'email'],
        priority: 'high',
      },
      correlationId,
    );
}

/** Honour, reject or reverse, each with a reason (AC9.7.1–AC9.7.3). */
export async function decideTakedown(
  actor: Actor,
  raw: DecideTakedownInput,
  correlationId: string,
): Promise<Result<{ state: string }, TakedownError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.takedown.forbidden'));
  const input = DecideTakedownInput.parse(raw);
  if (!isReason(input.reason)) return err(withKey('VALIDATION_FAILED', 'errors.takedown.reason'));
  const reason = input.reason.trim();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const notice = await repo.forUpdate(exec, input.noticeId);
    if (!notice) return err(withKey('NOT_FOUND', 'errors.takedown.noNotice'));
    const next = nextTakedownState(notice.state, input.action);
    if (!next) return err(withKey('INVALID_STATE', 'errors.takedown.transition'));
    // The instructors are read before the content is hidden (a hidden course is not published).
    const course = await getPublishedCourse(notice.courseId);
    const instructorIds = course.ok ? course.value.instructors.map((i) => i.instructorId) : [];
    const contentRef = { type: notice.contentType, id: notice.contentId };
    if (input.action !== 'reject') {
      const applied =
        input.action === 'honour'
          ? await hideContent(tx, { contentRef, takedownNoticeId: notice.noticeId })
          : await restoreContent(tx, { contentRef, takedownNoticeId: notice.noticeId });
      if (!applied.ok) return err(withKey('INVALID_STATE', 'errors.takedown.content'));
    }
    const now = new Date();
    await repo.update(
      exec,
      notice.noticeId,
      input.action === 'reverse'
        ? { state: next, reversalReason: reason, reversedBy: actor.userId, reversedAt: now }
        : { state: next, decisionReason: reason, decidedBy: actor.userId, decidedAt: now },
    );
    await audit.record(tx, {
      actorId: actor.userId,
      action: `trustops.takedown.${next}`,
      subjectType: 'takedown_notice',
      subjectId: notice.noticeId,
      before: { state: notice.state },
      after: { state: next },
      reason,
      correlationId,
    });
    if (input.action !== 'reject')
      await notifyInstructors(
        tx,
        notice,
        instructorIds,
        input.action === 'honour'
          ? TRUSTOPS_TYPES.takedownHonoured
          : TRUSTOPS_TYPES.takedownReversed,
        correlationId,
      );
    return ok({ state: next });
  });
}

export type TakedownView = Omit<NoticeRow, 'loggedAt' | 'decidedAt' | 'reversedAt'> & {
  loggedAt: string;
  decidedAt: string | null;
  reversedAt: string | null;
};

export async function listTakedowns(actor: Actor): Promise<Result<TakedownView[], TakedownError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.takedown.forbidden'));
  const rows = await repo.list(getDb(), 200);
  return ok(
    rows.map((r) => ({
      ...r,
      loggedAt: r.loggedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      reversedAt: r.reversedAt?.toISOString() ?? null,
    })),
  );
}
