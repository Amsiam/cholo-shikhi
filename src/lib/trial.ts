// Free trial rules (PRD FR-DIST-1), shared by Commerce (who may start a trial) and Learning (which
// lessons a trial opens). Plain TypeScript.
//
// A trial opens the course's first N lessons for D days (US2.23: per segment, Admin settings, default
// TRIAL_LESSONS and TRIAL_DAYS; each trial keeps the caps it started with). It ends at whichever
// cap comes first: the days run out, or the Student has completed all the open lessons. After that
// the trial is expired: the content locks and the Student sees the purchase option, never a re-trial.

export const TRIAL_DAYS = 30;
export const TRIAL_LESSONS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trialEndsAt(startedAt: Date, days: number = TRIAL_DAYS): Date {
  return new Date(startedAt.getTime() + days * DAY_MS);
}

/** The lessons a trial opens: the first `cap` in the course's reading order. */
export function trialLessonIds(
  orderedLessonIds: readonly string[],
  cap: number = TRIAL_LESSONS,
): string[] {
  return orderedLessonIds.slice(0, cap);
}

export type TrialState = {
  isExpired: boolean;
  /** Whole days left (rounded up), 0 once ended. */
  daysLeft: number;
  /** Open lessons the Student has completed, and how many are open. */
  lessonsUsed: number;
  lessonLimit: number;
};

export function trialState(
  endsAt: Date,
  openLessonIds: readonly string[],
  completedLessonIds: ReadonlySet<string>,
  now: Date,
): TrialState {
  const lessonLimit = openLessonIds.length;
  const lessonsUsed = openLessonIds.filter((id) => completedLessonIds.has(id)).length;
  const ms = endsAt.getTime() - now.getTime();
  const isExpired = ms <= 0 || (lessonLimit > 0 && lessonsUsed >= lessonLimit);
  return { isExpired, daysLeft: ms <= 0 ? 0 : Math.ceil(ms / DAY_MS), lessonsUsed, lessonLimit };
}
