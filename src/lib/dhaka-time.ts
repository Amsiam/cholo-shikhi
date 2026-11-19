// Asia/Dhaka local date-times (UTC+6, no daylight saving), as typed into datetime-local inputs.

/** A local Asia/Dhaka date-time ("2026-11-20T20:00") as a UTC instant (UTC+6, no DST). */
export function dhakaLocalToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h - 6, mi);
  return Number.isNaN(utc) ? null : new Date(utc);
}

export function utcToDhakaLocal(at: Date): string {
  return new Date(at.getTime() + 6 * 3600_000).toISOString().slice(0, 16);
}
