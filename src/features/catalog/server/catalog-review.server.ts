// Section review (UC13, UC14; BR8.3–BR8.9, BR12.1, BR12.2, BR12.4). Every transition takes the
// course share lock, then the section and working-copy row locks, re-reads the state it depends on
// and checks the working copy's SectionVersion.version token, so a transition based on a copy that
// changed since the caller loaded it is refused and nothing unseen is ever approved. Each applied
// transition writes one append-only SectionReview entry, an audit entry that references the review
// (never copies the comment), and an IDs-only notification, in the same transaction.
import type { Actor } from '#src/features/identity-access/index.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import type { Executor } from '#src/server/db.ts';
import type { SectionRow, SectionVersionRow } from '../data/section.repository.ts';
import {
  SECTION_APPROVED_TYPE,
  SECTION_RETURNED_TYPE,
  SECTION_SUBMITTED_TYPE,
} from '../domain/catalog-notifications.ts';
import {
  checkCourseEditable,
  checkNotUnderTakedown,
  checkVersion,
  invalidState,
  notFound,
  staleVersion,
} from '../domain/course.ts';
import { checkSectionComplete } from '../domain/lessons.ts';
import {
  decideReviewEvent,
  REVIEW_ACTION_OF,
  type ReviewState,
  transitionReview,
  validateReturnComment,
  type WorkingState,
} from '../domain/review.ts';
import { checkSectionWritable } from '../domain/sections.ts';
import { ReturnSectionInput, ReviewTransitionInput } from './catalog-content.schema.ts';
import { toLessonContent } from './catalog-content.server.ts';
import type { CatalogKernel, Failure, Loaded } from './catalog-kernel.ts';

type HumanEvent = 'submit' | 'approve' | 'return' | 'selfApprove' | 'reopen';

export function createReviewService(kernel: CatalogKernel) {
  const { sections, ownership, lessons } = kernel.repos;

  type Locked = {
    loaded: Loaded;
    section: SectionRow;
    working: SectionVersionRow;
    ownerId: string | null;
  };

  async function lockForReview(
    exec: Executor,
    actor: Actor,
    event: HumanEvent,
    input: { courseId: string; sectionId: string; expectedVersion: number },
  ): Promise<Result<Locked, Failure>> {
    const who = kernel.courseActor(actor);
    const loaded = await kernel.load(exec, input.courseId, who, 'share');
    if (!loaded.ok) return loaded;
    if (loaded.value.role === null) return err(notFound());
    const listed = loaded.value.sections.find((s) => s.sectionId === input.sectionId);
    if (!listed || listed.structureState === 'removed') return err(notFound());
    const ownerId = loaded.value.open.get(input.sectionId)?.instructorId ?? null;
    const allowed = decideReviewEvent(event, {
      isLead: loaded.value.role === 'lead',
      isOwner: ownerId !== null && ownerId === actor.userId,
      isAdmin: who.isAdmin,
    });
    if (!allowed.ok) return allowed;
    const section = (await sections.getForUpdate(
      exec,
      input.courseId,
      input.sectionId,
    )) as SectionRow;
    const hidden = checkNotUnderTakedown(
      loaded.value.course.status === 'hidden',
      section.hiddenByTakedownNoticeId !== null,
    );
    if (!hidden.ok) return hidden;
    const editable = checkCourseEditable(loaded.value.course.status);
    if (!editable.ok) return editable;
    const writable = checkSectionWritable(section.structureState);
    if (!writable.ok) return writable;
    const working = section.workingVersionId
      ? await sections.versionForUpdate(exec, section.workingVersionId)
      : undefined;
    if (!working) return err(invalidState('invalidTransition'));
    const version = checkVersion(working.version, input.expectedVersion);
    if (!version.ok) return version;
    return ok({ loaded: loaded.value, section, working, ownerId });
  }

  async function transition(
    event: HumanEvent,
    actor: Actor,
    input: { courseId: string; sectionId: string; expectedVersion: number },
    correlationId: string,
    rawComment?: string,
  ): Promise<Result<{ sectionId: string; reviewState: ReviewState; version: number }, Failure>> {
    const context = {
      actor,
      operation: `${event}Section`,
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const locked = await lockForReview(exec, actor, event, input);
      if (!locked.ok) return locked;
      const { working, section, loaded, ownerId } = locked.value;
      let comment: string | undefined;
      if (event === 'return') {
        const valid = validateReturnComment(rawComment ?? '');
        if (!valid.ok) return valid;
        comment = valid.value;
      }
      const next = transitionReview(working.reviewState, event);
      if (!next.ok) return next;
      if (event === 'submit' || event === 'selfApprove') {
        const rows = await lessons.listForSectionVersion(exec, working.sectionVersionId);
        const complete = checkSectionComplete(rows.map(toLessonContent));
        if (!complete.ok) return complete;
      }
      const at = kernel.now();
      const updated = await sections.updateVersion(
        exec,
        working.sectionVersionId,
        working.version,
        {
          reviewState: next.value,
          ...(event === 'submit' ? { submittedAt: at } : {}),
          ...(next.value === 'approved' ? { approvedAt: at } : {}),
        },
      );
      if (!updated) return err(staleVersion(working.version));
      await ownership.addReview(exec, {
        sectionId: section.sectionId,
        sectionVersionId: working.sectionVersionId,
        action: REVIEW_ACTION_OF[event],
        fromState: working.reviewState as WorkingState,
        toState: next.value as WorkingState,
        actorId: actor.userId,
        comment: comment ?? null,
        decidedAt: at,
      });
      await kernel.deps.audit.record(tx, {
        actorId: actor.userId,
        action: `catalog.section.${REVIEW_ACTION_OF[event]}`,
        subjectType: 'section',
        subjectId: section.sectionId,
        before: { reviewState: working.reviewState, sectionVersionId: working.sectionVersionId },
        after: { reviewState: next.value, hasComment: comment !== undefined },
        correlationId,
      });
      await notifyFor(tx, event, {
        actorId: actor.userId,
        leadId: loaded.course.leadInstructorId,
        ownerId,
        courseId: input.courseId,
        sectionId: section.sectionId,
        dedupe: `${working.sectionVersionId}:${updated.version}`,
        correlationId,
      });
      return ok({
        sectionId: section.sectionId,
        reviewState: next.value,
        version: updated.version,
      });
    });
  }

  /** BR8.3–BR8.5, BR12.4: IDs only; nobody is notified of their own action. */
  async function notifyFor(
    tx: TxHandle,
    event: HumanEvent,
    facts: {
      actorId: string;
      leadId: string | null;
      ownerId: string | null;
      courseId: string;
      sectionId: string;
      dedupe: string;
      correlationId: string;
    },
  ): Promise<void> {
    const recipients: Record<HumanEvent, { to: string | null; type: string } | null> = {
      submit: { to: facts.leadId, type: SECTION_SUBMITTED_TYPE },
      approve: { to: facts.ownerId, type: SECTION_APPROVED_TYPE },
      return: { to: facts.ownerId, type: SECTION_RETURNED_TYPE },
      selfApprove: null,
      reopen: null,
    };
    const target = recipients[event];
    if (!target?.to || target.to === facts.actorId) return;
    await kernel.deps.notify(
      tx,
      {
        recipientUserId: target.to,
        templateKey: target.type,
        dedupeKey: `${target.type}:${facts.dedupe}`,
        params: { courseId: facts.courseId, sectionId: facts.sectionId },
        channels: ['in_app'],
        priority: 'normal',
      },
      facts.correlationId,
    );
  }

  const simple =
    (event: Exclude<HumanEvent, 'return'>) => (actor: Actor, raw: unknown, correlationId: string) =>
      transition(event, actor, ReviewTransitionInput.parse(raw), correlationId);

  async function returnSection(actor: Actor, raw: unknown, correlationId: string) {
    const input = ReturnSectionInput.parse(raw);
    return transition('return', actor, input, correlationId, input.comment);
  }

  return {
    submitSection: simple('submit'),
    approveSection: simple('approve'),
    selfApproveSection: simple('selfApprove'),
    reopenSection: simple('reopen'),
    returnSection,
  };
}
