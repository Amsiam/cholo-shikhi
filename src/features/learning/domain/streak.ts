// Goal streak (PRD FR-RTN-1). Plain TypeScript: no framework, DB or env access.
//
// A day counts when the Student did at least one qualifying activity for their current Goal:
// finished a lesson, attempted a quiz or practised in the Mistake Vault (live-class attendance
// joins when live classes ship). Days are calendar days in Asia/Dhaka. The streak is the run of
// consecutive counted days ending today; until midnight a run that ended yesterday is still alive
// (today can still extend it), and it resets to 0 once a whole day is missed. Only days since the
// current Goal was chosen count, so switching Goals starts again at 0 (no carry-over).
//
// The streak is computed from the recorded activity, never stored, so it cannot drift.

/** Asia/Dhaka is UTC+6 all year (no daylight saving). */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** The Asia/Dhaka calendar day of an instant, as YYYY-MM-DD. */
export function dhakaDay(at: Date): string {
  return new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The day before (or after, with a positive step) a YYYY-MM-DD day. */
export function shiftDay(day: string, step: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + step);
  return d.toISOString().slice(0, 10);
}

export type Streak = {
  current: number;
  best: number;
  isActiveToday: boolean;
  /** The last 7 days, oldest first, for the week strip. A shielded day was forgiven by a shield. */
  week: Array<{ day: string; isActive: boolean; isShielded: boolean }>;
};

/** Streak-shields (FR5.3): one forgives one whole missed day. */
export type ShieldState = {
  /** Days already forgiven by a shield (recorded earlier). */
  usedDays: Iterable<string>;
  /** Unused shields, each usable for a missed day on or after the day it was earned. */
  available: ReadonlyArray<{ shieldId: string; earnedDay: string }>;
};

export type StreakWithShields = Streak & {
  /** Shields this read used for newly missed days; the caller records them. */
  newUses: Array<{ shieldId: string; day: string }>;
};

/**
 * The streak, read lazily (no midnight job). Each whole missed day inside a live run uses the
 * oldest shield that was already earned by that day; the shielded day keeps the run alive but does
 * not add to it (US5.7). A missed day with no shield left resets the run, and shields are never
 * spent while there is no run to save. Only completed days (before today) can be missed.
 */
export function computeStreak(
  activeDays: Iterable<string>,
  today: string,
  sinceDay: string,
  shields: ShieldState = { usedDays: [], available: [] },
): StreakWithShields {
  const days = new Set([...activeDays].filter((d) => d >= sinceDay && d <= today));
  const shielded = new Set([...shields.usedDays].filter((d) => d >= sinceDay && d < today));
  const pool = [...shields.available].sort((a, b) =>
    a.earnedDay === b.earnedDay
      ? a.shieldId.localeCompare(b.shieldId)
      : a.earnedDay.localeCompare(b.earnedDay),
  );
  const newUses: StreakWithShields['newUses'] = [];
  const isActiveToday = days.has(today);
  let run = 0;
  let best = 0;
  const first = [...days, ...shielded].sort()[0];
  for (let day = first ?? today; day < today; day = shiftDay(day, 1)) {
    if (days.has(day)) {
      run += 1;
      best = Math.max(best, run);
    } else if (shielded.has(day)) {
      // Forgiven earlier: the run continues without growing.
    } else if (run > 0) {
      const at = pool.findIndex((s) => s.earnedDay <= day);
      if (at >= 0) {
        const [shield] = pool.splice(at, 1);
        newUses.push({ shieldId: (shield as { shieldId: string }).shieldId, day });
        shielded.add(day);
      } else {
        run = 0;
      }
    }
  }
  if (isActiveToday) {
    run += 1;
    best = Math.max(best, run);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(today, i - 6);
    return { day, isActive: days.has(day), isShielded: shielded.has(day) };
  });
  return { current: run, best, isActiveToday, week, newUses };
}
