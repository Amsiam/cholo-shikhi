// Live classes (U8) on YouTube Live (feasibility Q12=A). Course staff schedule a class with its
// YouTube link; enrolled Students (also on a trial or a plan) watch it inside the app, which records
// their attendance from heartbeats (visible-tab time only). During the class the teacher fires a
// pop-quiz from the question bank: everyone gets the same question at the same minute, a question
// is only sent once it opens, and the teacher sees a per-question heatmap (FR-ADP-4).

import type { StudentQuestion } from '#src/features/assessment/index.ts';
import {
  bankQuestionsByIds,
  battleQuestionPool,
  toStudentQuestion,
} from '#src/features/assessment/index.ts';
import {
  canScheduleLive,
  courseTitlesOf,
  getPublishedCourse,
  listInstructorCourses,
  parseYoutubeVideoId,
} from '#src/features/catalog/index.ts';
import {
  courseAccessOf,
  entitlementsOf,
  listActiveEnrolments,
  listTrialsOf,
} from '#src/features/commerce/index.ts';
import { type Actor, getIdentity } from '#src/features/identity-access/index.ts';
import { awardQuizShields, recordLiveActivity, shieldTopN } from '#src/features/learning/index.ts';
import { dhakaLocalToUtc, utcToDhakaLocal } from '#src/lib/dhaka-time.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  createLiveRepository,
  type LiveClassRow,
  type LiveQuizRow,
} from '../data/live.repository.ts';
import {
  type HeatmapRow,
  heartbeatSeconds,
  heatmap,
  type LiveState,
  liveClassState,
  MAX_QUIZ_QUESTIONS,
  quizClock,
  shieldWinners,
} from '../domain/live.ts';
import {
  FireQuizInput,
  HeartbeatInput,
  LiveAnswerInput,
  LiveRef,
  ScheduleLiveInput,
} from './live.schema.ts';

const repo = createLiveRepository();
type LiveError = AppError<'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'INVALID_STATE'>;
const withKey = <C extends LiveError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
/** Someone whose heartbeat is this recent counts as in the room now. */
const PRESENT_MS = 90_000;

export type LiveClassCard = {
  liveClassId: string;
  courseId: string;
  courseTitleBn: string;
  courseTitleEn: string;
  titleBn: string;
  titleEn: string;
  startsAt: string;
  startsAtLocal: string;
  durationMinutes: number;
  state: LiveState;
  isCancelled: boolean;
  keepsRecording: boolean;
  youtubeVideoId: string;
};

async function cards(rows: readonly LiveClassRow[], now: Date): Promise<LiveClassCard[]> {
  const titles = await courseTitlesOf([...new Set(rows.map((r) => r.courseId))]);
  return rows.map((r) => ({
    liveClassId: r.liveClassId,
    courseId: r.courseId,
    courseTitleBn: titles[r.courseId]?.titleBn ?? '',
    courseTitleEn: titles[r.courseId]?.titleEn ?? '',
    titleBn: r.titleBn,
    titleEn: r.titleEn,
    startsAt: r.startsAt.toISOString(),
    startsAtLocal: utcToDhakaLocal(r.startsAt),
    durationMinutes: r.durationMinutes,
    state: liveClassState(r.startsAt, r.durationMinutes, now),
    isCancelled: r.isCancelled,
    keepsRecording: r.keepsRecording,
    youtubeVideoId: r.youtubeVideoId,
  }));
}

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

// ================================================================= staff

export async function scheduleLive(
  actor: Actor,
  raw: ScheduleLiveInput,
): Promise<Result<LiveClassCard, LiveError>> {
  const input = ScheduleLiveInput.parse(raw);
  const allowed = await canScheduleLive(actor, input.courseId);
  if (!allowed.ok) return err(withKey(allowed.error.code, 'errors.live.notYourCourse'));
  const videoId = parseYoutubeVideoId(input.youtubeUrl);
  if (!videoId)
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { youtubeUrl: ['errors.live.youtubeInvalid'] },
      }),
    );
  const startsAt = dhakaLocalToUtc(input.startsAtLocal);
  if (!startsAt)
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { startsAtLocal: ['errors.exam.startRequired'] },
      }),
    );
  const db = getDb();
  const fields = {
    courseId: input.courseId,
    titleBn: input.titleBn,
    titleEn: input.titleEn,
    youtubeVideoId: videoId,
    startsAt,
    durationMinutes: input.durationMinutes,
    keepsRecording: input.keepsRecording,
  };
  if (input.liveClassId) {
    const existing = await repo.byId(db, input.liveClassId);
    if (!existing) return err(appError('NOT_FOUND'));
    const mayEdit = await canScheduleLive(actor, existing.courseId);
    if (!mayEdit.ok) return err(appError('NOT_FOUND'));
    const [card] = await cards([await repo.update(db, existing.liveClassId, fields)], new Date());
    return ok(card as LiveClassCard);
  }
  if (startsAt.getTime() <= Date.now())
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { startsAtLocal: ['errors.exam.startInPast'] },
      }),
    );
  const [card] = await cards(
    [await repo.insert(db, { ...fields, createdBy: actor.userId })],
    new Date(),
  );
  return ok(card as LiveClassCard);
}

export async function cancelLive(
  actor: Actor,
  raw: LiveRef,
): Promise<Result<LiveClassCard, LiveError>> {
  const input = LiveRef.parse(raw);
  const db = getDb();
  const existing = await repo.byId(db, input.liveClassId);
  if (!existing || !(await canScheduleLive(actor, existing.courseId)).ok)
    return err(appError('NOT_FOUND'));
  const [card] = await cards(
    [await repo.update(db, existing.liveClassId, { isCancelled: true })],
    new Date(),
  );
  return ok(card as LiveClassCard);
}

export async function staffLiveClasses(actor: Actor): Promise<
  Result<
    {
      classes: LiveClassCard[];
      courses: Array<{ courseId: string; titleBn: string; titleEn: string }>;
    },
    never
  >
> {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const courseIds = await teachingCourseIds(actor);
  const rows = actor.roles.includes('admin')
    ? await repo.allFrom(db, since, 200)
    : await repo.forCourses(db, courseIds, since, 200);
  const titles = await courseTitlesOf(courseIds);
  return ok({
    classes: await cards(rows, new Date()),
    courses: courseIds.map((courseId) => ({
      courseId,
      titleBn: titles[courseId]?.titleBn ?? '',
      titleEn: titles[courseId]?.titleEn ?? '',
    })),
  });
}

export type QuizReport = {
  quizId: string;
  startedAt: string;
  phase: 'running' | 'over';
  currentIndex: number | null;
  closesAt: string | null;
  questions: Array<{
    questionId: string;
    promptBn: string;
    promptEn: string;
    correctIndex: number;
  }>;
  heatmap: HeatmapRow[];
  /** How many Students earned a streak-shield (after the quiz). */
  shieldWinners: number;
};

/**
 * Once a pop-quiz is over, its top N finishers each earn one streak-shield (US5.6). Lazy and
 * idempotent: the first read after the quiz ends claims the award and hands the shields out in the
 * same transaction. Returns the winners.
 */
async function settleShields(quiz: LiveQuizRow, now: Date): Promise<string[]> {
  const db = getDb();
  const winners = shieldWinners(
    quiz.startedAt,
    quiz.questionIds,
    await repo.answers(db, [quiz.quizId]),
    await shieldTopN(),
  );
  if (quiz.shieldsAwardedAt) return winners;
  await withTransaction(db, async (tx) => {
    const exec = unwrapTx(tx);
    if (await repo.claimShieldAward(exec, quiz.quizId, now))
      await awardQuizShields(exec, quiz.quizId, winners, now);
  });
  return winners;
}

async function reportOf(quiz: LiveQuizRow, now: Date): Promise<QuizReport> {
  const db = getDb();
  const [qs, answers] = await Promise.all([
    bankQuestionsByIds(quiz.questionIds),
    repo.answers(db, [quiz.quizId]),
  ]);
  const byId = new Map(qs.map((q) => [q.questionId, q]));
  const ordered = quiz.questionIds.flatMap((id) => {
    const q = byId.get(id);
    return q ? [q] : [];
  });
  const clock = quizClock(quiz.startedAt, quiz.questionIds.length, now);
  // The heatmap shows a question only once it has closed, so the room is not steered mid-question.
  const closedCount = clock.phase === 'over' ? ordered.length : clock.index;
  const winners = clock.phase === 'over' ? await settleShields(quiz, now) : [];
  return {
    quizId: quiz.quizId,
    shieldWinners: winners.length,
    startedAt: quiz.startedAt.toISOString(),
    phase: clock.phase,
    currentIndex: clock.phase === 'running' ? clock.index : null,
    closesAt: clock.phase === 'running' ? clock.closesAt.toISOString() : null,
    questions: ordered.map((q) => ({
      questionId: q.questionId,
      promptBn: q.promptBn,
      promptEn: q.promptEn,
      correctIndex: q.correctIndex,
    })),
    heatmap: heatmap(
      ordered
        .slice(0, closedCount)
        .map((q) => ({ questionId: q.questionId, correctIndex: q.correctIndex })),
      answers,
    ),
  };
}

export type LiveControl = {
  liveClass: LiveClassCard;
  joined: number;
  presentNow: number;
  averageActiveMinutes: number;
  /**
   * US6.3: each Student who joined, with when they first joined, when they were last seen (the
   * leave time once they are gone), their visible-tab minutes and that time as a share of the class.
   */
  attendees: Array<{
    name: string;
    firstJoinAt: string;
    lastSeenAt: string;
    isPresent: boolean;
    activeMinutes: number;
    activeBps: number;
  }>;
  quizzes: QuizReport[];
  serverNow: string;
};

/** The teacher's control room: attendance and every pop-quiz with its heatmap. */
export async function liveControl(
  actor: Actor,
  raw: LiveRef,
): Promise<Result<LiveControl, LiveError>> {
  const input = LiveRef.parse(raw);
  const db = getDb();
  const row = await repo.byId(db, input.liveClassId);
  if (!row || !(await canScheduleLive(actor, row.courseId)).ok) return err(appError('NOT_FOUND'));
  const now = new Date();
  const [attendance, quizzes] = await Promise.all([
    repo.attendance(db, row.liveClassId),
    repo.quizzes(db, row.liveClassId),
  ]);
  const [card] = await cards([row], now);
  const names = await getIdentity().displayNamesOf(attendance.map((a) => a.userId));
  const classSeconds = row.durationMinutes * 60;
  const attendees = [...attendance]
    .sort((a, b) => a.firstJoinAt.getTime() - b.firstJoinAt.getTime())
    .map((a) => ({
      name: names[a.userId] ?? '',
      firstJoinAt: a.firstJoinAt.toISOString(),
      lastSeenAt: a.lastSeenAt.toISOString(),
      isPresent: now.getTime() - a.lastSeenAt.getTime() < PRESENT_MS,
      activeMinutes: Math.round(a.activeSeconds / 60),
      activeBps: Math.min(10_000, Math.floor((a.activeSeconds * 10_000) / classSeconds)),
    }));
  return ok({
    liveClass: card as LiveClassCard,
    joined: attendance.length,
    attendees,
    presentNow: attendance.filter((a) => now.getTime() - a.lastSeenAt.getTime() < PRESENT_MS)
      .length,
    averageActiveMinutes:
      attendance.length === 0
        ? 0
        : Math.round(attendance.reduce((s, a) => s + a.activeSeconds, 0) / attendance.length / 60),
    quizzes: await Promise.all(quizzes.map((q) => reportOf(q, now))),
    serverNow: now.toISOString(),
  });
}

/** Fires a pop-quiz of up to 10 bank questions (one topic, or the course goal's subjects). */
export async function fireQuiz(
  actor: Actor,
  raw: FireQuizInput,
): Promise<Result<QuizReport, LiveError>> {
  const input = FireQuizInput.parse(raw);
  const db = getDb();
  const row = await repo.byId(db, input.liveClassId);
  if (!row || !(await canScheduleLive(actor, row.courseId)).ok) return err(appError('NOT_FOUND'));
  const now = new Date();
  const state = liveClassState(row.startsAt, row.durationMinutes, now);
  if (row.isCancelled || (state !== 'live' && state !== 'open'))
    return err(withKey('INVALID_STATE', 'errors.live.notLive'));
  const running = (await repo.quizzes(db, row.liveClassId)).some(
    (q) => quizClock(q.startedAt, q.questionIds.length, now).phase === 'running',
  );
  if (running) return err(withKey('INVALID_STATE', 'errors.live.quizRunning'));
  const course = await getPublishedCourse(row.courseId);
  if (!course.ok) return err(appError('NOT_FOUND'));
  const pool = await battleQuestionPool(course.value.goal.goalId, input.topicId ?? null);
  if (pool.length === 0) return err(withKey('INVALID_STATE', 'errors.battle.noQuestions'));
  const quiz = await repo.insertQuiz(db, {
    liveClassId: row.liveClassId,
    questionIds: pool.slice(0, Math.min(input.count, MAX_QUIZ_QUESTIONS)),
    startedAt: now,
    startedBy: actor.userId,
  });
  return ok(await reportOf(quiz, now));
}

// ================================================================= Students

async function openCourseIdsOf(userId: string): Promise<string[]> {
  const now = Date.now();
  const [enrolments, trials, ent] = await Promise.all([
    listActiveEnrolments(userId),
    listTrialsOf(userId),
    entitlementsOf(userId),
  ]);
  return [
    ...new Set([
      ...enrolments.map((e) => e.courseId),
      ...trials.filter((t) => new Date(t.endsAt).getTime() > now).map((t) => t.courseId),
      ...ent.planCourses.map((c) => c.courseId),
    ]),
  ];
}

export async function myLiveClasses(
  actor: Actor,
): Promise<Result<{ upcoming: LiveClassCard[]; recordings: LiveClassCard[] }, never>> {
  const db = getDb();
  const now = new Date();
  const courseIds = await openCourseIdsOf(actor.userId);
  const [upcoming, recordings] = await Promise.all([
    repo.forCourses(db, courseIds, now, 50),
    repo.recordings(db, courseIds, now, 20),
  ]);
  return ok({
    upcoming: (await cards(upcoming, now)).filter((c) => !c.isCancelled),
    recordings: await cards(recordings, now),
  });
}

export type StudentQuiz = {
  quizId: string;
  phase: 'running' | 'over';
  index: number | null;
  total: number;
  closesAt: string | null;
  /** The open question (no answer), only while it is open. */
  question: StudentQuestion | null;
  myChoice: number | null;
  /** After the quiz: every question with the right answer and the Student's choice. */
  review: Array<{
    questionId: string;
    promptBn: string;
    promptEn: string;
    optionsBn: string[];
    optionsEn: string[];
    correctIndex: number;
    chosenIndex: number | null;
  }>;
  myScore: number | null;
  /** After the quiz: the Student finished in the top N and earned a streak-shield. */
  earnedShield: boolean;
};

export type LiveRoom = {
  liveClass: LiveClassCard;
  /** Shown only while the room is open or live, or afterwards when the recording is kept. */
  videoId: string | null;
  quiz: StudentQuiz | null;
  serverNow: string;
};

async function studentQuiz(quiz: LiveQuizRow, userId: string, now: Date): Promise<StudentQuiz> {
  const db = getDb();
  const clock = quizClock(quiz.startedAt, quiz.questionIds.length, now);
  const answers = (await repo.answers(db, [quiz.quizId])).filter((a) => a.userId === userId);
  const mine = new Map(answers.map((a) => [a.questionId, a.chosenIndex]));
  if (clock.phase === 'running') {
    const id = quiz.questionIds[clock.index] as string;
    const [q] = await bankQuestionsByIds([id]);
    return {
      quizId: quiz.quizId,
      phase: 'running',
      index: clock.index,
      total: quiz.questionIds.length,
      closesAt: clock.closesAt.toISOString(),
      question: q ? toStudentQuestion(q) : null,
      myChoice: mine.get(id) ?? null,
      review: [],
      myScore: null,
      earnedShield: false,
    };
  }
  const qs = new Map((await bankQuestionsByIds(quiz.questionIds)).map((q) => [q.questionId, q]));
  const review = quiz.questionIds.flatMap((id) => {
    const q = qs.get(id);
    return q
      ? [
          {
            questionId: id,
            promptBn: q.promptBn,
            promptEn: q.promptEn,
            optionsBn: q.optionsBn,
            optionsEn: q.optionsEn,
            correctIndex: q.correctIndex,
            chosenIndex: mine.get(id) ?? null,
          },
        ]
      : [];
  });
  return {
    quizId: quiz.quizId,
    phase: 'over',
    index: null,
    total: quiz.questionIds.length,
    closesAt: null,
    question: null,
    myChoice: null,
    review,
    myScore: answers.filter((a) => a.isCorrect).length,
    earnedShield: (await settleShields(quiz, now)).includes(userId),
  };
}

export async function liveRoom(actor: Actor, raw: LiveRef): Promise<Result<LiveRoom, LiveError>> {
  const input = LiveRef.parse(raw);
  const db = getDb();
  const row = await repo.byId(db, input.liveClassId);
  if (!row || row.isCancelled || !(await courseAccessOf(actor.userId, row.courseId)))
    return err(appError('NOT_FOUND'));
  const now = new Date();
  const [card] = await cards([row], now);
  const state = (card as LiveClassCard).state;
  const quizzes = await repo.quizzes(db, row.liveClassId);
  const latest = quizzes.at(-1);
  return ok({
    liveClass: card as LiveClassCard,
    videoId:
      state === 'open' || state === 'live' || (state === 'ended' && row.keepsRecording)
        ? row.youtubeVideoId
        : null,
    quiz: latest ? await studentQuiz(latest, actor.userId, now) : null,
    serverNow: now.toISOString(),
  });
}

/** Attendance: the first heartbeat records the join; later ones add visible-tab time (US6.3). */
export async function heartbeat(
  actor: Actor,
  raw: HeartbeatInput,
): Promise<Result<{ ok: true }, LiveError>> {
  const input = HeartbeatInput.parse(raw);
  const db = getDb();
  const row = await repo.byId(db, input.liveClassId);
  if (!row || row.isCancelled || !(await courseAccessOf(actor.userId, row.courseId)))
    return err(appError('NOT_FOUND'));
  const now = new Date();
  const state = liveClassState(row.startsAt, row.durationMinutes, now);
  if (state !== 'open' && state !== 'live') return ok({ ok: true as const });
  return withTransaction(db, async (tx) => {
    const exec = unwrapTx(tx);
    // Attending the class itself (not the lobby) is the day's qualifying activity (FR5.1).
    if (state === 'live') await recordLiveActivity(exec, actor.userId, row.courseId, now);
    const seen = await repo.attendanceOf(exec, row.liveClassId, actor.userId);
    if (!seen) {
      await repo.insertAttendance(exec, {
        liveClassId: row.liveClassId,
        userId: actor.userId,
        firstJoinAt: now,
        lastSeenAt: now,
      });
      return ok({ ok: true as const });
    }
    // Only time inside the class itself counts, not the lobby before it.
    const counted = state === 'live' ? heartbeatSeconds(seen.lastSeenAt, now, input.isVisible) : 0;
    await repo.updateAttendance(exec, row.liveClassId, actor.userId, now, counted);
    return ok({ ok: true as const });
  });
}

/** One answer per question, only while that question is open. */
export async function answerLive(
  actor: Actor,
  raw: LiveAnswerInput,
): Promise<Result<{ saved: boolean }, LiveError>> {
  const input = LiveAnswerInput.parse(raw);
  const db = getDb();
  const quiz = await repo.quizById(db, input.quizId);
  const row = quiz ? await repo.byId(db, quiz.liveClassId) : null;
  if (!quiz || !row || !(await courseAccessOf(actor.userId, row.courseId)))
    return err(appError('NOT_FOUND'));
  const clock = quizClock(quiz.startedAt, quiz.questionIds.length, new Date());
  if (clock.phase !== 'running' || quiz.questionIds[clock.index] !== input.questionId)
    return err(withKey('INVALID_STATE', 'errors.live.questionClosed'));
  const [q] = await bankQuestionsByIds([input.questionId]);
  if (!q) return err(appError('NOT_FOUND'));
  const saved = await repo.insertAnswer(db, {
    quizId: quiz.quizId,
    userId: actor.userId,
    questionId: input.questionId,
    chosenIndex: input.chosenIndex,
    isCorrect: input.chosenIndex === q.correctIndex,
  });
  return ok({ saved });
}

/** Upcoming live classes of a course (course page), for its Students. */
export async function courseLiveClasses(actor: Actor, courseId: string): Promise<LiveClassCard[]> {
  if (!(await courseAccessOf(actor.userId, courseId))) return [];
  const now = new Date();
  return (await cards(await repo.forCourses(getDb(), [courseId], now, 10), now)).filter(
    (c) => !c.isCancelled,
  );
}
