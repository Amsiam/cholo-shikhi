// OD-207 moderation signals to the Admin (Step 50). Plain TypeScript. The thresholds are constants;
// changing one is a threshold change for the human (observability Assumption 2). A signal fires at
// threshold + 1, once per instructor per window (de-duplicated by `signal:<kind>:<instructor>:<window>`).
import type { AppError } from '#src/lib/errors.ts';

export const MODERATION_THRESHOLDS = {
  /** More than this many publishes or republishes by one instructor in one Dhaka day. */
  publishesPerDhakaDay: 20,
  /** More than this many link refusals for one instructor in one hour. */
  linkRefusalsPerHour: 10,
} as const;

export type ModerationSignal = 'publishBurst' | 'linkRefusals' | 'courseCreateLimit';

const HOUR_MS = 60 * 60 * 1000;
const LINK_REFUSAL_KEYS: ReadonlySet<string> = new Set([
  'errors.catalog.linkInvalid',
  'errors.catalog.blockedLink',
]);

/** The instructors whose publishes today exceed the threshold (system actors are not instructors). */
export function publishBursts(
  counts: ReadonlyArray<{ actorId: string; publishes: number }>,
): string[] {
  return counts
    .filter(
      (c) => c.actorId !== 'system' && c.publishes > MODERATION_THRESHOLDS.publishesPerDhakaDay,
    )
    .map((c) => c.actorId);
}

/** True only for the refusal that takes the hour's count over the threshold. */
export function shouldRaiseLinkSignal(countThisHour: number): boolean {
  return countThisHour === MODERATION_THRESHOLDS.linkRefusalsPerHour + 1;
}

/** A save refused because of an invalid or blocked link (SD-210, SD-211). */
export function isLinkRefusal(error: AppError): boolean {
  return Object.values(error.fieldErrors ?? {}).some((keys) =>
    keys.some((key) => LINK_REFUSAL_KEYS.has(key)),
  );
}

export function hourWindowStart(now: Date): Date {
  return new Date(now.getTime() - (now.getTime() % HOUR_MS));
}

export function signalDedupeKey(
  signal: ModerationSignal,
  instructorId: string,
  windowStart: Date,
): string {
  return `signal:${signal}:${instructorId}:${windowStart.toISOString()}`;
}
