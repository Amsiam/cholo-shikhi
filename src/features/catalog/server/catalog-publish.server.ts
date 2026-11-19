// Publish, republish, unpublish and retire (UC15, UC16; BR4.3, BR4.8, BR8.12, BR9.1–BR9.7, BR12.2;
// SD-212, SD-219; NFR6.217). A publish takes the course and section row locks (update), then every
// working copy in ID order, re-reads all of them and checks every token the confirmation listed, so a
// section that changed state since the dialog loaded refuses the whole publish (BR12.2). It then runs,
// in order: the BR9.2/BR9.3 preconditions, the SD-212 blocked-link check, the BR9.5 caption
// confirmation, and only then writes. Any refusal rolls everything back: nothing is published.
import type { Actor } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Executor, unwrapTx } from '#src/server/db.ts';
import type { CourseRow } from '../data/course.repository.ts';
import type { LessonWithVersion } from '../data/lesson.repository.ts';
import { createModerationRepository } from '../data/moderation.repository.ts';
import { createProductRepository } from '../data/products.repository.ts';
import type { SectionRow, SectionVersionRow } from '../data/section.repository.ts';
import { COURSE_PUBLISHED, CoursePublishedV1 } from '../domain/catalog-events.schema.ts';
import { CATALOG_FLAGS } from '../domain/catalog-flags.ts';
import { COURSE_PUBLISHED_TYPE } from '../domain/catalog-notifications.ts';
import {
  checkVersion,
  decideCourseRead,
  decideLeadAction,
  isTrialCourse,
  notFound,
  staleVersion,
  transitionCourse,
  validationFailed,
} from '../domain/course.ts';
import { documentLinks, type LessonDocument } from '../domain/lesson-document.ts';
import { isLessonComplete } from '../domain/lessons.ts';
import { isBlockedBy } from '../domain/link-validator.ts';
import { checkNotInCurrentPlan } from '../domain/products.ts';
import {
  checkCaptionsConfirmed,
  missingPublishFields,
  type PublishField,
  type PublishPlan,
  type PublishSectionShape,
  planPublish,
} from '../domain/publish.ts';
import type { WorkingState } from '../domain/review.ts';
import { toLessonContent } from './catalog-content.server.ts';
import type { CatalogKernel, Failure, Loaded } from './catalog-kernel.ts';
import {
  CourseLifecycleRefInput,
  CourseTransitionInput,
  DESCRIPTION_MAX,
  PublishCourseInput,
  SetCourseDescriptionInput,
} from './catalog-publish.schema.ts';

export type PublishReadiness = {
  courseId: string;
  status: CourseRow['status'];
  courseVersion: number;
  missingFields: PublishField[];
  sections: Array<{
    sectionId: string;
    structureState: SectionRow['structureState'];
    workingVersionId: string | null;
    workingVersion: number | null;
    reviewState: string | null;
    isComplete: boolean;
    willPublish: boolean;
    isBlocking: boolean;
  }>;
  missingCaptionLessonIds: string[];
  blockedLinkLessonIds: string[];
  /** Titles of the lessons named above, so the dialog can list them by name. */
  lessons: Array<{
    lessonId: string;
    sectionId: string;
    titleBn: string | null;
    titleEn: string | null;
  }>;
  /** Null when the publish would go through; otherwise the refusal's i18n key. */
  refusalKey: string | null;
};

type Snapshot = {
  loaded: Loaded;
  shapes: PublishSectionShape[];
  working: Map<string, SectionVersionRow>;
  live: Map<string, SectionVersionRow>;
  lessonsByVersion: Map<string, LessonWithVersion[]>;
};

const bodyOf = (row: LessonWithVersion, lang: 'Bn' | 'En') =>
  (lang === 'Bn' ? row.version.bodyBn : row.version.bodyEn) as LessonDocument | null;

export function createPublishService(kernel: CatalogKernel) {
  const { courses, sections, ownership, lessons, blocked } = kernel.repos;
  const products = createProductRepository();
  const staff = createModerationRepository();
  const log = kernel.deps.log;

  /** Reads (and, inside a write, locks in ID order) every section's working and live versions. */
  async function snapshot(exec: Executor, loaded: Loaded, lock: boolean): Promise<Snapshot> {
    const kept = loaded.sections.filter((s) => s.structureState !== 'removed');
    const ids = kept
      .flatMap((s) => [s.workingVersionId, s.liveVersionId])
      .filter((v): v is string => v !== null)
      .sort();
    let rows: SectionVersionRow[];
    if (lock) {
      // One at a time in ID order: the fixed lock order (PD-209).
      rows = [];
      for (const id of ids) {
        const row = await sections.versionForUpdate(exec, id);
        if (row) rows.push(row);
      }
    } else {
      rows = await sections.versionsByIds(exec, ids);
    }
    const byId = new Map(rows.map((r) => [r.sectionVersionId, r]));
    const working = new Map<string, SectionVersionRow>();
    const live = new Map<string, SectionVersionRow>();
    for (const s of kept) {
      const w = s.workingVersionId ? byId.get(s.workingVersionId) : undefined;
      const l = s.liveVersionId ? byId.get(s.liveVersionId) : undefined;
      if (w) working.set(s.sectionId, w);
      if (l) live.set(s.sectionId, l);
    }
    const all = await lessons.listForSectionVersions(
      exec,
      [...working.values(), ...live.values()].map((v) => v.sectionVersionId),
    );
    const lessonsByVersion = new Map<string, LessonWithVersion[]>();
    for (const row of all) {
      const list = lessonsByVersion.get(row.version.sectionVersionId) ?? [];
      list.push(row);
      lessonsByVersion.set(row.version.sectionVersionId, list);
    }
    const shapes = loaded.sections.map((s): PublishSectionShape => {
      const w = working.get(s.sectionId);
      const lessonRows = w ? (lessonsByVersion.get(w.sectionVersionId) ?? []) : [];
      return {
        sectionId: s.sectionId,
        structureState: s.structureState,
        isLive: s.liveVersionId !== null,
        isUnderTakedown:
          s.hiddenByTakedownNoticeId !== null ||
          lessonRows.some((l) => l.lesson.hiddenByTakedownNoticeId !== null),
        pendingPosition: s.pendingPosition,
        position: s.position,
        working: w
          ? {
              state: w.reviewState as WorkingState,
              isComplete:
                lessonRows.length > 0 &&
                lessonRows.every((l) => isLessonComplete(toLessonContent(l))),
            }
          : null,
      };
    });
    return { loaded, shapes, working, live, lessonsByVersion };
  }

  const changingIds = (plan: PublishPlan) => [...plan.publish, ...plan.adminApprove];

  function lessonsBeingPublished(snap: Snapshot, plan: PublishPlan): LessonWithVersion[] {
    return changingIds(plan).flatMap((sectionId) => {
      const w = snap.working.get(sectionId);
      return w ? (snap.lessonsByVersion.get(w.sectionVersionId) ?? []) : [];
    });
  }

  /** BR9.5: video lessons about to be published with no caption track. */
  const missingCaptions = (rows: readonly LessonWithVersion[]) =>
    rows
      .filter((r) => r.lesson.kind === 'video' && r.version.captionLanguages.length === 0)
      .map((r) => r.lesson.lessonId);

  /**
   * SD-212: every blocked link in the versions this publish would make live, keyed
   * sections.<sectionId>.lessons.<lessonId>.body<Lang>.links.<n>, with the matching entry IDs.
   */
  async function blockedLinks(exec: Executor, snap: Snapshot, plan: PublishPlan) {
    const versionIds = changingIds(plan)
      .map((id) => snap.working.get(id)?.sectionVersionId)
      .filter((v): v is string => v !== undefined);
    const hits = await blocked.blockedInSectionVersions(exec, versionIds);
    if (hits.length === 0) return null;
    const domains = new Set(hits.map((h) => h.domain));
    const hitVersions = new Set(hits.map((h) => h.lessonVersionId));
    const fieldErrors: Record<string, string[]> = {};
    for (const [sectionId, w] of snap.working) {
      for (const row of snap.lessonsByVersion.get(w.sectionVersionId) ?? []) {
        if (!hitVersions.has(row.version.lessonVersionId)) continue;
        for (const lang of ['Bn', 'En'] as const) {
          const body = bodyOf(row, lang);
          if (!body) continue;
          documentLinks(body).forEach((href, n) => {
            const checked = kernel.links.checkLink(href);
            if (checked.ok && isBlockedBy(checked.value.candidates, domains)) {
              fieldErrors[
                `sections.${sectionId}.lessons.${row.lesson.lessonId}.body${lang}.links.${n}`
              ] = ['errors.catalog.blockedLink'];
            }
          });
        }
      }
    }
    return {
      fieldErrors,
      lessonIds: [...new Set(hits.map((h) => h.lessonId))],
      blockedDomainIds: [...new Set(hits.map((h) => h.blockedDomainId))],
    };
  }

  // ---------------------------------------------------------------- readiness (the I1 dialog)

  async function getPublishReadiness(
    actor: Actor,
    raw: unknown,
  ): Promise<Result<PublishReadiness, AppError<'NOT_FOUND'>>> {
    const parsed = CourseLifecycleRefInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const who = kernel.courseActor(actor);
    const exec: Executor = kernel.deps.db;
    const loaded = await kernel.load(exec, parsed.data.courseId, who, 'none');
    if (!loaded.ok) return loaded;
    const role = decideCourseRead(loaded.value.role);
    if (!role.ok) return role;
    const snap = await snapshot(exec, loaded.value, false);
    const { course } = loaded.value;
    const plan = planPublish(course, snap.shapes, { isAdmin: who.isAdmin });
    const missingFields = missingPublishFields(course, snap.shapes);
    const blockingIds = new Set(
      !plan.ok && plan.error.details?.blockingSectionIds
        ? String(plan.error.details.blockingSectionIds).split(',')
        : [],
    );
    const changing = new Set(plan.ok ? changingIds(plan.value) : []);
    const links = plan.ok ? await blockedLinks(exec, snap, plan.value) : null;
    const missingCaptionLessonIds = plan.ok
      ? missingCaptions(lessonsBeingPublished(snap, plan.value))
      : [];
    const named = new Set([...missingCaptionLessonIds, ...(links?.lessonIds ?? [])]);
    const sectionOfVersion = new Map(
      [...snap.working].map(([sectionId, v]) => [v.sectionVersionId, sectionId]),
    );
    const namedLessons = [...snap.lessonsByVersion.values()]
      .flat()
      .filter(
        (l) => named.has(l.lesson.lessonId) && sectionOfVersion.has(l.version.sectionVersionId),
      )
      .map((l) => ({
        lessonId: l.lesson.lessonId,
        sectionId: sectionOfVersion.get(l.version.sectionVersionId) as string,
        titleBn: l.version.titleBn,
        titleEn: l.version.titleEn,
      }));
    return ok({
      courseId: course.courseId,
      status: course.status,
      courseVersion: course.version,
      missingFields,
      sections: snap.shapes
        .filter((s) => s.structureState !== 'removed')
        .map((s) => {
          const w = snap.working.get(s.sectionId);
          return {
            sectionId: s.sectionId,
            structureState: s.structureState,
            workingVersionId: w?.sectionVersionId ?? null,
            workingVersion: w?.version ?? null,
            reviewState: w?.reviewState ?? null,
            isComplete: s.working?.isComplete ?? false,
            willPublish: changing.has(s.sectionId),
            isBlocking: blockingIds.has(s.sectionId),
          };
        }),
      missingCaptionLessonIds,
      blockedLinkLessonIds: links?.lessonIds ?? [],
      lessons: namedLessons,
      refusalKey: plan.ok ? (links ? 'errors.catalog.blockedLink' : null) : plan.error.i18nKey,
    });
  }

  // ---------------------------------------------------------------- UC15 publish

  async function publishCourse(
    actor: Actor,
    raw: unknown,
    correlationId: string,
  ): Promise<
    Result<
      {
        courseId: string;
        version: number;
        publishedSectionIds: string[];
        leftOutSectionIds: string[];
      },
      Failure
    >
  > {
    const input = PublishCourseInput.parse(raw);
    const who = kernel.courseActor(actor);
    const context = { actor, operation: 'publishCourse', courseId: input.courseId };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const loaded = await kernel.load(exec, input.courseId, who, 'update');
      if (!loaded.ok) return loaded;
      const allowed = decideLeadAction(loaded.value.role, who);
      if (!allowed.ok) return allowed;
      const { course } = loaded.value;
      const version = checkVersion(course.version, input.expectedVersion);
      if (!version.ok) return version;
      const snap = await snapshot(exec, loaded.value, true);
      const plan = planPublish(course, snap.shapes, { isAdmin: who.isAdmin });
      if (!plan.ok) return plan;
      // BR12.1, BR12.2: every copy this publish changes must be exactly the one the dialog showed.
      const sent = new Map(input.sectionVersions.map((v) => [v.sectionId, v.expectedVersion]));
      for (const sectionId of changingIds(plan.value)) {
        const w = snap.working.get(sectionId) as SectionVersionRow;
        if (sent.get(sectionId) !== w.version) return err(staleVersion(w.version));
      }
      const links = await blockedLinks(exec, snap, plan.value);
      if (links) {
        log.warn(
          {
            event: 'catalog.publish_refused',
            reason: 'blockedLink',
            actorId: actor.userId,
            courseId: course.courseId,
            blockedDomainIds: links.blockedDomainIds,
            correlationId,
          },
          'publish refused: blocked link',
        );
        return err(validationFailed(links.fieldErrors));
      }
      const captions = checkCaptionsConfirmed(
        missingCaptions(lessonsBeingPublished(snap, plan.value)),
        input.acknowledgedMissingCaptions,
      );
      if (!captions.ok) return captions;
      const at = kernel.now();
      await applyPublish(exec, snap, plan.value, actor.userId, at);
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        {
          status: 'published',
          lastPublishedAt: at,
          ...(course.firstPublishedAt ? {} : { firstPublishedAt: at }),
        },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      const action = course.status === 'draft' ? 'published' : 'republished';
      const published = changingIds(plan.value).map(
        (id) => (snap.working.get(id) as SectionVersionRow).sectionVersionId,
      );
      await kernel.deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.published',
        subjectType: 'course',
        subjectId: course.courseId,
        before: { status: course.status },
        after: {
          status: 'published',
          kind: action,
          publishedSectionVersionIds: published,
          adminApprovedSectionIds: plan.value.adminApprove,
          removedSectionIds: plan.value.remove,
          leftOutSectionIds: plan.value.leftOut,
        },
        correlationId,
      });
      await emitLifecycle(tx, course, action, actor.userId, at, updated.row.version, correlationId);
      return ok({
        courseId: course.courseId,
        version: updated.row.version,
        publishedSectionIds: changingIds(plan.value),
        leftOutSectionIds: plan.value.leftOut,
      });
    });
  }

  /** BR9.3, BR9.7, BR8.12, BR7.4: the publish effects, at one instant for the whole transaction. */
  async function applyPublish(
    exec: Executor,
    snap: Snapshot,
    plan: PublishPlan,
    actorId: string,
    at: Date,
  ): Promise<void> {
    const sectionById = new Map(snap.loaded.sections.map((s) => [s.sectionId, s]));
    for (const sectionId of plan.adminApprove) {
      const w = snap.working.get(sectionId) as SectionVersionRow;
      const approved = await sections.updateVersion(exec, w.sectionVersionId, w.version, {
        reviewState: 'approved',
        approvedAt: at,
      });
      await ownership.addReview(exec, {
        sectionId,
        sectionVersionId: w.sectionVersionId,
        action: 'admin_approved',
        fromState: w.reviewState as WorkingState,
        toState: 'approved',
        actorId,
        decidedAt: at,
      });
      snap.working.set(sectionId, approved as SectionVersionRow);
    }
    for (const sectionId of changingIds(plan)) {
      const copy = snap.working.get(sectionId) as SectionVersionRow;
      const old = snap.live.get(sectionId);
      const section = sectionById.get(sectionId) as SectionRow;
      if (old) {
        await sections.updateVersion(exec, old.sectionVersionId, old.version, {
          reviewState: 'superseded',
          supersededAt: at,
        });
      }
      await sections.updateVersion(exec, copy.sectionVersionId, copy.version, {
        reviewState: 'published',
        publishedAt: at,
      });
      await ownership.addReview(exec, {
        sectionId,
        sectionVersionId: copy.sectionVersionId,
        action: 'published',
        fromState: 'approved',
        toState: 'published',
        actorId,
        decidedAt: at,
      });
      await sections.update(exec, sectionId, {
        liveVersionId: copy.sectionVersionId,
        workingVersionId: null,
        ...(section.firstPublishedAt ? {} : { firstPublishedAt: at }),
      });
      const next = snap.lessonsByVersion.get(copy.sectionVersionId) ?? [];
      const previous = old ? (snap.lessonsByVersion.get(old.sectionVersionId) ?? []) : [];
      const kept = new Set(next.map((l) => l.lesson.lessonId));
      await lessons.updateLesson(
        exec,
        next.filter((l) => l.lesson.liveState === 'never_published').map((l) => l.lesson.lessonId),
        { liveState: 'live', firstPublishedAt: at },
      );
      await lessons.updateLesson(
        exec,
        previous
          .filter((l) => !kept.has(l.lesson.lessonId) && l.lesson.liveState === 'live')
          .map((l) => l.lesson.lessonId),
        { liveState: 'withdrawn', withdrawnAt: at },
      );
    }
    for (const sectionId of plan.remove) {
      await removeAtPublish(exec, snap, sectionById.get(sectionId) as SectionRow, actorId, at);
    }
    for (const [index, sectionId] of plan.order.entries()) {
      const s = sectionById.get(sectionId) as SectionRow;
      if (s.position !== index + 1 || s.pendingPosition !== null) {
        await sections.update(exec, sectionId, { position: index + 1, pendingPosition: null });
      }
    }
  }

  /** BR8.12 case B at publish: live → superseded, copy discarded, live lessons withdrawn. */
  async function removeAtPublish(
    exec: Executor,
    snap: Snapshot,
    section: SectionRow,
    actorId: string,
    at: Date,
  ): Promise<void> {
    const live = snap.live.get(section.sectionId);
    const working = snap.working.get(section.sectionId);
    if (live) {
      await sections.updateVersion(exec, live.sectionVersionId, live.version, {
        reviewState: 'superseded',
        supersededAt: at,
      });
      const liveLessons = snap.lessonsByVersion.get(live.sectionVersionId) ?? [];
      await lessons.updateLesson(
        exec,
        liveLessons.filter((l) => l.lesson.liveState === 'live').map((l) => l.lesson.lessonId),
        { liveState: 'withdrawn', withdrawnAt: at },
      );
    }
    if (working) {
      await sections.updateVersion(exec, working.sectionVersionId, working.version, {
        reviewState: 'discarded',
      });
      await ownership.addReview(exec, {
        sectionId: section.sectionId,
        sectionVersionId: working.sectionVersionId,
        action: 'discarded',
        fromState: working.reviewState as WorkingState,
        toState: 'discarded',
        actorId,
        decidedAt: at,
      });
    }
    const open = snap.loaded.open.get(section.sectionId);
    if (open) await ownership.close(exec, open.sectionOwnershipId, open.version, at);
    await sections.update(exec, section.sectionId, {
      structureState: 'removed',
      removedAt: at,
      liveVersionId: null,
      workingVersionId: null,
      pendingPosition: null,
    });
  }

  /**
   * SD-219, NFR6.217: one outbox event per lifecycle change, IDs only, in the same transaction. BR9.6:
   * in that same transaction every Admin except the actor gets notify.catalog.coursePublished
   * (contract 4 notify, IDs and enums only, BR12.4), so a rolled-back change notifies nobody.
   */
  async function emitLifecycle(
    tx: TxHandle,
    course: CourseRow,
    action: 'published' | 'republished' | 'unpublished' | 'retired',
    actorId: string,
    at: Date,
    courseVersion: number,
    correlationId: string,
  ): Promise<void> {
    const payload = CoursePublishedV1.parse({
      courseId: course.courseId,
      goalId: course.goalId,
      action,
      actorId,
      occurredAt: at.toISOString(),
    });
    await kernel.deps.outbox.publish(tx, {
      ...COURSE_PUBLISHED,
      aggregateKey: course.courseId,
      occurredAt: payload.occurredAt,
      payload,
      correlationId,
    });
    const admins = await staff.adminUserIds(unwrapTx(tx));
    for (const recipientUserId of admins) {
      if (recipientUserId === actorId) continue;
      await kernel.deps.notify(
        tx,
        {
          recipientUserId,
          templateKey: COURSE_PUBLISHED_TYPE,
          dedupeKey: `${COURSE_PUBLISHED_TYPE}:${course.courseId}:${courseVersion}`,
          params: { courseId: course.courseId, action },
          channels: ['in_app'],
          priority: 'normal',
        },
        correlationId,
      );
    }
  }

  // ---------------------------------------------------------------- UC16 unpublish and retire

  async function changeStatus(
    event: 'unpublish' | 'retire',
    actor: Actor,
    raw: unknown,
    correlationId: string,
  ): Promise<Result<{ courseId: string; status: string; version: number }, Failure>> {
    const input = CourseTransitionInput.parse(raw);
    const who = kernel.courseActor(actor);
    const context = { actor, operation: `${event}Course`, courseId: input.courseId };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const loaded = await kernel.loadForLeadWrite(
        exec,
        input.courseId,
        who,
        input.expectedVersion,
      );
      if (!loaded.ok) return loaded;
      const { course } = loaded.value;
      const segments = await kernel.deps.trialSegmentsOf(course.courseId);
      const next = transitionCourse(course.status, event, { isTrialCourse: segments.length > 0 });
      if (!next.ok) {
        if (next.error.code === 'CONFLICT') {
          return err({ ...isTrialCourse(), details: { segmentIds: segments.join(',') } });
        }
        return next;
      }
      // BR10.8: a course in a published plan's current version stays until a new version drops it.
      const inPlan = checkNotInCurrentPlan(
        await products.currentPlansIncluding(exec, { type: 'course', id: course.courseId }),
      );
      if (!inPlan.ok) return inPlan;
      const at = kernel.now();
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        event === 'unpublish'
          ? { status: 'unpublished', unpublishedAt: at }
          : { status: 'retired', retiredAt: at },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      const action = event === 'unpublish' ? 'unpublished' : 'retired';
      await kernel.deps.audit.record(tx, {
        actorId: actor.userId,
        action: `catalog.course.${action}`,
        subjectType: 'course',
        subjectId: course.courseId,
        before: { status: course.status },
        after: { status: next.value },
        correlationId,
      });
      await emitLifecycle(tx, course, action, actor.userId, at, updated.row.version, correlationId);
      return ok({ courseId: course.courseId, status: next.value, version: updated.row.version });
    });
  }

  /**
   * CR-5 fallback: until the human approves the `unpublished` product status, unpublish ships behind
   * the flag catalog.unpublish (default off) and answers FEATURE_DISABLED.
   */
  async function unpublishCourse(actor: Actor, raw: unknown, correlationId: string) {
    if (!(await kernel.deps.isFlagEnabled(CATALOG_FLAGS.unpublish, actor.userId))) {
      return err(appError('FEATURE_DISABLED'));
    }
    return changeStatus('unpublish', actor, raw, correlationId);
  }

  async function retireCourse(actor: Actor, raw: unknown, correlationId: string) {
    return changeStatus('retire', actor, raw, correlationId);
  }

  // ---------------------------------------------------------------- course description (BR9.2)

  async function setCourseDescription(
    actor: Actor,
    raw: unknown,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number }, Failure>> {
    const input = SetCourseDescriptionInput.parse(raw);
    const who = kernel.courseActor(actor);
    const context = { actor, operation: 'setCourseDescription', courseId: input.courseId };
    return kernel.write(context, correlationId, async (tx, exec) => {
      const loaded = await kernel.loadForLeadWrite(
        exec,
        input.courseId,
        who,
        input.expectedVersion,
      );
      if (!loaded.ok) return loaded;
      const bn = input.descriptionBn.trim();
      const en = input.descriptionEn.trim();
      const fieldErrors: Record<string, string[]> = {};
      if ([...bn].length > DESCRIPTION_MAX)
        fieldErrors.descriptionBn = ['errors.catalog.descriptionTooLong'];
      if ([...en].length > DESCRIPTION_MAX)
        fieldErrors.descriptionEn = ['errors.catalog.descriptionTooLong'];
      if (Object.keys(fieldErrors).length > 0) return err(validationFailed(fieldErrors));
      const { course } = loaded.value;
      const at = kernel.now();
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        { descriptionBn: bn || null, descriptionEn: en || null },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      // Lengths only: the description text never enters the audit log (NFR5.203).
      await kernel.deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.descriptionChanged',
        subjectType: 'course',
        subjectId: course.courseId,
        after: { bnLength: [...bn].length, enLength: [...en].length },
        correlationId,
      });
      return ok({ courseId: course.courseId, version: updated.row.version });
    });
  }

  // ---------------------------------------------------------------- BR4.9 validator

  /** BR4.9: catalog.publishedCourse — a well-formed ID of a course whose status is published. */
  async function isPublishedCourse(value: unknown): Promise<boolean> {
    if (!Id.safeParse(value).success) return false;
    return (await courses.status(kernel.deps.db, value as string)) === 'published';
  }

  return {
    getPublishReadiness,
    publishCourse,
    unpublishCourse,
    retireCourse,
    setCourseDescription,
    isPublishedCourse,
  };
}
