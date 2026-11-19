// Time: instants are stored in UTC and shown in Asia/Dhaka (team.md Money, time and text).
// Domain code takes a Clock port instead of calling Date.now() (unit-test instructions).

export type Clock = { now(): string };

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

/** A clock fixed at (and advanceable from) a given instant, for tests and simulations. */
export function fixedClock(
  start: string,
): Clock & { advanceMs(ms: number): void; set(iso: string): void } {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current).toISOString(),
    advanceMs: (ms) => {
      current += ms;
    },
    set: (iso) => {
      current = new Date(iso).getTime();
    },
  };
}

export const DISPLAY_TIME_ZONE = 'Asia/Dhaka';
/** Asia/Dhaka has been fixed at UTC+06:00 with no daylight saving since 2009. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds whole calendar months on the Dhaka calendar, clamping the day to the target month's
 * length (31 Jan + 1 month = 28/29 Feb). Returns a UTC ISO instant.
 */
export function addCalendarMonths(instant: string, months: number): string {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError('months must be a non-negative integer');
  }
  const local = new Date(new Date(instant).getTime() + DHAKA_OFFSET_MS);
  const totalMonths = local.getUTCMonth() + months;
  const year = local.getUTCFullYear() + Math.floor(totalMonths / 12);
  const monthIndex = totalMonths % 12;
  const day = Math.min(local.getUTCDate(), daysInMonth(year, monthIndex));
  const shifted = Date.UTC(
    year,
    monthIndex,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(shifted - DHAKA_OFFSET_MS).toISOString();
}

export function dhakaDateParts(instant: string): { year: number; month: number; day: number } {
  const local = new Date(new Date(instant).getTime() + DHAKA_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

const DATE_TIME_FORMAT = {
  bn: new Intl.DateTimeFormat('bn-BD', {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
  en: new Intl.DateTimeFormat('en-BD', {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
} as const;

export function formatDateTime(instant: string, locale: 'bn' | 'en'): string {
  return DATE_TIME_FORMAT[locale].format(new Date(instant));
}
