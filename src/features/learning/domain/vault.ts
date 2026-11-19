// Mistake Vault rules (PRD FR-ADP-1). Plain TypeScript: no framework, DB or env access.
//
// - Every wrong quiz answer puts the question in the Student's vault (or back into it), with the
//   choice they made, when, and the Goal of the course it came from.
// - Vault practice resurfaces active items; two consecutive correct answers master an item and take
//   it out of the queue. A wrong answer resets the run and, for a mastered item, reactivates it.
// - Items of the Student's current Goal come first; other Goals' items are kept, only de-prioritised.
//
// v1 similarity: the PRD matches "similar" questions by topic + difficulty tags, which the question
// bank does not carry yet. Until it does, an item resurfaces as the question itself (the PRD allows
// already-seen questions), and its lesson stands in for the topic when grouping.

export const MASTERY_STREAK = 2;
export const PRACTICE_SESSION_SIZE = 10;

export type VaultStatus = 'active' | 'mastered';

export type VaultItemState = {
  status: VaultStatus;
  /** Consecutive correct answers in vault practice since the last wrong one. */
  correctRun: number;
  wrongCount: number;
  lastWrongAt: Date;
  lastPractisedAt: Date | null;
  masteredAt: Date | null;
};

/** A wrong quiz answer: a new item, or an existing one sent back to the start. */
export function recordWrong(item: VaultItemState | null, at: Date): VaultItemState {
  return {
    status: 'active',
    correctRun: 0,
    wrongCount: (item?.wrongCount ?? 0) + 1,
    lastWrongAt: at,
    lastPractisedAt: item?.lastPractisedAt ?? null,
    masteredAt: null,
  };
}

/** One answer in vault practice. */
export function applyPracticeAnswer(
  item: VaultItemState,
  isCorrect: boolean,
  at: Date,
): VaultItemState {
  if (!isCorrect) return { ...recordWrong(item, at), lastPractisedAt: at };
  const correctRun = item.correctRun + 1;
  const isMastered = item.status === 'mastered' || correctRun >= MASTERY_STREAK;
  return {
    ...item,
    correctRun,
    lastPractisedAt: at,
    status: isMastered ? 'mastered' : 'active',
    masteredAt: isMastered ? (item.masteredAt ?? at) : null,
  };
}

export type QueueItem = {
  questionId: string;
  goalId: string | null;
  status: VaultStatus;
  lastWrongAt: Date;
  lastPractisedAt: Date | null;
};

/**
 * The practice order: active items only; the current Goal's first; within a group the item that
 * has waited longest since it was last practised (never-practised first), then the oldest mistake;
 * the question ID breaks ties so the order is stable.
 */
export function practiceQueue<T extends QueueItem>(
  items: readonly T[],
  currentGoalId: string | null,
  size: number = PRACTICE_SESSION_SIZE,
): T[] {
  const time = (d: Date | null) => (d === null ? Number.NEGATIVE_INFINITY : d.getTime());
  return items
    .filter((i) => i.status === 'active')
    .sort((a, b) => {
      const ga = a.goalId === currentGoalId ? 0 : 1;
      const gb = b.goalId === currentGoalId ? 0 : 1;
      if (ga !== gb) return ga - gb;
      const pa = time(a.lastPractisedAt);
      const pb = time(b.lastPractisedAt);
      if (pa !== pb) return pa - pb;
      const wa = a.lastWrongAt.getTime();
      const wb = b.lastWrongAt.getTime();
      if (wa !== wb) return wa - wb;
      return a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0;
    })
    .slice(0, size);
}
