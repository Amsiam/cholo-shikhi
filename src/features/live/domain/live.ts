// Live class rules (U8 LiveClass): when a class is open, how a pop-quiz walks through its questions
// (60 seconds each, everyone on the same question), how attendance time is counted, and the
// per-question heatmap. Plain TypeScript.

/** Students may open the room this long before the start. */
export const LOBBY_OPEN_MS = 15 * 60_000;
export const QUESTION_SECONDS = 60;
export const MAX_QUIZ_QUESTIONS = 10;
/** A heartbeat counts at most this much active time, so a sleeping tab cannot pile up minutes. */
export const MAX_HEARTBEAT_SECONDS = 60;

export type LiveState = 'upcoming' | 'open' | 'live' | 'ended';

/** upcoming → open (lobby, 15 minutes before) → live → ended (after the planned length). */
export function liveClassState(startsAt: Date, durationMinutes: number, now: Date): LiveState {
  const t = now.getTime();
  const start = startsAt.getTime();
  if (t < start - LOBBY_OPEN_MS) return 'upcoming';
  if (t < start) return 'open';
  if (t < start + durationMinutes * 60_000) return 'live';
  return 'ended';
}

export type QuizClock =
  | { phase: 'running'; index: number; opensAt: Date; closesAt: Date }
  | { phase: 'over' };

/** Which question is open now: question i runs from start + i·60 s for 60 s; then the quiz is over. */
export function quizClock(startedAt: Date, questionCount: number, now: Date): QuizClock {
  const elapsed = now.getTime() - startedAt.getTime();
  const index = Math.floor(Math.max(0, elapsed) / (QUESTION_SECONDS * 1000));
  if (index >= questionCount) return { phase: 'over' };
  const opensAt = new Date(startedAt.getTime() + index * QUESTION_SECONDS * 1000);
  return {
    phase: 'running',
    index,
    opensAt,
    closesAt: new Date(opensAt.getTime() + QUESTION_SECONDS * 1000),
  };
}

/** Active seconds a heartbeat adds: the time since the last one, only while the tab is visible, capped. */
export function heartbeatSeconds(lastSeenAt: Date | null, now: Date, isVisible: boolean): number {
  if (!isVisible || !lastSeenAt) return 0;
  const seconds = Math.floor((now.getTime() - lastSeenAt.getTime()) / 1000);
  return Math.min(MAX_HEARTBEAT_SECONDS, Math.max(0, seconds));
}

export type HeatmapRow = {
  questionId: string;
  answered: number;
  correct: number;
  /** Whole percent right, or null before anyone answers. */
  percent: number | null;
  /** How many chose each option (A–D). */
  choices: [number, number, number, number];
};

export function heatmap(
  questions: ReadonlyArray<{ questionId: string; correctIndex: number }>,
  answers: ReadonlyArray<{ questionId: string; chosenIndex: number }>,
): HeatmapRow[] {
  return questions.map((q) => {
    const mine = answers.filter((a) => a.questionId === q.questionId);
    const choices: [number, number, number, number] = [0, 0, 0, 0];
    for (const a of mine)
      if (a.chosenIndex >= 0 && a.chosenIndex <= 3) choices[a.chosenIndex as 0 | 1 | 2 | 3] += 1;
    const correct = choices[q.correctIndex] ?? 0;
    return {
      questionId: q.questionId,
      answered: mine.length,
      correct,
      percent: mine.length === 0 ? null : Math.floor((correct / mine.length) * 100),
      choices,
    };
  });
}

export type QuizAnswerFact = {
  userId: string;
  questionId: string;
  isCorrect: boolean;
  answeredAt: Date;
};

/**
 * The live pop-quiz's streak-shield winners (US5.6): the fixed top N by score, ties broken by the
 * lower total answer time, then the earlier last answer, then the lower account ID, so exactly N
 * are chosen. A score of 0 never earns a shield.
 */
export function shieldWinners(
  startedAt: Date,
  questionIds: readonly string[],
  answers: readonly QuizAnswerFact[],
  topN: number,
): string[] {
  const opensAt = new Map(
    questionIds.map((id, i) => [id, startedAt.getTime() + i * QUESTION_SECONDS * 1000]),
  );
  const byUser = new Map<string, { score: number; totalMs: number; lastAt: number }>();
  for (const a of answers) {
    const open = opensAt.get(a.questionId);
    if (open === undefined) continue;
    const s = byUser.get(a.userId) ?? { score: 0, totalMs: 0, lastAt: 0 };
    s.score += a.isCorrect ? 1 : 0;
    s.totalMs += Math.max(0, a.answeredAt.getTime() - open);
    s.lastAt = Math.max(s.lastAt, a.answeredAt.getTime());
    byUser.set(a.userId, s);
  }
  return [...byUser.entries()]
    .filter(([, s]) => s.score > 0)
    .sort(
      ([ua, a], [ub, b]) =>
        b.score - a.score ||
        a.totalMs - b.totalMs ||
        a.lastAt - b.lastAt ||
        (ua < ub ? -1 : ua > ub ? 1 : 0),
    )
    .slice(0, Math.max(0, topN))
    .map(([userId]) => userId);
}
