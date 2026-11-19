// Catalog core service (UC7–UC11, UC24; CR-4, CR-7). Every write runs in one transaction that
// takes the course row lock first (lock order course → section → section_version; PD-209), checks
// the caller's derived role and the version token, applies the change and writes its audit entry
// (BR12.3) and notifications (BR12.4). A refused write changes nothing and logs one line with the
// reason code and IDs only (BR6.10, NFR6.203). Authoring is rate-limited per instructor (NFR6.216).
import type { Logger } from 'pino';

import { checkGoalAcceptsNewProducts } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { Audit, SettingKey } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Database, type Executor, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createBlockedDomainRepository } from '../data/blocked-domain.repository.ts';
import { type CourseRow, createCourseRepository } from '../data/course.repository.ts';
import { createLessonRepository } from '../data/lesson.repository.ts';
import { createOwnershipRepository, type PeriodRow } from '../data/ownership.repository.ts';
import { createRateLimitRepository } from '../data/rate-limit.repository.ts';
import { createSectionRepository, type SectionRow } from '../data/section.repository.ts';
import { SECTION_ASSIGNED_TYPE } from '../domain/catalog-notifications.ts';
import { CATALOG_SETTINGS } from '../domain/catalog-settings.ts';
import {
  type CourseActor,
  type CourseRole,
  canManageCourse,
  checkCourseEditable,
  checkDurationEditable,
  checkNotUnderTakedown,
  checkVersion,
  decideCourseRead,
  decideDurationLock,
  decideLeadAction,
  decideSectionEdit,
  deriveCourseRole,
  invalidState,
  notFound,
  staleVersion,
  validateTitles,
  validationFailed,
} from '../domain/course.ts';
import { createLinkValidator, type ToAscii } from '../domain/link-validator.ts';
import {
  assignmentReason,
  checkAssignment,
  type OwnershipReason,
  planLeadChange,
  planOwnershipChange,
  workingCopyAfterReassignment,
} from '../domain/ownership.ts';
import { checkAccessDuration, checkCoursePrice, parseTakaToPoisha } from '../domain/pricing.ts';
import {
  checkSectionWritable,
  planAddSection,
  planRemoval,
  planReorder,
  type SectionShape,
  transitionSection,
} from '../domain/sections.ts';
import type {
  AddSectionInput,
  AssignSectionInput,
  ChangeLeadInput,
  CreateCourseInput,
  EditSectionTitleInput,
  PageInput,
  RemoveCoInstructorInput,
  ReorderSectionsInput,
  SectionStructureInput,
  SetAccessDurationInput,
  SetCoursePriceInput,
} from './catalog.schema.ts';
import {
  AddSectionInput as AddSectionSchema,
  AssignSectionInput as AssignSectionSchema,
  ChangeLeadInput as ChangeLeadSchema,
  CreateCourseInput as CreateCourseSchema,
  EditSectionTitleInput as EditSectionTitleSchema,
  PageInput as PageSchema,
  RemoveCoInstructorInput as RemoveCoInstructorSchema,
  ReorderSectionsInput as ReorderSectionsSchema,
  SectionStructureInput as SectionStructureSchema,
  SetAccessDurationInput as SetAccessDurationSchema,
  SetCoursePriceInput as SetCoursePriceSchema,
} from './catalog.schema.ts';
import { type BrowseDeps, createBrowseService } from './catalog-browse.server.ts';
import { createContentService } from './catalog-content.server.ts';
import { createContractReads } from './catalog-contract.server.ts';
import type { CatalogKernel } from './catalog-kernel.ts';
import { createPinService } from './catalog-pins.server.ts';
import { createProductService } from './catalog-products.server.ts';
import { createPublishService } from './catalog-publish.server.ts';
import { createReviewService } from './catalog-review.server.ts';
import { createTrustService } from './catalog-trust.server.ts';
import { type LimitKind, limitWindow } from './limits.ts';

export type CatalogDeps = {
  db: Database;
  clock: Clock;
  audit: Audit;
  /** Contract 4 notify(): enqueues a NotificationRequested event in the caller's transaction. */
  notify(
    tx: TxHandle,
    request: {
      recipientUserId: string;
      templateKey: string;
      dedupeKey: string;
      params: Record<string, string | number | boolean>;
      channels: Array<'in_app' | 'push' | 'email' | 'sms'>;
      priority: 'normal' | 'high';
    },
    correlationId: string,
  ): Promise<void>;
  /** Contract 2 settings read of an integer-poisha setting; SETTING_NOT_SET when unset. */
  readPoisha(key: SettingKey<number>): Promise<Result<number, AppError<'SETTING_NOT_SET'>>>;
  /** Contract 3 hasRole (BR4.1, BR6.3). */
  hasInstructorRole(userId: string): Promise<boolean>;
  /** Keyed hash of a user ID for rate-limit keys (no raw identifier is stored). */
  hashId(userId: string): string;
  /** Contract 2 outbox.publish, in the caller's transaction (ADR-006). */
  outbox: {
    publish<P>(
      tx: TxHandle,
      event: {
        type: string;
        version: number;
        aggregateKey: string;
        occurredAt: string;
        payload: P;
        correlationId: string;
      },
    ): Promise<void>;
  };
  /** Contract 3 flags.isEnabled; an unknown flag is off (U1 BR8.2). */
  isFlagEnabled(flagKey: string, userId: string): Promise<boolean>;
  /**
   * BR4.8: the segments whose trial.policy names this course as their trial course. The unit that
   * declares trial.policy supplies it; until then no course is a trial course.
   */
  trialSegmentsOf(courseId: string): Promise<string[]>;
  /** IDNA to ASCII for link hosts and blocked-list entries (node:url domainToASCII; SD-210). */
  toAscii: ToAscii;
  log: Logger;
  /**
   * OD-207 moderation signals raised at refusal time (link refusals, the course-creation limit).
   * Optional: tests that do not exercise moderation leave it out. A signal never changes the answer.
   */
  moderation?: {
    linkRefused(instructorId: string, correlationId: string): Promise<void>;
    courseCreateLimitReached(instructorId: string, correlationId: string): Promise<void>;
  };
  /** The S3 / S4 read module's ports (Bolt 4). The app always wires them; a test may leave them out. */
  browse?: BrowseDeps;
};

type Failure = AppError;

export type SectionEditorView = {
  sectionId: string;
  position: number;
  pendingPosition: number | null;
  structureState: SectionRow['structureState'];
  titleBn: string;
  titleEn: string;
  ownerId: string | null;
  ownershipVersion: number | null;
  workingVersionId: string | null;
  workingVersion: number | null;
  workingReviewState: string | null;
  isLive: boolean;
  canEdit: boolean;
};

export type CourseEditorView = {
  course: {
    courseId: string;
    goalId: string;
    titleBn: string;
    titleEn: string;
    descriptionBn: string | null;
    descriptionEn: string | null;
    status: CourseRow['status'];
    leadInstructorId: string | null;
    listPricePoisha: number | null;
    accessDurationMonths: number | null;
    durationLockedAt: string | null;
    firstPublishedAt: string | null;
    version: number;
  };
  role: CourseRole;
  canManageCourse: boolean;
  /** The caller, so the editor can mark the sections they own. */
  viewerId: string;
  sections: SectionEditorView[];
};

/** Thrown inside a transaction to roll it back and report the refusal (nothing is kept). */
class Refusal extends Error {
  readonly refusal: Failure;
  constructor(refusal: Failure) {
    super('refused');
    this.refusal = refusal;
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function createCatalog(deps: CatalogDeps) {
  const courses = createCourseRepository();
  const sections = createSectionRepository();
  const ownership = createOwnershipRepository();
  const limits = createRateLimitRepository();
  const lessons = createLessonRepository();
  const blocked = createBlockedDomainRepository();
  const links = createLinkValidator(deps.toAscii);
  const log = deps.log;
  const now = () => new Date(deps.clock.now());

  const courseActor = (actor: Actor): CourseActor => ({
    userId: actor.userId,
    isAdmin: actor.roles.includes('admin'),
  });

  function refused<T>(
    error: Failure,
    context: { actorId: string; operation: string; courseId?: string; sectionId?: string },
    correlationId: string,
  ): Result<T, Failure> {
    const line = { code: error.code, reason: error.i18nKey, ...context, correlationId };
    // BR6.10: a FORBIDDEN catalog write is a security log line, with IDs only.
    if (error.code === 'FORBIDDEN')
      log.warn({ event: 'catalog.write_refused', ...line }, 'refused');
    else log.info(line, 'catalog write refused');
    return err(error);
  }

  /** Runs a write transaction; a refusal rolls everything back and is logged once. */
  async function write<T>(
    context: { actor: Actor; operation: string; courseId?: string; sectionId?: string },
    correlationId: string,
    fn: (tx: TxHandle, exec: Executor) => Promise<Result<T, Failure>>,
  ): Promise<Result<T, Failure>> {
    const logContext = {
      actorId: context.actor.userId,
      operation: context.operation,
      ...(context.courseId ? { courseId: context.courseId } : {}),
      ...(context.sectionId ? { sectionId: context.sectionId } : {}),
    };
    const admitted = await admit(context.actor, context.operation === 'createCourse');
    if (!admitted.ok) {
      if (admitted.error.details?.limit === 'courseCreate') {
        await signal('courseCreateLimit', () =>
          deps.moderation?.courseCreateLimitReached(context.actor.userId, correlationId),
        );
      }
      return refused(admitted.error, logContext, correlationId);
    }
    try {
      return await withTransaction(deps.db, async (tx) => {
        const result = await fn(tx, unwrapTx(tx));
        if (!result.ok) throw new Refusal(result.error);
        return result;
      });
    } catch (error) {
      if (error instanceof Refusal) return refused(error.refusal, logContext, correlationId);
      throw error;
    }
  }

  /** OD-207: raises a moderation signal; a failure is logged and never changes the caller's answer. */
  async function signal(kind: string, raise: () => Promise<void> | undefined): Promise<void> {
    try {
      await raise();
    } catch (error) {
      log.warn({ err: error, code: 'MODERATION_SIGNAL_FAILED', signal: kind }, 'signal failed');
    }
  }

  // ---------------------------------------------------------------- rate limits (NFR6.216)

  async function consume(kind: LimitKind, userId: string): Promise<Result<void, Failure>> {
    const window = limitWindow(kind, now());
    const bucketKey = `catalog.${kind}:${deps.hashId(userId)}`;
    const isAdmitted = await limits.consume(deps.db, { bucketKey, ...window });
    if (isAdmitted) return ok(undefined);
    const started = (await limits.windowStartedAt(deps.db, bucketKey)) ?? now();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((window.endsAt(started).getTime() - now().getTime()) / 1000),
    );
    return err(appError('RATE_LIMITED', { details: { retryAfterSeconds, limit: kind } }));
  }

  /** Instructors only; Admins keep U1's general limit (NFR6.216). */
  async function admit(actor: Actor, isCourseCreation: boolean): Promise<Result<void, Failure>> {
    if (actor.roles.includes('admin')) return ok(undefined);
    const authoring = await consume('authoring', actor.userId);
    if (!authoring.ok || !isCourseCreation) return authoring;
    return consume('courseCreate', actor.userId);
  }

  // ---------------------------------------------------------------- loading under locks

  type Loaded = {
    course: CourseRow;
    sections: SectionRow[];
    open: Map<string, PeriodRow>;
    role: CourseRole | null;
  };

  /** Locks the course (and its sections, in ID order) and derives the caller's role (BR6.1). */
  async function load(
    exec: Executor,
    courseId: string,
    actor: CourseActor,
    lock: 'update' | 'share' | 'none',
  ): Promise<Result<Loaded, AppError<'NOT_FOUND'>>> {
    const course =
      lock === 'update'
        ? await courses.getForUpdate(exec, courseId)
        : lock === 'share'
          ? await courses.getForShare(exec, courseId)
          : await courses.get(exec, courseId);
    if (!course) return err(notFound());
    const rows = await sections.listForCourse(exec, courseId, { forUpdate: lock === 'update' });
    const kept = rows.filter((s) => s.structureState !== 'removed');
    const periods = await ownership.openForSections(
      exec,
      kept.map((s) => s.sectionId),
    );
    const open = new Map(periods.map((p) => [p.sectionId, p]));
    const role = deriveCourseRole(
      {
        leadInstructorId: course.leadInstructorId,
        openOwnerIds: periods.map((p) => p.instructorId),
      },
      actor,
    );
    return ok({ course, sections: rows, open, role });
  }

  /** Loads for a Lead-only course write: role, editability and the Course.version token. */
  async function loadForLeadWrite(
    exec: Executor,
    courseId: string,
    actor: CourseActor,
    expectedVersion: number,
    /** A state check that must win over a stale token (e.g. BR5.7 durationLocked). */
    beforeVersionCheck?: (course: CourseRow) => Result<void, Failure>,
  ): Promise<Result<Loaded, Failure>> {
    const loaded = await load(exec, courseId, actor, 'update');
    if (!loaded.ok) return loaded;
    const allowed = decideLeadAction(loaded.value.role, actor);
    if (!allowed.ok) return allowed;
    const hidden = checkNotUnderTakedown(loaded.value.course.status === 'hidden');
    if (!hidden.ok) return hidden;
    const editable = checkCourseEditable(loaded.value.course.status);
    if (!editable.ok) return editable;
    const state = beforeVersionCheck?.(loaded.value.course);
    if (state && !state.ok) return state;
    const version = checkVersion(loaded.value.course.version, expectedVersion);
    if (!version.ok) return version;
    return loaded;
  }

  /** Bumps Course.version (the token of section add, reorder and remove; BR12.1). */
  async function bumpCourse(exec: Executor, course: CourseRow): Promise<Result<number, Failure>> {
    const updated = await courses.update(exec, course.courseId, course.version, {}, now());
    return updated.kind === 'applied' ? ok(updated.row.version) : err(staleVersion(course.version));
  }

  function shapes(loaded: Loaded): SectionShape[] {
    return loaded.sections.map((s) => ({
      sectionId: s.sectionId,
      position: s.position,
      pendingPosition: s.pendingPosition,
      structureState: s.structureState,
      isLive: s.liveVersionId !== null,
      isUnderTakedown: s.hiddenByTakedownNoticeId !== null,
    }));
  }

  /** A new section with a draft working copy and, when the course has a Lead, its default owner. */
  async function insertSection(
    exec: Executor,
    input: {
      course: CourseRow;
      titles: { titleBn: string; titleEn: string };
      position: number;
      pendingPosition: number | null;
      actorId: string;
      at: Date;
    },
  ): Promise<SectionRow> {
    const row = await sections.insert(exec, {
      courseId: input.course.courseId,
      position: input.position,
      pendingPosition: input.pendingPosition,
      createdAt: input.at,
    });
    const working = await sections.insertVersion(exec, {
      sectionId: row.sectionId,
      versionNumber: 1,
      ...input.titles,
      createdAt: input.at,
    });
    await sections.update(exec, row.sectionId, { workingVersionId: working.sectionVersionId });
    if (input.course.leadInstructorId) {
      // BR6.4: the Lead owns every section nobody else is assigned to.
      await ownership.open(exec, {
        sectionId: row.sectionId,
        instructorId: input.course.leadInstructorId,
        validFrom: input.at,
        assignedBy: input.actorId,
        reason: 'default_lead',
      });
    }
    return row;
  }

  // ---------------------------------------------------------------- UC7 create (BR4.1, BR4.2)

  async function createCourse(
    actor: Actor,
    raw: CreateCourseInput,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number }, Failure>> {
    const input = CreateCourseSchema.parse(raw);
    const who = courseActor(actor);
    return write({ actor, operation: 'createCourse' }, correlationId, async (tx, exec) => {
      const titles = validateTitles(input);
      if (!titles.ok) return titles;
      const sectionTitles = [];
      for (const [index, section] of input.sections.entries()) {
        const valid = validateTitles(section, `sections.${index}.`);
        if (!valid.ok) return valid;
        sectionTitles.push(valid.value);
      }
      const goal = checkGoalAcceptsNewProducts(await courses.goalStatus(exec, input.goalId));
      if (!goal.ok) return goal;
      // BR4.1: an Instructor becomes the Lead; an Admin may name one who holds the Instructor role.
      let leadInstructorId: string | null = who.isAdmin ? null : actor.userId;
      if (who.isAdmin && input.leadInstructorId) {
        if (!(await deps.hasInstructorRole(input.leadInstructorId))) {
          return err(validationFailed({ leadInstructorId: ['errors.catalog.leadNotInstructor'] }));
        }
        leadInstructorId = input.leadInstructorId;
      }
      const at = now();
      const course = await courses.insert(exec, {
        goalId: input.goalId,
        ...titles.value,
        leadInstructorId,
        createdBy: actor.userId,
        createdAt: at,
        updatedAt: at,
      });
      for (const [index, sectionTitle] of sectionTitles.entries()) {
        await insertSection(exec, {
          course,
          titles: sectionTitle,
          position: index + 1,
          pendingPosition: null,
          actorId: actor.userId,
          at,
        });
      }
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.created',
        subjectType: 'course',
        subjectId: course.courseId,
        after: {
          goalId: course.goalId,
          status: course.status,
          leadInstructorId,
          sectionCount: sectionTitles.length,
        },
        correlationId,
      });
      return ok({ courseId: course.courseId, version: course.version });
    });
  }

  // ---------------------------------------------------------------- I1 reads

  async function listMyCourses(actor: Actor, raw: PageInput) {
    const page = PageSchema.parse(raw);
    const result = await courses.listForInstructor(deps.db, actor.userId, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return ok({
      page: page.page,
      total: result.total,
      rows: result.rows.map((c) => ({
        courseId: c.courseId,
        titleBn: c.titleBn,
        titleEn: c.titleEn,
        status: c.status,
        isLead: c.leadInstructorId === actor.userId,
        listPricePoisha: c.listPricePoisha,
        accessDurationMonths: c.accessDurationMonths,
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  }

  async function getCourseForEditing(
    actor: Actor,
    courseId: string,
  ): Promise<Result<CourseEditorView, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(courseId).success) return err(notFound());
    const who = courseActor(actor);
    const loaded = await load(deps.db, courseId, who, 'none');
    if (!loaded.ok) return loaded;
    const role = decideCourseRead(loaded.value.role);
    if (!role.ok) return role;
    const { course } = loaded.value;
    const kept = loaded.value.sections.filter((s) => s.structureState !== 'removed');
    const versionIds = kept.flatMap((s) =>
      [s.workingVersionId, s.liveVersionId].filter((v): v is string => v !== null),
    );
    const versions = new Map(
      (await sections.versionsByIds(deps.db, versionIds)).map((v) => [v.sectionVersionId, v]),
    );
    const view = kept.map((s): SectionEditorView => {
      const working = s.workingVersionId ? versions.get(s.workingVersionId) : undefined;
      const shown = working ?? (s.liveVersionId ? versions.get(s.liveVersionId) : undefined);
      const owner = loaded.value.open.get(s.sectionId);
      const ownerId = owner?.instructorId ?? null;
      const canEdit =
        s.structureState === 'active' &&
        checkCourseEditable(course.status).ok &&
        decideSectionEdit(role.value, who, ownerId).ok &&
        (working === undefined || working.reviewState === 'draft');
      return {
        sectionId: s.sectionId,
        position: s.position,
        pendingPosition: s.pendingPosition,
        structureState: s.structureState,
        titleBn: shown?.titleBn ?? '',
        titleEn: shown?.titleEn ?? '',
        ownerId,
        ownershipVersion: owner?.version ?? null,
        workingVersionId: working?.sectionVersionId ?? null,
        workingVersion: working?.version ?? null,
        workingReviewState: working?.reviewState ?? null,
        isLive: s.liveVersionId !== null,
        canEdit,
      };
    });
    return ok({
      course: {
        courseId: course.courseId,
        goalId: course.goalId,
        titleBn: course.titleBn,
        titleEn: course.titleEn,
        descriptionBn: course.descriptionBn,
        descriptionEn: course.descriptionEn,
        status: course.status,
        leadInstructorId: course.leadInstructorId,
        listPricePoisha: course.listPricePoisha,
        accessDurationMonths: course.accessDurationMonths,
        durationLockedAt: iso(course.durationLockedAt),
        firstPublishedAt: iso(course.firstPublishedAt),
        version: course.version,
      },
      role: role.value,
      canManageCourse: canManageCourse(role.value, who),
      viewerId: actor.userId,
      sections: view,
    });
  }

  // ---------------------------------------------------------------- UC8 price (BR5.1–BR5.4)

  async function setCoursePrice(
    actor: Actor,
    raw: SetCoursePriceInput,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number; listPricePoisha: number }, Failure>> {
    const input = SetCoursePriceSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'setCoursePrice', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion);
      if (!loaded.ok) return loaded;
      const [min, max] = await Promise.all([
        deps.readPoisha(CATALOG_SETTINGS.coursePriceMinPoisha),
        deps.readPoisha(CATALOG_SETTINGS.coursePriceMaxPoisha),
      ]);
      if (!min.ok) return min;
      if (!max.ok) return max;
      const parsed = parseTakaToPoisha(input.price);
      if (!parsed.ok) return parsed;
      const price = checkCoursePrice(parsed.value, { minPoisha: min.value, maxPoisha: max.value });
      if (!price.ok) return price;
      const { course } = loaded.value;
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        { listPricePoisha: price.value },
        now(),
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      // BR5.4: the change applies to new checkouts; old and new poisha are audited together.
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.priceChanged',
        subjectType: 'course',
        subjectId: course.courseId,
        before: { listPricePoisha: course.listPricePoisha },
        after: { listPricePoisha: price.value },
        correlationId,
      });
      return ok({
        courseId: course.courseId,
        version: updated.row.version,
        listPricePoisha: price.value,
      });
    });
  }

  // ---------------------------------------------------------------- UC9 duration (BR5.5–BR5.7)

  async function setAccessDuration(
    actor: Actor,
    raw: SetAccessDurationInput,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number; accessDurationMonths: number }, Failure>> {
    const input = SetAccessDurationSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'setAccessDuration', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      // BR5.7, functional-spec §7: the same row lock as lockAccessDuration orders a change against
      // the first enrolment; a change that lost the race is refused durationLocked, not stale.
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion, (c) =>
        checkDurationEditable(iso(c.durationLockedAt)),
      );
      if (!loaded.ok) return loaded;
      const { course } = loaded.value;
      const months = checkAccessDuration(input.months);
      if (!months.ok) return months;
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        { accessDurationMonths: months.value },
        now(),
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.durationChanged',
        subjectType: 'course',
        subjectId: course.courseId,
        before: { accessDurationMonths: course.accessDurationMonths },
        after: { accessDurationMonths: months.value },
        correlationId,
      });
      return ok({
        courseId: course.courseId,
        version: updated.row.version,
        accessDurationMonths: months.value,
      });
    });
  }

  // ---------------------------------------------------------------- UC10 ownership (BR6.2–BR6.6)

  /** BR6.5, BR6.6: closes the open period and opens the next at the same instant. */
  async function changeOwner(
    exec: Executor,
    input: {
      section: SectionRow;
      open: PeriodRow;
      newOwnerId: string;
      reason: OwnershipReason;
      actorId: string;
      at: Date;
    },
  ): Promise<Result<PeriodRow | null, Failure>> {
    const plan = planOwnershipChange(
      { ...input.open, validFrom: input.open.validFrom.toISOString(), validTo: null },
      {
        sectionId: input.section.sectionId,
        newOwnerId: input.newOwnerId,
        at: input.at.toISOString(),
        reason: input.reason,
      },
    );
    if (plan.kind === 'noop') return ok(null);
    const closedAt = new Date(plan.closeAt ?? plan.open.validFrom);
    if (!(await ownership.close(exec, input.open.sectionOwnershipId, input.open.version, closedAt)))
      return err(staleVersion(input.open.version));
    // The open-period token carries forward per section, so a stale client never matches it.
    const opened = await ownership.open(exec, {
      sectionId: input.section.sectionId,
      instructorId: input.newOwnerId,
      validFrom: new Date(plan.open.validFrom),
      assignedBy: input.actorId,
      reason: input.reason,
      version: input.open.version + 1,
    });
    await resetWorkInProgress(exec, input.section, input.actorId, input.at);
    return ok(opened);
  }

  /** BR6.6: a working copy in review goes back to draft for the new owner. */
  async function resetWorkInProgress(
    exec: Executor,
    section: SectionRow,
    actorId: string,
    at: Date,
  ): Promise<void> {
    if (!section.workingVersionId) return;
    const working = await sections.versionForUpdate(exec, section.workingVersionId);
    if (working?.reviewState !== 'in_review') return;
    const next = workingCopyAfterReassignment(working.reviewState);
    await sections.updateVersion(exec, working.sectionVersionId, working.version, {
      reviewState: next.state,
    });
    await ownership.addReview(exec, {
      sectionId: section.sectionId,
      sectionVersionId: working.sectionVersionId,
      action: 'reset_by_reassignment',
      fromState: 'in_review',
      toState: 'draft',
      actorId,
      decidedAt: at,
    });
  }

  async function assignSection(
    actor: Actor,
    raw: AssignSectionInput,
    correlationId: string,
  ): Promise<Result<{ sectionId: string; ownershipVersion: number }, Failure>> {
    const input = AssignSectionSchema.parse(raw);
    const who = courseActor(actor);
    const context = {
      actor,
      operation: 'assignSection',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await load(exec, input.courseId, who, 'update');
      if (!loaded.ok) return loaded;
      const allowed = decideLeadAction(loaded.value.role, who);
      if (!allowed.ok) return allowed;
      const section = loaded.value.sections.find((s) => s.sectionId === input.sectionId);
      if (!section) return err(notFound());
      // NFR6.219: hidden content cannot be reassigned by anyone.
      const hidden = checkNotUnderTakedown(
        loaded.value.course.status === 'hidden',
        section.hiddenByTakedownNoticeId !== null,
      );
      if (!hidden.ok) return hidden;
      const editable = checkCourseEditable(loaded.value.course.status);
      if (!editable.ok) return editable;
      const writable = checkSectionWritable(section.structureState);
      if (!writable.ok) return writable;
      const open = await ownership.openForUpdate(exec, section.sectionId);
      const ready = checkAssignment({
        hasOpenPeriod: open !== undefined,
        isAssigneeInstructor: await deps.hasInstructorRole(input.assigneeId),
      });
      if (!ready.ok) return ready;
      const current = open as PeriodRow;
      const version = checkVersion(current.version, input.expectedOwnershipVersion);
      if (!version.ok) return version;
      const at = now();
      const changed = await changeOwner(exec, {
        section,
        open: current,
        newOwnerId: input.assigneeId,
        reason: assignmentReason(current.instructorId, loaded.value.course.leadInstructorId),
        actorId: actor.userId,
        at,
      });
      if (!changed.ok) return changed;
      if (!changed.value) {
        return ok({ sectionId: section.sectionId, ownershipVersion: current.version });
      }
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.section.ownerChanged',
        subjectType: 'section',
        subjectId: section.sectionId,
        before: { instructorId: current.instructorId },
        after: { instructorId: input.assigneeId, reason: changed.value.reason },
        correlationId,
      });
      if (input.assigneeId !== actor.userId) {
        await deps.notify(
          tx,
          {
            recipientUserId: input.assigneeId,
            templateKey: SECTION_ASSIGNED_TYPE,
            dedupeKey: `${SECTION_ASSIGNED_TYPE}:${changed.value.sectionOwnershipId}`,
            params: { courseId: input.courseId, sectionId: section.sectionId },
            channels: ['in_app'],
            priority: 'normal',
          },
          correlationId,
        );
      }
      return ok({ sectionId: section.sectionId, ownershipVersion: changed.value.version });
    });
  }

  async function removeCoInstructor(
    actor: Actor,
    raw: RemoveCoInstructorInput,
    correlationId: string,
  ): Promise<Result<{ reassignedSectionIds: string[] }, Failure>> {
    const input = RemoveCoInstructorSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'removeCoInstructor', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await load(exec, input.courseId, who, 'update');
      if (!loaded.ok) return loaded;
      const allowed = decideLeadAction(loaded.value.role, who);
      if (!allowed.ok) return allowed;
      const hidden = checkNotUnderTakedown(loaded.value.course.status === 'hidden');
      if (!hidden.ok) return hidden;
      const editable = checkCourseEditable(loaded.value.course.status);
      if (!editable.ok) return editable;
      const lead = loaded.value.course.leadInstructorId;
      if (!lead || lead === input.instructorId) return err(notFound());
      const owned = loaded.value.sections.filter(
        (s) =>
          s.structureState !== 'removed' &&
          loaded.value.open.get(s.sectionId)?.instructorId === input.instructorId,
      );
      if (owned.length === 0) return err(notFound());
      // BR12.1: the request must name exactly the sections the Co-instructor owns now.
      const expected = new Map(
        input.sections.map((s) => [s.sectionId, s.expectedOwnershipVersion]),
      );
      const isSameSet =
        expected.size === owned.length && owned.every((s) => expected.has(s.sectionId));
      if (!isSameSet) return err(staleVersion(loaded.value.course.version));
      const at = now();
      for (const section of owned) {
        const sectionHidden = checkNotUnderTakedown(section.hiddenByTakedownNoticeId !== null);
        if (!sectionHidden.ok) return sectionHidden;
        const writable = checkSectionWritable(section.structureState);
        if (!writable.ok) return writable;
        const open = (await ownership.openForUpdate(exec, section.sectionId)) as PeriodRow;
        const version = checkVersion(open.version, expected.get(section.sectionId));
        if (!version.ok) return version;
        const changed = await changeOwner(exec, {
          section,
          open,
          newOwnerId: lead,
          reason: 'co_instructor_removed',
          actorId: actor.userId,
          at,
        });
        if (!changed.ok) return changed;
      }
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.coInstructorRemoved',
        subjectType: 'course',
        subjectId: input.courseId,
        before: { instructorId: input.instructorId, sectionIds: owned.map((s) => s.sectionId) },
        after: { instructorId: lead },
        correlationId,
      });
      return ok({ reassignedSectionIds: owned.map((s) => s.sectionId) });
    });
  }

  // ---------------------------------------------------------------- BR4.7 change the Lead (Admin)

  /**
   * BR4.7: only an Admin (the builder's roleFn('admin') with step-up) changes a course's Lead. The new
   * Lead must hold the Instructor role. In one transaction: the course's Lead changes, every live
   * section the old Lead owned is closed and reopened for the new Lead (reason lead_changed, BR6.5,
   * with the BR6.6 work-in-progress reset), unowned sections of a Lead-less course open for the new
   * Lead (BR6.4), and the change is audit-logged. Hidden content refuses it (NFR6.219).
   */
  async function changeLead(
    actor: Actor,
    raw: ChangeLeadInput,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number; movedSectionIds: string[] }, Failure>> {
    const input = ChangeLeadSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'changeLead', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      if (!who.isAdmin) return err(appError('FORBIDDEN'));
      const loaded = await load(exec, input.courseId, who, 'update');
      if (!loaded.ok) return loaded;
      const { course } = loaded.value;
      const version = checkVersion(course.version, input.expectedVersion);
      if (!version.ok) return version;
      const live = loaded.value.sections.filter((x) => x.structureState !== 'removed');
      const hidden = checkNotUnderTakedown(
        course.status === 'hidden',
        ...live.map((x) => x.hiddenByTakedownNoticeId !== null),
      );
      if (!hidden.ok) return hidden;
      const editable = checkCourseEditable(course.status);
      if (!editable.ok) return editable;
      const plan = planLeadChange({
        currentLeadId: course.leadInstructorId,
        newLeadId: input.newLeadId,
        isNewLeadInstructor: await deps.hasInstructorRole(input.newLeadId),
        sections: loaded.value.sections.map((x) => ({
          sectionId: x.sectionId,
          ownerId: loaded.value.open.get(x.sectionId)?.instructorId ?? null,
          isRemoved: x.structureState === 'removed',
        })),
      });
      if (!plan.ok) return plan;
      if (plan.value.kind === 'noop') {
        return ok({ courseId: course.courseId, version: course.version, movedSectionIds: [] });
      }
      const at = now();
      const updated = await courses.update(
        exec,
        course.courseId,
        course.version,
        { leadInstructorId: input.newLeadId },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(course.version));
      const byId = new Map(loaded.value.sections.map((x) => [x.sectionId, x]));
      for (const sectionId of plan.value.move) {
        const section = byId.get(sectionId) as SectionRow;
        const open = (await ownership.openForUpdate(exec, sectionId)) as PeriodRow;
        const changed = await changeOwner(exec, {
          section,
          open,
          newOwnerId: input.newLeadId,
          reason: 'lead_changed',
          actorId: actor.userId,
          at,
        });
        if (!changed.ok) return changed;
      }
      for (const sectionId of plan.value.open) {
        await ownership.open(exec, {
          sectionId,
          instructorId: input.newLeadId,
          validFrom: at,
          assignedBy: actor.userId,
          reason: 'default_lead',
        });
      }
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.course.leadChanged',
        subjectType: 'course',
        subjectId: course.courseId,
        before: { leadInstructorId: course.leadInstructorId },
        after: {
          leadInstructorId: input.newLeadId,
          movedSectionIds: plan.value.move,
          openedSectionIds: plan.value.open,
        },
        correlationId,
      });
      return ok({
        courseId: course.courseId,
        version: updated.row.version,
        movedSectionIds: plan.value.move,
      });
    });
  }

  // ---------------------------------------------------------------- UC11 section edit (BR6.8, BR8.1)

  async function editSectionTitle(
    actor: Actor,
    raw: EditSectionTitleInput,
    correlationId: string,
  ): Promise<Result<{ sectionVersionId: string; version: number }, Failure>> {
    const input = EditSectionTitleSchema.parse(raw);
    const who = courseActor(actor);
    const context = {
      actor,
      operation: 'editSectionTitle',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return write(context, correlationId, async (_tx, exec) => {
      const loaded = await load(exec, input.courseId, who, 'share');
      if (!loaded.ok) return loaded;
      const listed = loaded.value.sections.find((s) => s.sectionId === input.sectionId);
      if (!listed || listed.structureState === 'removed') return err(notFound());
      const owner = loaded.value.open.get(listed.sectionId)?.instructorId ?? null;
      const allowed = decideSectionEdit(loaded.value.role, who, owner);
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
      const titles = validateTitles(input);
      if (!titles.ok) return titles;
      const working = await workingCopyFor(exec, section, input.expectedVersion);
      if (!working.ok) return working;
      const updated = await sections.updateVersion(
        exec,
        working.value.sectionVersionId,
        working.value.version,
        titles.value,
      );
      if (!updated) return err(staleVersion(working.value.version));
      return ok({ sectionVersionId: updated.sectionVersionId, version: updated.version });
    });
  }

  /**
   * BR8.1, BR8.2, BR8.8, BR12.1: the draft working copy to edit. The first edit after a publish
   * copies the live version (checked against its version); a copy in review or approved is
   * read-only until reopened.
   */
  async function workingCopyFor(
    exec: Executor,
    section: SectionRow,
    expectedVersion: number,
  ): Promise<Result<{ sectionVersionId: string; version: number }, Failure>> {
    if (section.workingVersionId) {
      const working = await sections.versionForUpdate(exec, section.workingVersionId);
      if (!working) return err(notFound());
      if (working.reviewState !== 'draft') return err(invalidState('workingCopyReadOnly'));
      const version = checkVersion(working.version, expectedVersion);
      if (!version.ok) return version;
      return ok({ sectionVersionId: working.sectionVersionId, version: working.version });
    }
    const live = section.liveVersionId
      ? await sections.versionForUpdate(exec, section.liveVersionId)
      : undefined;
    if (!live) return err(notFound());
    const version = checkVersion(live.version, expectedVersion);
    if (!version.ok) return version;
    const copy = await sections.insertVersion(exec, {
      sectionId: section.sectionId,
      versionNumber: await sections.nextVersionNumber(exec, section.sectionId),
      titleBn: live.titleBn,
      titleEn: live.titleEn,
      basedOnVersionId: live.sectionVersionId,
      createdAt: now(),
    });
    await sections.copyLessonVersions(exec, live.sectionVersionId, copy.sectionVersionId);
    await sections.update(exec, section.sectionId, { workingVersionId: copy.sectionVersionId });
    return ok({ sectionVersionId: copy.sectionVersionId, version: copy.version });
  }

  // ---------------------------------------------------------------- UC24 structure (BR8.10–BR8.12)

  async function addSection(
    actor: Actor,
    raw: AddSectionInput,
    correlationId: string,
  ): Promise<Result<{ sectionId: string; version: number }, Failure>> {
    const input = AddSectionSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'addSection', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion);
      if (!loaded.ok) return loaded;
      const titles = validateTitles(input);
      if (!titles.ok) return titles;
      const placement = planAddSection(shapes(loaded.value));
      const at = now();
      const row = await insertSection(exec, {
        course: loaded.value.course,
        titles: titles.value,
        ...placement,
        actorId: actor.userId,
        at,
      });
      const bumped = await bumpCourse(exec, loaded.value.course);
      if (!bumped.ok) return bumped;
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.section.added',
        subjectType: 'section',
        subjectId: row.sectionId,
        after: { courseId: input.courseId, position: placement.position },
        correlationId,
      });
      return ok({ sectionId: row.sectionId, version: bumped.value });
    });
  }

  async function reorderSections(
    actor: Actor,
    raw: ReorderSectionsInput,
    correlationId: string,
  ): Promise<Result<{ courseId: string; version: number }, Failure>> {
    const input = ReorderSectionsSchema.parse(raw);
    const who = courseActor(actor);
    const context = { actor, operation: 'reorderSections', courseId: input.courseId };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion);
      if (!loaded.ok) return loaded;
      const isEverPublished = loaded.value.course.firstPublishedAt !== null;
      const plan = planReorder(shapes(loaded.value), input.sectionIds, isEverPublished);
      if (!plan.ok) return plan;
      for (const change of plan.value) {
        await sections.update(exec, change.sectionId, {
          position: change.position,
          pendingPosition: change.pendingPosition,
        });
      }
      const bumped = await bumpCourse(exec, loaded.value.course);
      if (!bumped.ok) return bumped;
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.section.reordered',
        subjectType: 'course',
        subjectId: input.courseId,
        before: { sectionIds: loaded.value.sections.map((s) => s.sectionId) },
        after: { sectionIds: input.sectionIds, isHeldForPublish: isEverPublished },
        correlationId,
      });
      return ok({ courseId: input.courseId, version: bumped.value });
    });
  }

  async function removeSection(
    actor: Actor,
    raw: SectionStructureInput,
    correlationId: string,
  ): Promise<Result<{ sectionId: string; structureState: string; version: number }, Failure>> {
    const input = SectionStructureSchema.parse(raw);
    const who = courseActor(actor);
    const context = {
      actor,
      operation: 'removeSection',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion);
      if (!loaded.ok) return loaded;
      const isEverPublished = loaded.value.course.firstPublishedAt !== null;
      const plan = planRemoval(shapes(loaded.value), input.sectionId, isEverPublished);
      if (!plan.ok) return plan;
      const section = loaded.value.sections.find(
        (s) => s.sectionId === input.sectionId,
      ) as SectionRow;
      const at = now();
      if (plan.value.kind === 'markPending') {
        await sections.update(exec, section.sectionId, {
          structureState: 'removal_pending',
          removalRequestedAt: at,
        });
      } else {
        await removeNow(exec, section, loaded.value.open.get(section.sectionId), actor.userId, at);
        for (const change of plan.value.renumber) {
          await sections.update(exec, change.sectionId, {
            position: change.position,
            pendingPosition: change.pendingPosition,
          });
        }
      }
      const bumped = await bumpCourse(exec, loaded.value.course);
      if (!bumped.ok) return bumped;
      const structureState = plan.value.kind === 'markPending' ? 'removal_pending' : 'removed';
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action:
          structureState === 'removed'
            ? 'catalog.section.removed'
            : 'catalog.section.removalRequested',
        subjectType: 'section',
        subjectId: section.sectionId,
        before: { structureState: section.structureState, position: section.position },
        after: { structureState },
        correlationId,
      });
      return ok({ sectionId: section.sectionId, structureState, version: bumped.value });
    });
  }

  /** BR8.12 case A: removed now; the open period closes; the working copy is discarded. */
  async function removeNow(
    exec: Executor,
    section: SectionRow,
    open: PeriodRow | undefined,
    actorId: string,
    at: Date,
  ): Promise<void> {
    if (open) await ownership.close(exec, open.sectionOwnershipId, open.version, at);
    if (section.workingVersionId) {
      const working = await sections.versionForUpdate(exec, section.workingVersionId);
      if (working && working.reviewState !== 'discarded') {
        const fromState = working.reviewState as 'draft' | 'in_review' | 'approved';
        await sections.updateVersion(exec, working.sectionVersionId, working.version, {
          reviewState: 'discarded',
        });
        await ownership.addReview(exec, {
          sectionId: section.sectionId,
          sectionVersionId: working.sectionVersionId,
          action: 'discarded',
          fromState,
          toState: 'discarded',
          actorId,
          decidedAt: at,
        });
      }
    }
    await sections.update(exec, section.sectionId, {
      structureState: 'removed',
      removedAt: at,
      workingVersionId: null,
      pendingPosition: null,
    });
  }

  async function cancelSectionRemoval(
    actor: Actor,
    raw: SectionStructureInput,
    correlationId: string,
  ): Promise<Result<{ sectionId: string; version: number }, Failure>> {
    const input = SectionStructureSchema.parse(raw);
    const who = courseActor(actor);
    const context = {
      actor,
      operation: 'cancelSectionRemoval',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return write(context, correlationId, async (tx, exec) => {
      const loaded = await loadForLeadWrite(exec, input.courseId, who, input.expectedVersion);
      if (!loaded.ok) return loaded;
      const section = loaded.value.sections.find((s) => s.sectionId === input.sectionId);
      if (!section) return err(notFound());
      const next = transitionSection(
        section.structureState,
        'cancelRemoval',
        section.liveVersionId !== null,
      );
      if (!next.ok) return next;
      await sections.update(exec, section.sectionId, {
        structureState: next.value,
        removalRequestedAt: null,
      });
      const bumped = await bumpCourse(exec, loaded.value.course);
      if (!bumped.ok) return bumped;
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'catalog.section.removalCancelled',
        subjectType: 'section',
        subjectId: section.sectionId,
        before: { structureState: section.structureState },
        after: { structureState: next.value },
        correlationId,
      });
      return ok({ sectionId: section.sectionId, version: bumped.value });
    });
  }

  // ---------------------------------------------------------------- contract 5 (CR-4, CR-7)

  /**
   * CR-4 / BR5.6: called by U3 Commerce inside the first enrolment's transaction. Takes the course
   * row lock, sets durationLockedAt once and returns the locked duration. Idempotent.
   */
  async function lockAccessDuration(
    tx: TxHandle,
    courseId: string,
  ): Promise<
    Result<
      { accessDurationMonths: number; lockedAt: string },
      AppError<'NOT_FOUND' | 'INVALID_STATE'>
    >
  > {
    if (!Id.safeParse(courseId).success) return err(notFound());
    const exec = unwrapTx(tx);
    const course = await courses.getForUpdate(exec, courseId);
    const decision = decideDurationLock(
      course
        ? {
            accessDurationMonths: course.accessDurationMonths,
            durationLockedAt: iso(course.durationLockedAt),
          }
        : undefined,
      deps.clock.now(),
    );
    if (!decision.ok) return decision;
    if (decision.value.isNewLock) {
      const at = new Date(decision.value.lockedAt);
      await courses.update(
        exec,
        courseId,
        (course as CourseRow).version,
        { durationLockedAt: at },
        at,
      );
      await deps.audit.record(tx, {
        actorId: 'system',
        action: 'catalog.course.durationLocked',
        subjectType: 'course',
        subjectId: courseId,
        after: { accessDurationMonths: decision.value.accessDurationMonths },
        correlationId: `catalog.lock:${courseId}`,
      });
    }
    return ok({
      accessDurationMonths: decision.value.accessDurationMonths,
      lockedAt: decision.value.lockedAt,
    });
  }

  /** CR-7 / BR6.9: Lead-only checks for U4 (grade-final settings): the Lead or an Admin. */
  async function assertCourseLead(
    actor: Actor,
    courseId: string,
  ): Promise<Result<void, AppError<'FORBIDDEN' | 'NOT_FOUND'>>> {
    if (!Id.safeParse(courseId).success) return err(notFound());
    const who = courseActor(actor);
    const loaded = await load(deps.db, courseId, who, 'none');
    if (!loaded.ok) return loaded;
    return decideLeadAction(loaded.value.role, who);
  }

  const kernel: CatalogKernel = {
    deps,
    now,
    courseActor,
    links,
    write,
    load,
    loadForLeadWrite,
    workingCopyFor,
    bumpCourse,
    signal,
    repos: { courses, sections, ownership, lessons, blocked },
  };
  const { internal: _contentInternal, ...content } = createContentService(kernel);

  const review = createReviewService(kernel);
  const publishing = createPublishService(kernel);
  const trust = createTrustService(kernel);
  const pins = createPinService(kernel);
  const products = createProductService(kernel);
  const contractReads = createContractReads(kernel, deps.browse?.cursor);
  const browsing = deps.browse ? createBrowseService(kernel, deps.browse) : unwiredBrowse();

  return {
    ...browsing,
    ...pins,
    ...products,
    ...contractReads,
    ...trust,
    ...content,
    ...review,
    ...publishing,
    createCourse,
    listMyCourses,
    getCourseForEditing,
    setCoursePrice,
    setAccessDuration,
    assignSection,
    removeCoInstructor,
    changeLead,
    editSectionTitle,
    addSection,
    reorderSections,
    removeSection,
    cancelSectionRemoval,
    lockAccessDuration,
    assertCourseLead,
    /** NFR6.216 / SD-218: an image upload counts against the authoring limit (Step 44). */
    admitAuthoring: (actor: Actor) => admit(actor, false),
  };
}

/** A Catalog built without browse ports (some tests) fails loudly if a browse read is called. */
function unwiredBrowse(): ReturnType<typeof createBrowseService> {
  const fail = async (): Promise<never> => {
    throw new Error('catalog browse dependencies are not wired');
  };
  return { listCatalog: fail, searchCourses: fail, getCoursePage: fail, getPublishedLesson: fail };
}

export type Catalog = ReturnType<typeof createCatalog>;
