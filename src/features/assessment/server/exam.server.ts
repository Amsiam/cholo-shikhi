// Exams (U4 Assessment). Staff build mock tests and scheduled live exams from blueprint rules
// (topic, measured difficulty, count); the questions are drawn from the published bank and frozen
// at publish. Students take them, or make their own custom practice exam. Answers save as they go;
// time running out closes the attempt. A live exam's marks, answers and merit list are released only
// when its window ends, so nobody can pass answers on while others are still sitting it.

import { courseTitlesOf, listInstructorCourses } from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Executor } from '#src/server/db.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createBankRepository } from '../data/bank.repository.ts';
import { type AttemptRow, createExamRepository, type ExamRow } from '../data/exam.repository.ts';
import type { Difficulty } from '../domain/bank.ts';
import {
  attemptDeadline,
  attemptOrder,
  type BlueprintRow,
  blueprintSize,
  dhakaLocalToUtc,
  isAcceptingAnswers,
  type LiveState,
  liveEndsAt,
  liveState,
  MAX_EXAM_QUESTIONS,
  markAttempt,
  maskName,
  rankMerit,
  utcToDhakaLocal,
} from '../domain/exam.ts';
import {
  AttachExamInput,
  AttemptRef,
  CreateCustomExamInput,
  ExamRef,
  ExamVersionRef,
  ExploreInput,
  SaveExamAnswerInput,
  SaveExamInput,
} from './bank.schema.ts';
import { type StudentQuestion, toStudentQuestion } from './bank.server.ts';

const repo = createExamRepository();
const bank = createBankRepository();
type ExamError = AppError<
  'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION_FAILED' | 'INVALID_STATE'
>;
const withKey = <C extends ExamError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});

const isAdmin = (actor: Actor) => actor.roles.includes('admin');
const canManage = (actor: Actor, e: ExamRow) =>
  e.kind !== 'custom' && (isAdmin(actor) || e.createdBy === actor.userId);

function liveOf(e: ExamRow, now: Date): LiveState | null {
  return e.kind === 'live' && e.startsAt ? liveState(e.startsAt, e.durationMinutes, now) : null;
}

/** Results are out: always for mock and custom exams, after the window for a live one. */
function isReleased(e: ExamRow, now: Date): boolean {
  return e.kind !== 'live' || liveOf(e, now) === 'ended';
}

// ================================================================= staff

export type StaffExamView = {
  examId: string;
  kind: 'mock' | 'live';
  status: ExamRow['status'];
  titleBn: string;
  titleEn: string;
  goalId: string;
  courseId: string | null;
  courseTitleBn: string;
  courseTitleEn: string;
  durationMinutes: number;
  negativeBps: number;
  startsAt: string | null;
  startsAtLocal: string;
  liveState: LiveState | null;
  blueprint: BlueprintRow[];
  plannedCount: number;
  questionCount: number;
  version: number;
  canEdit: boolean;
  attempts: number;
  averageX100: number | null;
};

async function staffViews(actor: Actor, rows: readonly ExamRow[]): Promise<StaffExamView[]> {
  const counts = new Map(
    (
      await repo.attemptCounts(
        getDb(),
        rows.map((r) => r.examId),
      )
    ).map((c) => [c.examId, c]),
  );
  const now = new Date();
  const titles = await courseTitlesOf([
    ...new Set(rows.flatMap((r) => (r.courseId ? [r.courseId] : []))),
  ]);
  return rows.map((e) => ({
    examId: e.examId,
    kind: e.kind as 'mock' | 'live',
    status: e.status,
    titleBn: e.titleBn,
    titleEn: e.titleEn,
    goalId: e.goalId ?? '',
    courseId: e.courseId,
    courseTitleBn: e.courseId ? (titles[e.courseId]?.titleBn ?? '') : '',
    courseTitleEn: e.courseId ? (titles[e.courseId]?.titleEn ?? '') : '',
    durationMinutes: e.durationMinutes,
    negativeBps: e.negativeBps,
    startsAt: e.startsAt?.toISOString() ?? null,
    startsAtLocal: e.startsAt ? utcToDhakaLocal(e.startsAt) : '',
    liveState: liveOf(e, now),
    blueprint: e.blueprint,
    plannedCount: blueprintSize(e.blueprint),
    questionCount: e.questionIds.length,
    version: e.version,
    canEdit: e.status === 'draft' && canManage(actor, e),
    attempts: counts.get(e.examId)?.n ?? 0,
    averageX100: counts.get(e.examId)?.avg ?? null,
  }));
}

export async function listStaffExams(actor: Actor): Promise<Result<StaffExamView[], never>> {
  const rows = await repo.staffExams(getDb(), isAdmin(actor) ? null : actor.userId);
  return ok(await staffViews(actor, rows));
}

export type StaffExamDetail = {
  exam: StaffExamView;
  /** Courses this viewer teaches, to attach the exam to. */
  courseOptions: Array<{ courseId: string; titleBn: string; titleEn: string }>;
  /** Published questions each blueprint row can draw from. */
  available: number[];
  questions: Array<{
    questionId: string;
    topicId: string;
    difficulty: Difficulty;
    promptBn: string;
    promptEn: string;
    optionsBn: string[];
    optionsEn: string[];
    correctIndex: number;
  }>;
};

/** Courses the Instructor teaches (Lead or Co-instructor), plus the one already attached. */
async function teachingCourseIds(actor: Actor): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const r = await listInstructorCourses(actor.userId, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...r.items.map((i) => i.courseId));
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return ids;
}

async function teachingCoursesOf(actor: Actor, attached: string | null) {
  const ids = [...new Set([...(await teachingCourseIds(actor)), ...(attached ? [attached] : [])])];
  const titles = await courseTitlesOf(ids);
  return ids.map((courseId) => ({
    courseId,
    titleBn: titles[courseId]?.titleBn ?? '',
    titleEn: titles[courseId]?.titleEn ?? '',
  }));
}

async function detailOf(actor: Actor, e: ExamRow): Promise<StaffExamDetail> {
  const db = getDb();
  const [view] = await staffViews(actor, [e]);
  const available = await Promise.all(
    e.blueprint.map(async (row) =>
      repo.available(db, await repo.topicFamily(db, row.topicId), row.difficulty),
    ),
  );
  const byId = new Map(
    (await bank.questionsByIds(db, e.questionIds)).map((q) => [q.questionId, q]),
  );
  return {
    exam: view as StaffExamView,
    courseOptions: await teachingCoursesOf(actor, e.courseId),
    available,
    questions: e.questionIds.flatMap((id) => {
      const q = byId.get(id);
      return q
        ? [
            {
              questionId: q.questionId,
              topicId: q.topicId,
              difficulty: q.effectiveDifficulty,
              promptBn: q.promptBn,
              promptEn: q.promptEn,
              optionsBn: q.optionsBn,
              optionsEn: q.optionsEn,
              correctIndex: q.correctIndex,
            },
          ]
        : [];
    }),
  };
}

export async function getStaffExam(
  actor: Actor,
  raw: ExamRef,
): Promise<Result<StaffExamDetail, AppError<'NOT_FOUND'>>> {
  const input = ExamRef.parse(raw);
  const e = await repo.examById(getDb(), input.examId);
  if (!e || !canManage(actor, e)) return err(appError('NOT_FOUND'));
  return ok(await detailOf(actor, e));
}

export async function saveExam(
  actor: Actor,
  raw: SaveExamInput,
): Promise<Result<StaffExamDetail, ExamError>> {
  const input = SaveExamInput.parse(raw);
  const startsAt = input.kind === 'live' ? dhakaLocalToUtc(input.startsAtLocal ?? '') : null;
  if (input.kind === 'live' && !startsAt)
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { startsAtLocal: ['errors.exam.startRequired'] },
      }),
    );
  if (blueprintSize(input.blueprint) > MAX_EXAM_QUESTIONS)
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { blueprint: ['errors.exam.tooMany'] } }),
    );
  const db = getDb();
  const fields = {
    kind: input.kind,
    titleBn: input.titleBn,
    titleEn: input.titleEn,
    goalId: input.goalId,
    durationMinutes: input.durationMinutes,
    negativeBps: input.negativeBps,
    startsAt,
    blueprint: input.blueprint.map((r) => ({
      topicId: r.topicId,
      difficulty: r.difficulty,
      count: r.count,
    })),
  };
  if (!input.examId) {
    const created = await repo.insertExam(db, { ...fields, createdBy: actor.userId });
    return ok(await detailOf(actor, created));
  }
  const existing = await repo.examById(db, input.examId);
  if (!existing || !canManage(actor, existing)) return err(appError('NOT_FOUND'));
  if (existing.status !== 'draft') return err(withKey('INVALID_STATE', 'errors.exam.notDraft'));
  // A changed blueprint invalidates the drawn questions.
  const isSameBlueprint = JSON.stringify(existing.blueprint) === JSON.stringify(fields.blueprint);
  const row = await repo.updateExam(db, input.examId, input.expectedVersion ?? -1, {
    ...fields,
    ...(isSameBlueprint ? {} : { questionIds: [] }),
  });
  if (!row) return err(appError('CONFLICT'));
  return ok(await detailOf(actor, row));
}

/** Draws the questions for a draft from its blueprint (again, if called again). */
export async function drawExamQuestions(
  actor: Actor,
  raw: ExamVersionRef,
): Promise<Result<StaffExamDetail, ExamError>> {
  const input = ExamVersionRef.parse(raw);
  const db = getDb();
  const e = await repo.examById(db, input.examId);
  if (!e || !canManage(actor, e)) return err(appError('NOT_FOUND'));
  if (e.status !== 'draft') return err(withKey('INVALID_STATE', 'errors.exam.notDraft'));
  const chosen: string[] = [];
  const short: Record<string, string[]> = {};
  for (const [i, row] of e.blueprint.entries()) {
    const ids = await repo.pick(
      db,
      await repo.topicFamily(db, row.topicId),
      row.difficulty,
      row.count,
      chosen,
    );
    if (ids.length < row.count) short[`blueprint.${i}`] = ['errors.exam.notEnough'];
    chosen.push(...ids);
  }
  if (Object.keys(short).length > 0)
    return err(appError('VALIDATION_FAILED', { fieldErrors: short }));
  const updated = await repo.updateExam(db, e.examId, input.expectedVersion, {
    questionIds: chosen,
  });
  if (!updated) return err(appError('CONFLICT'));
  return ok(await detailOf(actor, updated));
}

export async function publishExam(
  actor: Actor,
  raw: ExamVersionRef,
): Promise<Result<StaffExamDetail, ExamError>> {
  const input = ExamVersionRef.parse(raw);
  const db = getDb();
  const e = await repo.examById(db, input.examId);
  if (!e || !canManage(actor, e)) return err(appError('NOT_FOUND'));
  if (e.status !== 'draft') return err(withKey('INVALID_STATE', 'errors.exam.notDraft'));
  if (e.questionIds.length === 0 || e.questionIds.length !== blueprintSize(e.blueprint))
    return err(withKey('INVALID_STATE', 'errors.exam.drawFirst'));
  if (e.kind === 'live' && (!e.startsAt || e.startsAt.getTime() <= Date.now()))
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { startsAtLocal: ['errors.exam.startInPast'] },
      }),
    );
  const row = await repo.updateExam(db, e.examId, input.expectedVersion, {
    status: 'published',
    publishedAt: new Date(),
  });
  if (!row) return err(appError('CONFLICT'));
  return ok(await detailOf(actor, row));
}

export async function retireExam(
  actor: Actor,
  raw: ExamVersionRef,
): Promise<Result<StaffExamDetail, ExamError>> {
  const input = ExamVersionRef.parse(raw);
  const db = getDb();
  const e = await repo.examById(db, input.examId);
  if (!e || !canManage(actor, e)) return err(appError('NOT_FOUND'));
  if (e.status !== 'published') return err(appError('INVALID_STATE'));
  if (e.kind === 'live' && liveOf(e, new Date()) === 'open')
    return err(withKey('INVALID_STATE', 'errors.exam.liveRunning'));
  const row = await repo.updateExam(db, e.examId, input.expectedVersion, { status: 'retired' });
  if (!row) return err(appError('CONFLICT'));
  return ok(await detailOf(actor, row));
}

/**
 * Attaches the exam to one of the viewer's courses (or detaches it with null). An attached exam is
 * only for Students enrolled in that course or on its trial. Instructors attach their own exams to
 * courses they teach; an Admin may attach any staff exam to any course.
 */
export async function attachExamToCourse(
  actor: Actor,
  raw: AttachExamInput,
): Promise<Result<StaffExamDetail, ExamError>> {
  const input = AttachExamInput.parse(raw);
  const db = getDb();
  const e = await repo.examById(db, input.examId);
  if (!e || !canManage(actor, e)) return err(appError('NOT_FOUND'));
  if (
    input.courseId &&
    !isAdmin(actor) &&
    !(await teachingCourseIds(actor)).includes(input.courseId)
  )
    return err(withKey('FORBIDDEN', 'errors.exam.notYourCourse'));
  const row = await repo.updateExam(db, e.examId, input.expectedVersion, {
    courseId: input.courseId,
  });
  if (!row) return err(appError('CONFLICT'));
  return ok(await detailOf(actor, row));
}

// ================================================================= Students

/** Closes the Student's attempts whose time ran out (they count as submitted at the deadline). */
async function closeExpired(exec: Executor, userId: string, now: Date): Promise<void> {
  const open = await repo.openAttemptsOf(exec, userId);
  for (const a of open) {
    if (isAcceptingAnswers(a.deadlineAt, now)) continue;
    await withTransaction(getDb(), async (tx) => {
      const t = unwrapTx(tx);
      const locked = await repo.attemptForUpdate(t, userId, a.attemptId);
      if (locked && !locked.submittedAt) await finalize(t, locked, locked.deadlineAt);
    });
  }
}

async function finalize(exec: Executor, a: AttemptRow, at: Date): Promise<AttemptRow> {
  const e = await repo.examById(exec, a.examId);
  const key = (await bank.questionsByIds(exec, e?.questionIds ?? [])).map((q) => ({
    questionId: q.questionId,
    correctIndex: q.correctIndex,
  }));
  const m = markAttempt(key, a.answers, e?.negativeBps ?? 0);
  return repo.updateAttempt(exec, a.attemptId, {
    submittedAt: at,
    correctCount: m.correct,
    wrongCount: m.wrong,
    skippedCount: m.skipped,
    scoreX100: m.scoreX100,
    maxX100: m.maxX100,
  });
}

export type StudentAttemptSummary = {
  attemptId: string;
  startedAt: string;
  isSubmitted: boolean;
  /** Null until the results are released. */
  scoreX100: number | null;
  maxX100: number | null;
};

export type StudentExamCard = {
  examId: string;
  kind: ExamRow['kind'];
  /** Set when the exam belongs to one of the Student's courses. */
  courseId: string | null;
  courseTitleBn: string;
  courseTitleEn: string;
  titleBn: string;
  titleEn: string;
  durationMinutes: number;
  questionCount: number;
  negativeBps: number;
  startsAt: string | null;
  endsAt: string | null;
  liveState: LiveState | null;
  canStart: boolean;
  openAttemptId: string | null;
  attempts: StudentAttemptSummary[];
};

export async function studentExams(
  userId: string,
  goalId: string | null,
  courseIds: readonly string[],
  grants: ExamGrants = NO_GRANTS,
): Promise<StudentExamCard[]> {
  const db = getDb();
  const now = new Date();
  await closeExpired(db, userId, now);
  const exams = (await repo.studentExams(db, userId, goalId, courseIds, grants.granted)).filter(
    (e) => visibleTo(e, userId, goalId, courseIds, grants),
  );
  const attempts = await repo.attemptsOf(
    db,
    userId,
    exams.map((e) => e.examId),
  );
  const courseTitles = await courseTitlesOf([
    ...new Set(exams.flatMap((e) => (e.courseId ? [e.courseId] : []))),
  ]);
  return exams.map((e) => {
    const mine = attempts.filter((a) => a.examId === e.examId);
    const open = mine.find((a) => !a.submittedAt);
    const live = liveOf(e, now);
    const released = isReleased(e, now);
    return {
      examId: e.examId,
      kind: e.kind,
      courseId: e.courseId,
      courseTitleBn: e.courseId ? (courseTitles[e.courseId]?.titleBn ?? '') : '',
      courseTitleEn: e.courseId ? (courseTitles[e.courseId]?.titleEn ?? '') : '',
      titleBn: e.titleBn,
      titleEn: e.titleEn,
      durationMinutes: e.durationMinutes,
      questionCount: e.questionIds.length,
      negativeBps: e.negativeBps,
      startsAt: e.startsAt?.toISOString() ?? null,
      endsAt: e.startsAt ? liveEndsAt(e.startsAt, e.durationMinutes).toISOString() : null,
      liveState: live,
      canStart:
        open !== undefined || (e.kind === 'live' ? live === 'open' && mine.length === 0 : true),
      openAttemptId: open?.attemptId ?? null,
      attempts: mine.map((a) => ({
        attemptId: a.attemptId,
        startedAt: a.startedAt.toISOString(),
        isSubmitted: a.submittedAt !== null,
        scoreX100: released ? a.scoreX100 : null,
        maxX100: released ? a.maxX100 : null,
      })),
    };
  });
}

/** A Student's own practice exam from chosen topics; it is ready to take at once. */
export async function createCustomExam(
  userId: string,
  raw: CreateCustomExamInput,
): Promise<Result<{ examId: string }, AppError<'NOT_FOUND'>>> {
  const input = CreateCustomExamInput.parse(raw);
  const db = getDb();
  const families = (await Promise.all(input.topicIds.map((id) => repo.topicFamily(db, id)))).flat();
  const ids = await repo.pick(
    db,
    [...new Set(families)],
    input.difficulty ?? null,
    input.count,
    [],
  );
  if (ids.length === 0) return err(withKey('NOT_FOUND', 'errors.practice.empty'));
  const topics = (await bank.topics(db)).filter((t) => input.topicIds.includes(t.topicId));
  const join = (xs: string[]) => {
    const s = xs.join(' · ');
    return s.length > 150 ? `${s.slice(0, 147)}...` : s;
  };
  const e = await repo.insertExam(db, {
    kind: 'custom',
    status: 'published',
    titleBn: join(topics.map((t) => t.nameBn)) || 'অনুশীলন পরীক্ষা',
    titleEn: join(topics.map((t) => t.nameEn)) || 'Practice exam',
    goalId: null,
    durationMinutes: input.durationMinutes,
    negativeBps: input.negativeBps,
    blueprint: input.topicIds.map((topicId) => ({
      topicId,
      difficulty: input.difficulty ?? null,
      count: 0,
    })),
    questionIds: ids,
    createdBy: userId,
    publishedAt: new Date(),
  });
  return ok({ examId: e.examId });
}

export type AttemptSheet = {
  attemptId: string;
  examId: string;
  titleBn: string;
  titleEn: string;
  kind: ExamRow['kind'];
  negativeBps: number;
  deadlineAt: string;
  serverNow: string;
  questions: StudentQuestion[];
  answers: Record<string, number>;
};

/**
 * Exams reached through purchases: `granted` are the mock tests of the Student's Practice Packs and
 * the exams built from their exam packages; `locked` are every pack's mock tests, which nobody
 * else may open (course enrolment does not grant pack content, PRD FR-RTN-2).
 */
export type ExamGrants = { granted: readonly string[]; locked: readonly string[] };
const NO_GRANTS: ExamGrants = { granted: [], locked: [] };

function visibleTo(
  e: ExamRow,
  userId: string,
  goalId: string | null,
  courseIds: readonly string[],
  grants: ExamGrants = NO_GRANTS,
): boolean {
  if (e.status !== 'published') return false;
  if (e.kind === 'custom') return e.createdBy === userId;
  if (grants.granted.includes(e.examId)) return true;
  if (grants.locked.includes(e.examId) || e.packageVersionId) return false;
  if (e.courseId) return courseIds.includes(e.courseId);
  return goalId !== null && e.goalId === goalId;
}

async function sheetOf(
  exec: Executor,
  e: ExamRow,
  a: AttemptRow,
  now: Date,
): Promise<AttemptSheet> {
  const byId = new Map(
    (await bank.questionsByIds(exec, e.questionIds)).map((q) => [q.questionId, q]),
  );
  return {
    attemptId: a.attemptId,
    examId: e.examId,
    titleBn: e.titleBn,
    titleEn: e.titleEn,
    kind: e.kind,
    negativeBps: e.negativeBps,
    deadlineAt: a.deadlineAt.toISOString(),
    serverNow: now.toISOString(),
    questions: attemptOrder(e.questionIds, a.attemptId).flatMap((id) => {
      const q = byId.get(id);
      return q ? [toStudentQuestion(q)] : [];
    }),
    answers: a.answers,
  };
}

/** Starts an attempt, or resumes the open one. A live exam allows one attempt, inside its window. */
export async function startExamAttempt(
  userId: string,
  goalId: string | null,
  courseIds: readonly string[],
  raw: ExamRef,
  grants: ExamGrants = NO_GRANTS,
): Promise<Result<AttemptSheet, ExamError>> {
  const input = ExamRef.parse(raw);
  const now = new Date();
  await closeExpired(getDb(), userId, now);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const e = await repo.examForUpdate(exec, input.examId);
    if (!e || !visibleTo(e, userId, goalId, courseIds, grants)) return err(appError('NOT_FOUND'));
    const mine = await repo.attemptsOf(exec, userId, [e.examId]);
    const open = mine.find((a) => !a.submittedAt);
    if (open) return ok(await sheetOf(exec, e, open, now));
    let windowEnd: Date | null = null;
    if (e.kind === 'live') {
      const state = liveOf(e, now);
      if (state === 'upcoming') return err(withKey('INVALID_STATE', 'errors.exam.notOpenYet'));
      if (state === 'ended') return err(withKey('INVALID_STATE', 'errors.exam.ended'));
      if (mine.length > 0) return err(withKey('INVALID_STATE', 'errors.exam.alreadyTaken'));
      windowEnd = liveEndsAt(e.startsAt as Date, e.durationMinutes);
    }
    const a = await repo.insertAttempt(exec, {
      examId: e.examId,
      userId,
      startedAt: now,
      deadlineAt: attemptDeadline(now, e.durationMinutes, windowEnd),
    });
    return ok(await sheetOf(exec, e, a, now));
  });
}

export async function saveExamAnswer(
  userId: string,
  raw: SaveExamAnswerInput,
): Promise<Result<{ saved: true }, ExamError>> {
  const input = SaveExamAnswerInput.parse(raw);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const a = await repo.attemptForUpdate(exec, userId, input.attemptId);
    if (!a) return err(appError('NOT_FOUND'));
    if (a.submittedAt || !isAcceptingAnswers(a.deadlineAt, new Date()))
      return err(withKey('INVALID_STATE', 'errors.exam.closed'));
    const e = await repo.examById(exec, a.examId);
    if (!e?.questionIds.includes(input.questionId)) return err(appError('NOT_FOUND'));
    const answers = { ...a.answers };
    if (input.chosenIndex === null) delete answers[input.questionId];
    else answers[input.questionId] = input.chosenIndex;
    await repo.updateAttempt(exec, a.attemptId, { answers });
    return ok({ saved: true as const });
  });
}

export async function submitExamAttempt(
  userId: string,
  raw: AttemptRef,
): Promise<Result<{ attemptId: string }, ExamError>> {
  const input = AttemptRef.parse(raw);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const a = await repo.attemptForUpdate(exec, userId, input.attemptId);
    if (!a) return err(appError('NOT_FOUND'));
    if (!a.submittedAt) {
      const now = new Date();
      await finalize(exec, a, now < a.deadlineAt ? now : a.deadlineAt);
    }
    return ok({ attemptId: a.attemptId });
  });
}

export type ExamResult = {
  attemptId: string;
  examId: string;
  titleBn: string;
  titleEn: string;
  kind: ExamRow['kind'];
  negativeBps: number;
  isSubmitted: boolean;
  isReleased: boolean;
  releasesAt: string | null;
  startedAt: string;
  submittedAt: string | null;
  marking: {
    correct: number;
    wrong: number;
    skipped: number;
    scoreX100: number;
    maxX100: number;
  } | null;
  review: Array<{
    questionId: string;
    promptBn: string;
    promptEn: string;
    optionsBn: string[];
    optionsEn: string[];
    chosenIndex: number | null;
    correctIndex: number;
    explanationBn: string | null;
    explanationEn: string | null;
  }>;
  merit: {
    total: number;
    myRank: number | null;
    top: Array<{ rank: number; name: string; scoreX100: number; isMe: boolean }>;
  } | null;
};

export async function examResult(
  userId: string,
  raw: AttemptRef,
): Promise<Result<ExamResult, AppError<'NOT_FOUND'>>> {
  const input = AttemptRef.parse(raw);
  const db = getDb();
  const now = new Date();
  await closeExpired(db, userId, now);
  const a = await repo.attemptOf(db, userId, input.attemptId);
  if (!a) return err(appError('NOT_FOUND'));
  const e = await repo.examById(db, a.examId);
  if (!e) return err(appError('NOT_FOUND'));
  const released = a.submittedAt !== null && isReleased(e, now);
  const base = {
    attemptId: a.attemptId,
    examId: e.examId,
    titleBn: e.titleBn,
    titleEn: e.titleEn,
    kind: e.kind,
    negativeBps: e.negativeBps,
    isSubmitted: a.submittedAt !== null,
    isReleased: released,
    releasesAt:
      e.kind === 'live' && e.startsAt
        ? liveEndsAt(e.startsAt, e.durationMinutes).toISOString()
        : null,
    startedAt: a.startedAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
  };
  if (!released) return ok({ ...base, marking: null, review: [], merit: null });
  const byId = new Map(
    (await bank.questionsByIds(db, e.questionIds)).map((q) => [q.questionId, q]),
  );
  let merit: ExamResult['merit'] = null;
  if (e.kind === 'live') {
    const all = (await repo.submittedAttempts(db, e.examId)).map((x) => ({
      userId: x.userId,
      scoreX100: x.scoreX100 ?? 0,
      tookMs: (x.submittedAt as Date).getTime() - x.startedAt.getTime(),
    }));
    const ranked = rankMerit(all);
    const top = ranked.slice(0, 10);
    const names = await getIdentity().displayNamesOf(top.map((r) => r.userId));
    merit = {
      total: ranked.length,
      myRank: ranked.find((r) => r.userId === userId)?.rank ?? null,
      top: top.map((r) => ({
        rank: r.rank,
        name: r.userId === userId ? (names[r.userId] ?? '') : maskName(names[r.userId] ?? ''),
        scoreX100: r.scoreX100,
        isMe: r.userId === userId,
      })),
    };
  }
  return ok({
    ...base,
    marking: {
      correct: a.correctCount ?? 0,
      wrong: a.wrongCount ?? 0,
      skipped: a.skippedCount ?? 0,
      scoreX100: a.scoreX100 ?? 0,
      maxX100: a.maxX100 ?? 0,
    },
    review: attemptOrder(e.questionIds, a.attemptId).flatMap((id) => {
      const q = byId.get(id);
      if (!q) return [];
      return [
        {
          questionId: q.questionId,
          promptBn: q.promptBn,
          promptEn: q.promptEn,
          optionsBn: q.optionsBn,
          optionsEn: q.optionsEn,
          chosenIndex: a.answers[id] ?? null,
          correctIndex: q.correctIndex,
          explanationBn: q.explanationBn,
          explanationEn: q.explanationEn,
        },
      ];
    }),
    merit,
  });
}

export type SettleableAnswer = {
  questionId: string;
  topicId: string;
  difficulty: Difficulty;
  chosenIndex: number;
  isCorrect: boolean;
};

/**
 * Submitted attempts whose results are out but whose answers have not yet fed the measured
 * difficulty and the Mistake Vault. Learning records them, then calls markAttemptsSettled.
 */
export async function settleableAttempts(
  userId: string,
): Promise<Array<{ attemptId: string; answers: SettleableAnswer[] }>> {
  const db = getDb();
  const now = new Date();
  const pending = await repo.unsettledOf(db, userId);
  const out: Array<{ attemptId: string; answers: SettleableAnswer[] }> = [];
  for (const a of pending) {
    const e = await repo.examById(db, a.examId);
    if (!e || !isReleased(e, now)) continue;
    const qs = await bank.questionsByIds(db, Object.keys(a.answers));
    out.push({
      attemptId: a.attemptId,
      answers: qs.map((q) => ({
        questionId: q.questionId,
        topicId: q.topicId,
        difficulty: q.effectiveDifficulty,
        chosenIndex: a.answers[q.questionId] as number,
        isCorrect: a.answers[q.questionId] === q.correctIndex,
      })),
    });
  }
  return out;
}

export async function markAttemptsSettled(userId: string, attemptIds: readonly string[]) {
  const db = getDb();
  for (const id of attemptIds) {
    const a = await repo.attemptOf(db, userId, id);
    if (a && !a.settledAt) await repo.updateAttempt(db, id, { settledAt: new Date() });
  }
}

/** Closes expired attempts (exported for the learning wrapper before settling). */
export async function closeExpiredAttempts(userId: string): Promise<void> {
  await closeExpired(getDb(), userId, new Date());
}

// ================================================================= study mode

export type ExploredQuestion = {
  questionId: string;
  difficulty: Difficulty;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
  sourceNote: string | null;
  /** Earlier exams on the platform that used this question (mock tests, finished live exams). */
  appearances: Array<{
    examId: string;
    kind: 'mock' | 'live';
    titleBn: string;
    titleEn: string;
    at: string | null;
  }>;
};

const EXPLORE_PAGE = 15;

/**
 * Study mode: a topic's published questions with their answers and explanations, and where each one
 * appeared before. Only exams the Student could see are listed, and a live exam only once it has
 * ended, so the list never tells which questions an upcoming live exam holds.
 */
export async function exploreQuestions(
  goalId: string | null,
  courseIds: readonly string[],
  raw: ExploreInput,
  grants: ExamGrants = NO_GRANTS,
): Promise<
  Result<{ rows: ExploredQuestion[]; total: number; page: number; pageCount: number }, never>
> {
  const input = ExploreInput.parse(raw);
  const db = getDb();
  const topicIds = await repo.topicFamily(db, input.topicId);
  const { rows, total } = await bank.listQuestions(
    db,
    {
      topicIds,
      status: 'published',
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.q ? { query: input.q } : {}),
    },
    input.page,
    EXPLORE_PAGE,
  );
  const now = new Date();
  const exams = (
    await repo.examsContaining(
      db,
      rows.map((r) => r.questionId),
    )
  ).filter(
    (e) =>
      visibleTo({ ...e, status: 'published' }, '', goalId, courseIds, grants) &&
      (e.kind === 'mock' || liveOf(e, now) === 'ended'),
  );
  return ok({
    rows: rows.map((q) => ({
      questionId: q.questionId,
      difficulty: q.effectiveDifficulty,
      promptBn: q.promptBn,
      promptEn: q.promptEn,
      optionsBn: q.optionsBn,
      optionsEn: q.optionsEn,
      correctIndex: q.correctIndex,
      explanationBn: q.explanationBn,
      explanationEn: q.explanationEn,
      sourceNote: q.sourceNote,
      appearances: exams
        .filter((e) => e.questionIds.includes(q.questionId))
        .map((e) => ({
          examId: e.examId,
          kind: e.kind as 'mock' | 'live',
          titleBn: e.titleBn,
          titleEn: e.titleEn,
          at: (e.startsAt ?? e.publishedAt)?.toISOString() ?? null,
        })),
    })),
    total,
    page: input.page,
    pageCount: Math.max(1, Math.ceil(total / EXPLORE_PAGE)),
  });
}

// ================================================================= battles

/**
 * Published question IDs a battle may draw from: the topic with its sub-topics, or every topic of
 * the goal's subjects when no topic is chosen (at most 500, random).
 */
export async function battleQuestionPool(
  goalId: string,
  topicId: string | null,
): Promise<string[]> {
  const db = getDb();
  let topicIds: string[];
  if (topicId) topicIds = await repo.topicFamily(db, topicId);
  else {
    const subjects = await bank.subjectsOfGoal(db, goalId);
    topicIds = (
      await bank.topics(
        db,
        subjects.map((x) => x.subjectId),
      )
    ).map((x) => x.topicId);
  }
  return repo.pick(db, topicIds, null, 500, []);
}

/** IDs of the topic and its sub-topics (battle vault filtering). */
export async function topicFamilyOf(topicId: string): Promise<string[]> {
  return repo.topicFamily(getDb(), topicId);
}

export type ExamHistoryItem = {
  attemptId: string;
  examId: string;
  kind: ExamRow['kind'];
  titleBn: string;
  titleEn: string;
  submittedAt: string;
  /** Null until a live exam's results are released. */
  scoreX100: number | null;
  maxX100: number | null;
};

/** The Student's submitted exam attempts (results page). */
export async function myExamHistory(userId: string): Promise<ExamHistoryItem[]> {
  const db = getDb();
  const now = new Date();
  await closeExpired(db, userId, now);
  const rows = await repo.submittedOf(db, userId, 200);
  return rows.map(({ a, e }) => {
    const released = isReleased(e, now);
    return {
      attemptId: a.attemptId,
      examId: e.examId,
      kind: e.kind,
      titleBn: e.titleBn,
      titleEn: e.titleEn,
      submittedAt: (a.submittedAt as Date).toISOString(),
      scoreX100: released ? a.scoreX100 : null,
      maxX100: released ? a.maxX100 : null,
    };
  });
}

/**
 * The exams for these published exam package versions, made the first time a buyer needs them:
 * the package's frozen questions and time limit, open only to its buyers. Returns their IDs.
 */
export async function ensurePackageExams(
  packages: ReadonlyArray<{
    versionId: string;
    goalId: string;
    titleBn: string;
    titleEn: string;
    questionIds: readonly string[];
    timeLimitMinutes: number;
  }>,
  createdBy: string,
): Promise<string[]> {
  const db = getDb();
  const ids: string[] = [];
  for (const p of packages) {
    const existing = await repo.examByPackageVersion(db, p.versionId);
    if (existing) {
      ids.push(existing.examId);
      continue;
    }
    const created = await repo.insertPackageExam(db, {
      kind: 'mock',
      status: 'published',
      titleBn: p.titleBn,
      titleEn: p.titleEn,
      goalId: p.goalId,
      durationMinutes: Math.min(300, Math.max(1, p.timeLimitMinutes)),
      negativeBps: 0,
      questionIds: [...p.questionIds].slice(0, MAX_EXAM_QUESTIONS),
      packageVersionId: p.versionId,
      createdBy,
      publishedAt: new Date(),
    });
    ids.push(created.examId);
  }
  return ids;
}
