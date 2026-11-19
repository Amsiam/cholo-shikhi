// Quiz battle rules (U7 Battle): every player gets the same questions and the same time, answers at
// their own pace, and is ranked by right answers, then by time taken. Matching stays inside one
// battle band (tier), never across. Plain TypeScript.

export const BATTLE_MODES = ['quick', 'friend', 'hosted'] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];
export type BattleStatus = 'waiting' | 'running' | 'finished' | 'cancelled';
export type BattleSource = 'bank' | 'vault';

/** A quick match without an opponent within this time is called off (FR-RTN-4). */
export const QUICK_WAIT_MS = 90_000;
/** Students may still join a hosted battle this long after it starts. */
export const HOSTED_LATE_JOIN_MS = 60_000;
export const SECONDS_PER_QUESTION = 30;
export const DEFAULT_QUESTIONS = 10;
export const MAX_PLAYERS: Record<BattleMode, number> = { quick: 2, friend: 10, hosted: 500 };

export function durationSecondsFor(questionCount: number): number {
  return questionCount * SECONDS_PER_QUESTION;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A six-character room code without look-alike characters (0/O, 1/I/L). */
export function makeJoinCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normaliseJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

export type BattleClock = {
  mode: BattleMode;
  status: BattleStatus;
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  playerCount: number;
};

/**
 * The status a battle has now. Stored status moves forward lazily: a quick match left alone too
 * long is cancelled, a hosted battle starts at its time, and a running battle finishes when its
 * time is up.
 */
export function effectiveStatus(b: BattleClock, now: Date): BattleStatus {
  const t = now.getTime();
  if (b.status === 'waiting') {
    if (b.mode === 'quick' && b.playerCount < 2 && t - b.createdAt.getTime() >= QUICK_WAIT_MS)
      return 'cancelled';
    if (b.mode === 'hosted' && b.startsAt && t >= b.startsAt.getTime())
      return b.endsAt && t >= b.endsAt.getTime() ? 'finished' : 'running';
    return 'waiting';
  }
  if (b.status === 'running' && b.endsAt && t >= b.endsAt.getTime()) return 'finished';
  return b.status;
}

export function canJoin(b: BattleClock, maxPlayers: number, now: Date): boolean {
  if (b.playerCount >= maxPlayers) return false;
  const status = effectiveStatus(b, now);
  if (status === 'waiting') return true;
  // A hosted battle takes latecomers for a short while.
  return (
    b.mode === 'hosted' &&
    status === 'running' &&
    b.startsAt !== null &&
    now.getTime() - b.startsAt.getTime() < HOSTED_LATE_JOIN_MS
  );
}

export type Standing = { userId: string; correct: number; tookMs: number; finished: boolean };

/** Most right answers first, then the faster; exact ties share a place (1, 2, 2, 4). */
export function rankStandings<T extends Standing>(rows: readonly T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort(
    (a, b) => b.correct - a.correct || a.tookMs - b.tookMs || a.userId.localeCompare(b.userId),
  );
  return sorted.map((r, i) => {
    let rank = i + 1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const p = sorted[j] as T;
      if (p.correct === r.correct && p.tookMs === r.tookMs) rank = j + 1;
      else break;
    }
    return { ...r, rank };
  });
}

/**
 * Battle questions: from the players' Mistake Vaults first when asked (shuffled), topped up from
 * the bank, never repeating a question.
 */
export function chooseQuestions(
  vaultPool: readonly string[],
  bankPool: readonly string[],
  count: number,
  random: () => number,
): string[] {
  const shuffle = (xs: readonly string[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j] as string, out[i] as string];
    }
    return out;
  };
  const picked = new Set<string>();
  for (const id of [...shuffle(vaultPool), ...shuffle(bankPool)]) {
    if (picked.size >= count) break;
    picked.add(id);
  }
  return [...picked];
}
