// Section content: lessons in the working copy and the U4 technical-status pushes (UC12, UC21;
// BR3.2, BR3.4, BR7.1–BR7.7, BR8.1, BR8.2, BR12.1; NFR6.207–NFR6.209; CR-8). Every authoring write
// runs through the kernel's write wrapper: course share lock, then section, section version and
// lesson version locks (PD-209). The token rules follow functional-spec assumption 19: list changes
// carry the working copy's SectionVersion.version; one lesson's edit carries its LessonVersion.version
// and also bumps the working copy's version. The blocked-domain list is read on every save, with no
// cache, and a lookup failure throws, so the save fails closed (SD-211, RD-213).
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Executor, unwrapTx } from '#src/server/db.ts';
import type { LessonWithVersion } from '../data/lesson.repository.ts';
import type { SectionRow, SectionVersionRow } from '../data/section.repository.ts';
import {
  checkCourseEditable,
  checkNotUnderTakedown,
  decideCourseRead,
  decideSectionEdit,
  notFound,
  staleVersion,
  validationFailed,
} from '../domain/course.ts';
import {
  type DocumentIssue,
  documentLinks,
  type LessonDocument,
  validateLessonDocument,
} from '../domain/lesson-document.ts';
import { parseYoutubeVideoId, validateQuizQuestions } from '../domain/lesson-media.ts';
import {
  checkQuizLesson,
  checkTextLesson,
  checkVideoLesson,
  isLessonComplete,
  type LessonContent,
  type LessonKind,
  MAX_LESSONS_PER_SECTION,
  type MediaStatus,
  planLessonReorder,
  planMediaPush,
  removalOf,
  renumberAfterRemoval,
  validateLessonTitles,
} from '../domain/lessons.ts';
import { isBlockedBy } from '../domain/link-validator.ts';
import { isLinkRefusal } from '../domain/moderation.ts';
import { checkWorkingCopyEditable } from '../domain/review.ts';
import { checkSectionWritable } from '../domain/sections.ts';
import {
  AddLessonInput,
  EditLessonInput,
  LessonRefInput,
  RemoveLessonInput,
  ReorderLessonsInput,
  SaveQuizQuestionsInput,
  SaveTextLessonBodyInput,
  SectionRefInput,
  SetLessonVideoInput,
} from './catalog-content.schema.ts';
import type { CatalogKernel, Failure, Loaded } from './catalog-kernel.ts';

export type LessonEditorView = {
  lessonId: string;
  kind: LessonKind;
  liveState: 'never_published' | 'live' | 'withdrawn';
  position: number;
  version: number;
  titleBn: string | null;
  titleEn: string | null;
  bodyBn: LessonDocument | null;
  bodyEn: LessonDocument | null;
  videoAssetId: string | null;
  youtubeVideoId: string | null;
  mediaStatus: MediaStatus;
  captionLanguages: string[];
  quizQuestionCount: number;
  isComplete: boolean;
  isUnderTakedown: boolean;
};

export type SectionContentView = {
  courseId: string;
  sectionId: string;
  structureState: SectionRow['structureState'];
  ownerId: string | null;
  isOwner: boolean;
  isLead: boolean;
  canManageCourse: boolean;
  isUnderTakedown: boolean;
  canEdit: boolean;
  /** The token for lesson add, reorder and remove: the working copy's version, else the live one. */
  editVersion: number | null;
  working: {
    sectionVersionId: string;
    version: number;
    reviewState: string;
    titleBn: string;
    titleEn: string;
  } | null;
  live: { sectionVersionId: string; version: number } | null;
  /** The title shown on the page: the working copy's, else the live version's. */
  titleBn: string;
  titleEn: string;
  lessons: LessonEditorView[];
  lastReturnComment: string | null;
};

/** Contract 5 CR-8 inputs, validated even though only in-process U4 code calls them. */
const SetLessonMediaInput = z.object({
  lessonId: Id,
  videoAssetId: Id,
  mediaStatus: z.enum(['processing', 'ready', 'failed']),
  captionLanguages: z
    .array(z.enum(['bn', 'en']))
    .max(2)
    .optional(),
});
const SetQuizContentStatusInput = z.object({
  lessonId: Id,
  questionCount: z.number().int().min(0).max(10_000),
});

export function toLessonContent(row: LessonWithVersion): LessonContent {
  return {
    lessonId: row.lesson.lessonId,
    kind: row.lesson.kind,
    titleBn: row.version.titleBn,
    titleEn: row.version.titleEn,
    bodyBn: row.version.bodyBn as LessonDocument | null,
    bodyEn: row.version.bodyEn as LessonDocument | null,
    videoAssetId: row.version.videoAssetId,
    youtubeVideoId: row.version.youtubeVideoId,
    mediaStatus: row.version.mediaStatus,
    quizQuestionCount: row.version.quizQuestionCount,
  };
}

function lessonView(row: LessonWithVersion): LessonEditorView {
  const content = toLessonContent(row);
  return {
    ...content,
    liveState: row.lesson.liveState,
    position: row.version.position,
    version: row.version.version,
    captionLanguages: row.version.captionLanguages,
    isComplete: isLessonComplete(content),
    isUnderTakedown: row.lesson.hiddenByTakedownNoticeId !== null,
  };
}

export function createContentService(kernel: CatalogKernel) {
  const { sections, lessons, blocked } = kernel.repos;
  const log = kernel.deps.log;

  // ---------------------------------------------------------------- loading for a section write

  type SectionWrite = { loaded: Loaded; section: SectionRow; ownerId: string | null };

  /**
   * BR6.8, NFR6.219, BR8.12: the caller owns the section (or is an Admin), nothing is under
   * takedown, the course is editable and the section is active. Takes the course share lock, then
   * the section row lock.
   */
  async function loadSectionForWrite(
    exec: Executor,
    actor: Actor,
    courseId: string,
    sectionId: string,
  ): Promise<Result<SectionWrite, Failure>> {
    const who = kernel.courseActor(actor);
    const loaded = await kernel.load(exec, courseId, who, 'share');
    if (!loaded.ok) return loaded;
    const listed = loaded.value.sections.find((s) => s.sectionId === sectionId);
    if (!listed || listed.structureState === 'removed') return err(notFound());
    const ownerId = loaded.value.open.get(sectionId)?.instructorId ?? null;
    const allowed = decideSectionEdit(loaded.value.role, who, ownerId);
    if (!allowed.ok) return allowed;
    const section = (await sections.getForUpdate(exec, courseId, sectionId)) as SectionRow;
    const hidden = checkNotUnderTakedown(
      loaded.value.course.status === 'hidden',
      section.hiddenByTakedownNoticeId !== null,
    );
    if (!hidden.ok) return hidden;
    const editable = checkCourseEditable(loaded.value.course.status);
    if (!editable.ok) return editable;
    const writable = checkSectionWritable(section.structureState);
    if (!writable.ok) return writable;
    return ok({ loaded: loaded.value, section, ownerId });
  }

  /** BR8.1, BR8.2: the draft working copy, created from the live version on the first edit. */
  async function draftCopy(
    exec: Executor,
    section: SectionRow,
  ): Promise<Result<SectionVersionRow, Failure>> {
    if (section.workingVersionId) {
      const working = await sections.versionForUpdate(exec, section.workingVersionId);
      if (!working) return err(notFound());
      const editable = checkWorkingCopyEditable(working.reviewState);
      return editable.ok ? ok(working) : editable;
    }
    const live = section.liveVersionId
      ? await sections.versionForUpdate(exec, section.liveVersionId)
      : undefined;
    if (!live) return err(notFound());
    const created = await kernel.workingCopyFor(exec, section, live.version);
    if (!created.ok) return created;
    return ok(
      (await sections.versionForUpdate(exec, created.value.sectionVersionId)) as SectionVersionRow,
    );
  }

  /** Bumps the working copy's SectionVersion.version under its row lock (BR12.1). */
  async function bumpWorkingCopy(exec: Executor, copy: SectionVersionRow): Promise<number> {
    const bumped = await sections.updateVersion(exec, copy.sectionVersionId, copy.version, {});
    return (bumped as SectionVersionRow).version;
  }

  /** The working copy for a list change, checked against the sent version (BR7.2, BR12.1). */
  async function listChangeCopy(
    exec: Executor,
    section: SectionRow,
    expectedVersion: number,
  ): Promise<Result<SectionVersionRow, Failure>> {
    const copy = await kernel.workingCopyFor(exec, section, expectedVersion);
    if (!copy.ok) return copy;
    return ok(
      (await sections.versionForUpdate(exec, copy.value.sectionVersionId)) as SectionVersionRow,
    );
  }

  async function lessonInCopy(
    exec: Executor,
    copy: SectionVersionRow,
    lessonId: string,
  ): Promise<Result<{ all: LessonWithVersion[]; target: LessonWithVersion }, Failure>> {
    const all = await lessons.listForSectionVersion(exec, copy.sectionVersionId, {
      forUpdate: true,
    });
    const target = all.find((l) => l.lesson.lessonId === lessonId);
    if (!target) return err(notFound());
    const hidden = checkNotUnderTakedown(target.lesson.hiddenByTakedownNoticeId !== null);
    return hidden.ok ? ok({ all, target }) : hidden;
  }

  // ---------------------------------------------------------------- I1 read

  async function getSectionForEditing(
    actor: Actor,
    raw: z.input<typeof SectionRefInput>,
  ): Promise<Result<SectionContentView, AppError<'NOT_FOUND'>>> {
    const parsed = SectionRefInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const { courseId, sectionId } = parsed.data;
    const who = kernel.courseActor(actor);
    const exec: Executor = kernel.deps.db;
    const loaded = await kernel.load(exec, courseId, who, 'none');
    if (!loaded.ok) return loaded;
    const role = decideCourseRead(loaded.value.role);
    if (!role.ok) return role;
    const section = loaded.value.sections.find((s) => s.sectionId === sectionId);
    if (!section || section.structureState === 'removed') return err(notFound());
    const versionIds = [section.workingVersionId, section.liveVersionId].filter(
      (v): v is string => v !== null,
    );
    const versions = new Map(
      (await sections.versionsByIds(exec, versionIds)).map((v) => [v.sectionVersionId, v]),
    );
    const working = section.workingVersionId ? versions.get(section.workingVersionId) : undefined;
    const live = section.liveVersionId ? versions.get(section.liveVersionId) : undefined;
    const shown = working ?? live;
    const rows = shown ? await lessons.listForSectionVersion(exec, shown.sectionVersionId) : [];
    const ownerId = loaded.value.open.get(sectionId)?.instructorId ?? null;
    const { course } = loaded.value;
    const isUnderTakedown = course.status === 'hidden' || section.hiddenByTakedownNoticeId !== null;
    const canEdit =
      section.structureState === 'active' &&
      !isUnderTakedown &&
      checkCourseEditable(course.status).ok &&
      decideSectionEdit(role.value, who, ownerId).ok &&
      (working === undefined || working.reviewState === 'draft');
    return ok({
      courseId,
      sectionId,
      structureState: section.structureState,
      ownerId,
      isOwner: ownerId === actor.userId,
      isLead: role.value === 'lead',
      canManageCourse: role.value === 'lead' || who.isAdmin,
      isUnderTakedown,
      canEdit,
      editVersion: working?.version ?? live?.version ?? null,
      working: working
        ? {
            sectionVersionId: working.sectionVersionId,
            version: working.version,
            reviewState: working.reviewState,
            titleBn: working.titleBn,
            titleEn: working.titleEn,
          }
        : null,
      live: live ? { sectionVersionId: live.sectionVersionId, version: live.version } : null,
      titleBn: shown?.titleBn ?? '',
      titleEn: shown?.titleEn ?? '',
      lessons: rows.map(lessonView),
      lastReturnComment: await sections.latestReturnComment(exec, sectionId),
    });
  }

  // ---------------------------------------------------------------- UC12 lessons

  async function addLesson(
    actor: Actor,
    raw: z.input<typeof AddLessonInput>,
    correlationId: string,
  ): Promise<Result<{ lessonId: string; sectionVersionId: string; version: number }, Failure>> {
    const input = AddLessonInput.parse(raw);
    const context = {
      actor,
      operation: 'addLesson',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const titles = validateLessonTitles(input);
      if (!titles.ok) return titles;
      const copy = await listChangeCopy(exec, target.value.section, input.expectedVersion);
      if (!copy.ok) return copy;
      const existing = await lessons.listForSectionVersion(exec, copy.value.sectionVersionId);
      if (existing.length >= MAX_LESSONS_PER_SECTION) {
        return err(validationFailed({ lessonIds: ['errors.catalog.tooManyLessons'] }));
      }
      const row = await lessons.insertLesson(exec, {
        sectionId: input.sectionId,
        kind: input.kind,
        createdBy: actor.userId,
        createdAt: kernel.now(),
      });
      await lessons.insertVersion(exec, {
        lessonId: row.lessonId,
        sectionVersionId: copy.value.sectionVersionId,
        position: existing.length + 1,
        ...titles.value,
      });
      const version = await bumpWorkingCopy(exec, copy.value);
      return ok({ lessonId: row.lessonId, sectionVersionId: copy.value.sectionVersionId, version });
    });
  }

  async function editLesson(
    actor: Actor,
    raw: z.input<typeof EditLessonInput>,
    correlationId: string,
  ): Promise<Result<{ lessonId: string; version: number; sectionVersion: number }, Failure>> {
    const input = EditLessonInput.parse(raw);
    const context = {
      actor,
      operation: 'editLesson',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const titles = validateLessonTitles(input);
      if (!titles.ok) return titles;
      const copy = await draftCopy(exec, target.value.section);
      if (!copy.ok) return copy;
      const found = await lessonInCopy(exec, copy.value, input.lessonId);
      if (!found.ok) return found;
      const { version } = found.value.target;
      const updated = await lessons.updateAuthored(
        exec,
        version.lessonVersionId,
        input.expectedVersion,
        titles.value,
      );
      if (!updated) return err(staleVersion(version.version));
      const sectionVersion = await bumpWorkingCopy(exec, copy.value);
      return ok({ lessonId: input.lessonId, version: updated.version, sectionVersion });
    });
  }

  /** NFR6.209: the link positions of a body whose candidates meet the blocked list. */
  function blockedPositions(body: LessonDocument, blockedDomains: ReadonlySet<string>): number[] {
    const positions: number[] = [];
    documentLinks(body).forEach((href, index) => {
      const checked = kernel.links.checkLink(href);
      if (checked.ok && isBlockedBy(checked.value.candidates, blockedDomains))
        positions.push(index);
    });
    return positions;
  }

  function candidatesOf(body: LessonDocument | null): string[] {
    if (!body) return [];
    return documentLinks(body).flatMap((href) => {
      const checked = kernel.links.checkLink(href);
      return checked.ok ? checked.value.candidates : [];
    });
  }

  async function saveTextLessonBody(
    actor: Actor,
    raw: z.input<typeof SaveTextLessonBodyInput>,
    correlationId: string,
  ): Promise<Result<{ lessonId: string; version: number; sectionVersion: number }, Failure>> {
    const input = SaveTextLessonBodyInput.parse(raw);
    const field = input.language === 'bn' ? 'bodyBn' : 'bodyEn';
    const context = {
      actor,
      operation: 'saveTextLessonBody',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    const saved = await kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const copy = await draftCopy(exec, target.value.section);
      if (!copy.ok) return copy;
      const found = await lessonInCopy(exec, copy.value, input.lessonId);
      if (!found.ok) return found;
      const { lesson, version } = found.value.target;
      const kind = checkTextLesson(lesson.kind);
      if (!kind.ok) return kind;
      let body: LessonDocument | null = null;
      if (input.body !== null) {
        const validated = validateLessonDocument(input.body, kernel.links);
        if (!validated.ok) return err(documentRefusal(field, validated.error));
        // Images need the approved image store (Bolt 6); until then no image ID resolves.
        if (validated.value.imageIds.length > 0) {
          return err(
            validationFailed({ [`${field}.images`]: ['errors.catalog.imageUnavailable'] }),
          );
        }
        // SD-211: one query per save over every candidate, no cache; a DB error fails closed.
        const hits = await blocked.matching(exec, validated.value.linkCandidates);
        if (hits.length > 0) {
          const set = new Set(hits.map((h) => h.domain));
          log.warn(
            {
              event: 'catalog.link_blocked',
              actorId: actor.userId,
              lessonId: lesson.lessonId,
              blockedDomainIds: hits.map((h) => h.blockedDomainId),
              correlationId,
            },
            'blocked link refused at save',
          );
          const fieldErrors: Record<string, string[]> = {};
          for (const index of blockedPositions(validated.value.document, set)) {
            fieldErrors[`${field}.links.${index}`] = ['errors.catalog.blockedLink'];
          }
          return err(validationFailed(fieldErrors));
        }
        body = validated.value.document;
      }
      const other = (
        input.language === 'bn' ? version.bodyEn : version.bodyBn
      ) as LessonDocument | null;
      const linkDomainCandidates = [...new Set([...candidatesOf(body), ...candidatesOf(other)])];
      const updated = await lessons.updateAuthored(
        exec,
        version.lessonVersionId,
        input.expectedVersion,
        {
          [field]: body,
          linkDomainCandidates,
        },
      );
      if (!updated) return err(staleVersion(version.version));
      const sectionVersion = await bumpWorkingCopy(exec, copy.value);
      return ok({ lessonId: lesson.lessonId, version: updated.version, sectionVersion });
    });
    // OD-207: a link refusal is counted after the refused transaction has rolled back.
    if (!saved.ok && isLinkRefusal(saved.error)) {
      await kernel.signal('linkRefusals', () =>
        kernel.deps.moderation?.linkRefused(actor.userId, correlationId),
      );
    }
    return saved;
  }

  /**
   * A video lesson's YouTube video on the working copy (created from the live version on the first
   * edit, like a text body). The instructor's link or ID is parsed here; anything that is not a
   * YouTube video is refused in place. The published version is never touched.
   */
  async function setLessonVideo(
    actor: Actor,
    raw: z.input<typeof SetLessonVideoInput>,
    correlationId: string,
  ): Promise<
    Result<
      { lessonId: string; youtubeVideoId: string | null; version: number; sectionVersion: number },
      Failure
    >
  > {
    const input = SetLessonVideoInput.parse(raw);
    let youtubeVideoId: string | null = null;
    if (input.youtube !== null && input.youtube.length > 0) {
      youtubeVideoId = parseYoutubeVideoId(input.youtube);
      if (!youtubeVideoId)
        return err(validationFailed({ youtube: ['errors.catalog.youtubeInvalid'] }));
    }
    const context = {
      actor,
      operation: 'setLessonVideo',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const copy = await draftCopy(exec, target.value.section);
      if (!copy.ok) return copy;
      const found = await lessonInCopy(exec, copy.value, input.lessonId);
      if (!found.ok) return found;
      const { lesson, version } = found.value.target;
      const kind = checkVideoLesson(lesson.kind);
      if (!kind.ok) return kind;
      const updated = await lessons.updateAuthored(
        exec,
        version.lessonVersionId,
        input.expectedVersion,
        {
          youtubeVideoId,
        },
      );
      if (!updated) return err(staleVersion(version.version));
      const sectionVersion = await bumpWorkingCopy(exec, copy.value);
      return ok({
        lessonId: lesson.lessonId,
        youtubeVideoId,
        version: updated.version,
        sectionVersion,
      });
    });
  }

  type QuizEditorView = {
    lessonId: string;
    /** The lesson version's token for saveQuizQuestions (the working copy's, else the live one). */
    version: number;
    canEdit: boolean;
    /** US4.13: the streak needed to open this quiz, or null for an ordinary quiz. */
    streakBonusDays: number | null;
    questions: Array<{
      questionId: string;
      promptBn: string;
      promptEn: string;
      optionsBn: string[];
      optionsEn: string[];
      correctIndex: number;
      explanationBn: string | null;
      explanationEn: string | null;
    }>;
  };

  /** I1: a quiz lesson's questions for the editor (working copy if any, else the live version). */
  async function getQuizForEditing(
    actor: Actor,
    raw: z.input<typeof LessonRefInput>,
  ): Promise<Result<QuizEditorView, AppError<'NOT_FOUND'>>> {
    const parsed = LessonRefInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const view = await getSectionForEditing(actor, {
      courseId: parsed.data.courseId,
      sectionId: parsed.data.sectionId,
    });
    if (!view.ok) return view;
    const shown = view.value.lessons.find((l) => l.lessonId === parsed.data.lessonId);
    if (shown?.kind !== 'quiz') return err(notFound());
    const versionId = view.value.working?.sectionVersionId ?? view.value.live?.sectionVersionId;
    if (!versionId) return err(notFound());
    const exec: Executor = kernel.deps.db;
    const rows = await lessons.listForSectionVersion(exec, versionId);
    const row = rows.find((r) => r.lesson.lessonId === parsed.data.lessonId);
    if (!row) return err(notFound());
    const questions = await lessons.questionsOfVersion(exec, row.version.lessonVersionId);
    return ok({
      lessonId: parsed.data.lessonId,
      version: row.version.version,
      canEdit: view.value.canEdit,
      streakBonusDays: row.version.streakBonusDays,
      questions: questions.map((q) => ({
        questionId: q.questionId,
        promptBn: q.promptBn,
        promptEn: q.promptEn,
        optionsBn: q.optionsBn,
        optionsEn: q.optionsEn,
        correctIndex: q.correctIndex,
        explanationBn: q.explanationBn,
        explanationEn: q.explanationEn,
      })),
    });
  }

  /**
   * Replaces a quiz lesson's questions on the working copy and records their count (BR7.3: a quiz
   * with questions is complete). Checked against the lesson version's token like any lesson edit.
   */
  async function saveQuizQuestions(
    actor: Actor,
    raw: z.input<typeof SaveQuizQuestionsInput>,
    correlationId: string,
  ): Promise<
    Result<
      { lessonId: string; questionCount: number; version: number; sectionVersion: number },
      Failure
    >
  > {
    const input = SaveQuizQuestionsInput.parse(raw);
    const checked = validateQuizQuestions(input.questions);
    if (!checked.ok) return checked;
    const context = {
      actor,
      operation: 'saveQuizQuestions',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const copy = await draftCopy(exec, target.value.section);
      if (!copy.ok) return copy;
      const found = await lessonInCopy(exec, copy.value, input.lessonId);
      if (!found.ok) return found;
      const { lesson, version } = found.value.target;
      const kind = checkQuizLesson(lesson.kind);
      if (!kind.ok) return kind;
      const updated = await lessons.updateAuthored(
        exec,
        version.lessonVersionId,
        input.expectedVersion,
        {
          quizQuestionCount: checked.value.length,
          ...(input.streakBonusDays !== undefined
            ? { streakBonusDays: input.streakBonusDays }
            : {}),
        },
      );
      if (!updated) return err(staleVersion(version.version));
      await lessons.replaceQuestions(exec, lesson.lessonId, version.lessonVersionId, checked.value);
      const sectionVersion = await bumpWorkingCopy(exec, copy.value);
      return ok({
        lessonId: lesson.lessonId,
        questionCount: checked.value.length,
        version: updated.version,
        sectionVersion,
      });
    });
  }

  async function reorderLessons(
    actor: Actor,
    raw: z.input<typeof ReorderLessonsInput>,
    correlationId: string,
  ): Promise<Result<{ sectionVersionId: string; version: number }, Failure>> {
    const input = ReorderLessonsInput.parse(raw);
    const context = {
      actor,
      operation: 'reorderLessons',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const copy = await listChangeCopy(exec, target.value.section, input.expectedVersion);
      if (!copy.ok) return copy;
      const all = await lessons.listForSectionVersion(exec, copy.value.sectionVersionId, {
        forUpdate: true,
      });
      const plan = planLessonReorder(
        all.map((l) => l.lesson.lessonId),
        input.lessonIds,
      );
      if (!plan.ok) return plan;
      await lessons.setPositions(exec, copy.value.sectionVersionId, plan.value);
      const version = await bumpWorkingCopy(exec, copy.value);
      return ok({ sectionVersionId: copy.value.sectionVersionId, version });
    });
  }

  async function removeLesson(
    actor: Actor,
    raw: z.input<typeof RemoveLessonInput>,
    correlationId: string,
  ): Promise<Result<{ lessonId: string; removal: 'delete' | 'unlink'; version: number }, Failure>> {
    const input = RemoveLessonInput.parse(raw);
    const context = {
      actor,
      operation: 'removeLesson',
      courseId: input.courseId,
      sectionId: input.sectionId,
    };
    return kernel.write(context, correlationId, async (_tx, exec) => {
      const target = await loadSectionForWrite(exec, actor, input.courseId, input.sectionId);
      if (!target.ok) return target;
      const copy = await listChangeCopy(exec, target.value.section, input.expectedVersion);
      if (!copy.ok) return copy;
      const found = await lessonInCopy(exec, copy.value, input.lessonId);
      if (!found.ok) return found;
      const { lesson, version } = found.value.target;
      const removal = removalOf({
        liveState: lesson.liveState,
        otherVersionCount: await lessons.otherVersionCount(
          exec,
          lesson.lessonId,
          version.lessonVersionId,
        ),
      });
      await lessons.deleteVersion(exec, version.lessonVersionId);
      if (removal === 'delete') await lessons.deleteLesson(exec, lesson.lessonId);
      await lessons.setPositions(
        exec,
        copy.value.sectionVersionId,
        renumberAfterRemoval(
          found.value.all.map((l) => l.lesson.lessonId),
          lesson.lessonId,
        ),
      );
      const bumped = await bumpWorkingCopy(exec, copy.value);
      return ok({ lessonId: lesson.lessonId, removal, version: bumped });
    });
  }

  // ---------------------------------------------------------------- UC21 U4 status (contract 5)

  type U4Error = AppError<'NOT_FOUND' | 'INVALID_STATE'>;

  /**
   * BR7.6 (CR-8 adds captionLanguages): called by ContentDelivery in its own transaction. Writes
   * technical status only; checks and bumps no token and never changes a review state.
   */
  async function setLessonMedia(
    tx: TxHandle,
    raw: z.input<typeof SetLessonMediaInput>,
  ): Promise<Result<void, U4Error>> {
    const parsed = SetLessonMediaInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const input = parsed.data;
    const exec = unwrapTx(tx);
    const placement = await lessons.placement(exec, input.lessonId);
    const lesson = placement ? await lessons.getLesson(exec, input.lessonId) : undefined;
    if (!placement || !lesson) return err(notFound());
    const versions = await lessons.currentVersions(exec, input.lessonId, placement.sectionId);
    const plan = planMediaPush(
      lesson.kind,
      versions.map((v) => ({
        lessonVersionId: v.lessonVersionId,
        role: v.isLive ? 'live' : 'working',
        reviewState: v.reviewState,
        videoAssetId: v.videoAssetId,
      })),
      input.videoAssetId,
    );
    if (!plan.ok) return plan;
    const captions = input.captionLanguages
      ? { captionLanguages: [...input.captionLanguages] }
      : {};
    if (plan.value.bindTo) {
      await lessons.updateTechnical(exec, [plan.value.bindTo], {
        videoAssetId: input.videoAssetId,
        mediaStatus: input.mediaStatus,
        captionLanguages: input.captionLanguages ? [...input.captionLanguages] : [],
      });
    }
    await lessons.updateTechnical(
      exec,
      plan.value.statusOn.filter((id) => id !== plan.value.bindTo),
      { mediaStatus: input.mediaStatus, ...captions },
    );
    return ok(undefined);
  }

  /** BR7.7 (CR-8): called by Assessment; the question count is technical status of U4 questions. */
  async function setQuizContentStatus(
    tx: TxHandle,
    raw: z.input<typeof SetQuizContentStatusInput>,
  ): Promise<Result<void, U4Error>> {
    const parsed = SetQuizContentStatusInput.safeParse(raw);
    if (!parsed.success) return err(notFound());
    const input = parsed.data;
    const exec = unwrapTx(tx);
    const placement = await lessons.placement(exec, input.lessonId);
    const lesson = placement ? await lessons.getLesson(exec, input.lessonId) : undefined;
    if (!placement || !lesson) return err(notFound());
    if (lesson.kind !== 'quiz') {
      return err({ code: 'INVALID_STATE', i18nKey: 'errors.catalog.quizStatusNotAccepted' });
    }
    const versions = await lessons.currentVersions(exec, input.lessonId, placement.sectionId);
    await lessons.updateTechnical(
      exec,
      versions.map((v) => v.lessonVersionId),
      { quizQuestionCount: input.questionCount },
    );
    return ok(undefined);
  }

  return {
    getSectionForEditing,
    addLesson,
    editLesson,
    saveTextLessonBody,
    setLessonVideo,
    getQuizForEditing,
    saveQuizQuestions,
    reorderLessons,
    removeLesson,
    setLessonMedia,
    setQuizContentStatus,
    /** Shared with the review service. */
    internal: { loadSectionForWrite },
  };
}

/** Maps document issues to VALIDATION_FAILED field errors under the body's field name. */
export function documentRefusal(
  field: 'bodyBn' | 'bodyEn',
  issues: readonly DocumentIssue[],
): AppError<'VALIDATION_FAILED'> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path ? `${field}.${issue.path}` : field;
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.key];
  }
  return validationFailed(fieldErrors);
}
