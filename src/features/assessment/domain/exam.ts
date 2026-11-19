// Exam rules (U4 Assessment): marking with negative marks, the answer window, the blueprint that
// picks questions from the bank, and the merit list. Plain TypeScript.

export const EXAM_KINDS = ['mock', 'live', 'custom'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

/** Marks are kept in hundredths so a 0.25 or 0.5 negative mark stays an integer. */
export const MARK = 100;

export type BlueprintRow = {
  topicId: string;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  count: number;
};

export const MAX_EXAM_QUESTIONS = 200;

export function blueprintSize(rows: readonly BlueprintRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0);
}

export type Marking = {
  correct: number;
  wrong: number;
  skipped: number;
  /** Score in hundredths of a mark (may be negative). */
  scoreX100: number;
  maxX100: number;
};

/**
 * One mark for a right answer; a wrong one loses `negativeBps` / 10 000 of a mark (5000 = 0.5,
 * BCS preliminary); a skipped question scores nothing. Rounded towards zero per wrong answer.
 */
export function markAttempt(
  key: ReadonlyArray<{ questionId: string; correctIndex: number }>,
  answers: Readonly<Record<string, number>>,
  negativeBps: number,
): Marking {
  let correct = 0;
  let wrong = 0;
  for (const q of key) {
    const chosen = answers[q.questionId];
    if (chosen === undefined) continue;
    if (chosen === q.correctIndex) correct += 1;
    else wrong += 1;
  }
  const penalty = Math.trunc((wrong * negativeBps * MARK) / 10_000);
  return {
    correct,
    wrong,
    skipped: key.length - correct - wrong,
    scoreX100: correct * MARK - penalty,
    maxX100: key.length * MARK,
  };
}

/** When an attempt must be in: its own duration, cut short by a live exam's window end. */
export function attemptDeadline(
  startedAt: Date,
  durationMinutes: number,
  windowEndsAt: Date | null,
): Date {
  const own = new Date(startedAt.getTime() + durationMinutes * 60_000);
  return windowEndsAt && windowEndsAt < own ? windowEndsAt : own;
}

/** A small grace for network delay on the final save. */
export const SUBMIT_GRACE_MS = 30_000;

export function isAcceptingAnswers(deadline: Date, now: Date): boolean {
  return now.getTime() <= deadline.getTime() + SUBMIT_GRACE_MS;
}

export type LiveState = 'upcoming' | 'open' | 'ended';

/** A live exam is open from its start for its duration; results come out once it ends. */
export function liveState(startsAt: Date, durationMinutes: number, now: Date): LiveState {
  const end = startsAt.getTime() + durationMinutes * 60_000;
  if (now.getTime() < startsAt.getTime()) return 'upcoming';
  if (now.getTime() < end) return 'open';
  return 'ended';
}

export function liveEndsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

export type MeritEntry = { userId: string; scoreX100: number; tookMs: number };

/** Higher score first; equal scores by less time taken; ties share a rank (1, 2, 2, 4). */
export function rankMerit<T extends MeritEntry>(
  entries: readonly T[],
): Array<T & { rank: number }> {
  const sorted = [...entries].sort(
    (a, b) => b.scoreX100 - a.scoreX100 || a.tookMs - b.tookMs || a.userId.localeCompare(b.userId),
  );
  return sorted.map((e, i) => {
    let rank = i + 1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const p = sorted[j] as T;
      if (p.scoreX100 === e.scoreX100 && p.tookMs === e.tookMs) rank = j + 1;
      else break;
    }
    return { ...e, rank };
  });
}

export { dhakaLocalToUtc, utcToDhakaLocal } from '#src/lib/dhaka-time.ts';
export { maskName } from '#src/lib/mask-name.ts';

/**
 * The question order one attempt sees: a shuffle seeded by the attempt ID, so every Student gets the
 * same questions in their own order, and a resumed attempt or its review shows the same order again.
 */
export function attemptOrder<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  let state = h >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
