// Trust and safety in the catalog: the Admin-maintained blocked-domain list (NFR6.210; SD-211), and
// the contract 5 takedown hide and restore that U11 TrustOps calls in its own transaction (UC20;
// BR12.5; NFR6.218, NFR6.219; SD-220, SD-221).
// Each change runs through the kernel's write wrapper (one transaction, refusal logged once) with its
// audit entry, which records the entry ID and the
// action only (never the domain text in logs or the outbox). There is no cache: a change applies to
// the very next save or publish.
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Executor, unwrapTx } from '#src/server/db.ts';
import {
  CONTENT_VISIBILITY_CHANGED,
  ContentVisibilityChangedV1,
} from '../domain/catalog-events.schema.ts';
import {
  checkVersion,
  invalidState,
  notFound,
  staleVersion,
  transitionCourse,
  validationFailed,
} from '../domain/course.ts';
import type { CatalogKernel, Failure } from './catalog-kernel.ts';
import {
  AddBlockedDomainInput,
  BlockedDomainPageInput,
  RemoveBlockedDomainInput,
} from './catalog-trust.schema.ts';

export type BlockedDomainView = {
  blockedDomainId: string;
  domain: string;
  createdAt: string;
  version: number;
};

const TakedownInput = z.object({
  contentRef: z.object({ type: z.enum(['course', 'section', 'lesson']), id: Id }),
  takedownNoticeId: Id,
});
export type TakedownInput = z.input<typeof TakedownInput>;
type TakedownError = AppError<'NOT_FOUND' | 'INVALID_STATE'>;

export function createTrustService(kernel: CatalogKernel) {
  const { blocked, courses, sections, lessons } = kernel.repos;

  /** Admin-only builders guard these; the service re-checks the role as defence in depth. */
  const isAdmin = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

  async function listBlockedDomains(actor: Actor, raw: unknown) {
    if (!isAdmin(actor)) return err(notFound());
    const page = BlockedDomainPageInput.parse(raw);
    const result = await blocked.list(kernel.deps.db, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return ok({
      page: page.page,
      total: result.total,
      rows: result.rows.map(
        (r): BlockedDomainView => ({
          blockedDomainId: r.blockedDomainId,
          domain: r.domain,
          createdAt: r.createdAt.toISOString(),
          version: r.version,
        }),
      ),
    });
  }

  async function addBlockedDomain(
    actor: Actor,
    raw: unknown,
    correlationId: string,
  ): Promise<Result<{ blockedDomainId: string; domain: string }, Failure>> {
    if (!isAdmin(actor)) return err(notFound());
    const input = AddBlockedDomainInput.parse(raw);
    const domain = kernel.links.normaliseDomain(input.domain);
    if (!domain.ok) return err(validationFailed({ domain: ['errors.catalog.domainInvalid'] }));
    return kernel.write(
      { actor, operation: 'addBlockedDomain' },
      correlationId,
      async (tx, exec) => {
        const row = await blocked.insert(exec, {
          domain: domain.value,
          createdBy: actor.userId,
          createdAt: kernel.now(),
        });
        if (!row) {
          return err({
            code: 'CONFLICT',
            i18nKey: 'errors.catalog.domainAlreadyBlocked',
            fieldErrors: { domain: ['errors.catalog.domainAlreadyBlocked'] },
          });
        }
        await kernel.deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'catalog.blockedDomain.added',
          subjectType: 'blocked_domain',
          subjectId: row.blockedDomainId,
          after: { blockedDomainId: row.blockedDomainId },
          correlationId,
        });
        return ok({ blockedDomainId: row.blockedDomainId, domain: row.domain });
      },
    );
  }

  async function removeBlockedDomain(
    actor: Actor,
    raw: unknown,
    correlationId: string,
  ): Promise<Result<{ blockedDomainId: string }, Failure>> {
    if (!isAdmin(actor)) return err(notFound());
    const input = RemoveBlockedDomainInput.parse(raw);
    return kernel.write(
      { actor, operation: 'removeBlockedDomain' },
      correlationId,
      async (tx, exec) => {
        const row = await blocked.getForUpdate(exec, input.blockedDomainId);
        if (!row) return err(notFound());
        const version = checkVersion(row.version, input.expectedVersion);
        if (!version.ok) return version;
        if (!(await blocked.remove(exec, row.blockedDomainId, row.version))) {
          return err(staleVersion(row.version));
        }
        await kernel.deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'catalog.blockedDomain.removed',
          subjectType: 'blocked_domain',
          subjectId: row.blockedDomainId,
          before: { blockedDomainId: row.blockedDomainId },
          correlationId,
        });
        return ok({ blockedDomainId: row.blockedDomainId });
      },
    );
  }

  // ---------------------------------------------------------------- UC20 takedown (contract 5)

  /** The course a content reference belongs to, so the course row lock is always taken first. */
  async function courseOf(exec: Executor, ref: { type: string; id: string }) {
    if (ref.type === 'course') return ref.id;
    if (ref.type === 'section') return sections.courseIdOf(exec, ref.id);
    return (await lessons.placement(exec, ref.id))?.courseId;
  }

  async function takedown(
    action: 'hide' | 'restore',
    tx: TxHandle,
    raw: TakedownInput,
  ): Promise<Result<void, TakedownError>> {
    const parsed = TakedownInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const { contentRef, takedownNoticeId } = parsed.data;
    const exec = unwrapTx(tx);
    const courseId = await courseOf(exec, contentRef);
    const course = courseId ? await courses.getForUpdate(exec, courseId) : undefined;
    if (!course) return err(notFound());
    const at = kernel.now();
    const applied =
      contentRef.type === 'course'
        ? await courseTakedown(exec, action, course, takedownNoticeId, at)
        : contentRef.type === 'section'
          ? await sectionTakedown(exec, action, course.courseId, contentRef.id, takedownNoticeId)
          : await lessonTakedown(exec, action, contentRef.id, takedownNoticeId);
    if (!applied.ok) return applied;
    if (!applied.value) return ok(undefined); // idempotent repeat: nothing changed, nothing recorded
    const correlationId = `catalog.takedown:${takedownNoticeId}`;
    await kernel.deps.audit.record(tx, {
      actorId: 'system',
      action: action === 'hide' ? 'catalog.content.hidden' : 'catalog.content.restored',
      subjectType: contentRef.type,
      subjectId: contentRef.id,
      after: { takedownNoticeId, courseId: course.courseId },
      correlationId,
    });
    const payload = ContentVisibilityChangedV1.parse({
      courseId: course.courseId,
      contentRef,
      takedownNoticeId,
      action,
      occurredAt: at.toISOString(),
    });
    await kernel.deps.outbox.publish(tx, {
      ...CONTENT_VISIBILITY_CHANGED,
      aggregateKey: course.courseId,
      occurredAt: payload.occurredAt,
      payload,
      correlationId,
    });
    return ok(undefined);
  }

  /** BR12.5: ok(true) when changed, ok(false) for an idempotent repeat of the same hide. */
  type Applied = Result<boolean, TakedownError>;

  function noticeState(
    action: 'hide' | 'restore',
    stored: string | null,
    notice: string,
  ): Applied | 'apply' {
    if (action === 'hide') {
      if (stored === notice) return ok(false);
      return stored === null ? 'apply' : err(invalidState('underTakedown'));
    }
    return stored !== null && stored === notice ? 'apply' : err(invalidState('invalidTransition'));
  }

  async function courseTakedown(
    exec: Executor,
    action: 'hide' | 'restore',
    course: Awaited<ReturnType<typeof courses.get>> & object,
    notice: string,
    at: Date,
  ): Promise<Applied> {
    const state = noticeState(action, course.activeTakedownNoticeId, notice);
    if (state !== 'apply') return state;
    const next = transitionCourse(course.status, action, {
      statusBeforeHidden: course.statusBeforeHidden,
    });
    if (!next.ok) return err(invalidState('invalidTransition'));
    const updated = await courses.update(
      exec,
      course.courseId,
      course.version,
      action === 'hide'
        ? {
            status: 'hidden',
            statusBeforeHidden: course.status as 'published' | 'unpublished' | 'retired',
            activeTakedownNoticeId: notice,
          }
        : { status: next.value, statusBeforeHidden: null, activeTakedownNoticeId: null },
      at,
    );
    return updated.kind === 'applied' ? ok(true) : err(invalidState('invalidTransition'));
  }

  async function sectionTakedown(
    exec: Executor,
    action: 'hide' | 'restore',
    courseId: string,
    sectionId: string,
    notice: string,
  ): Promise<Applied> {
    const section = await sections.getForUpdate(exec, courseId, sectionId);
    if (!section) return err(notFound());
    const state = noticeState(action, section.hiddenByTakedownNoticeId, notice);
    if (state !== 'apply') return state;
    // Only content that has been live can be taken down (a draft is never visible).
    if (action === 'hide' && section.firstPublishedAt === null) {
      return err(invalidState('invalidTransition'));
    }
    await sections.update(exec, sectionId, {
      hiddenByTakedownNoticeId: action === 'hide' ? notice : null,
    });
    return ok(true);
  }

  async function lessonTakedown(
    exec: Executor,
    action: 'hide' | 'restore',
    lessonId: string,
    notice: string,
  ): Promise<Applied> {
    const lesson = await lessons.getLessonForUpdate(exec, lessonId);
    if (!lesson) return err(notFound());
    const state = noticeState(action, lesson.hiddenByTakedownNoticeId, notice);
    if (state !== 'apply') return state;
    if (action === 'hide' && lesson.liveState === 'never_published') {
      return err(invalidState('invalidTransition'));
    }
    await lessons.updateLesson(exec, [lessonId], {
      hiddenByTakedownNoticeId: action === 'hide' ? notice : null,
    });
    return ok(true);
  }

  return {
    listBlockedDomains,
    addBlockedDomain,
    removeBlockedDomain,
    hideContent: (tx: TxHandle, input: TakedownInput) => takedown('hide', tx, input),
    restoreContent: (tx: TxHandle, input: TakedownInput) => takedown('restore', tx, input),
  };
}
