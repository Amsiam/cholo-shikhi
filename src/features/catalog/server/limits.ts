// Authoring rate limits (NFR6.216, SD-218). These are the design values; changing them is a
// threshold change that needs the human's approval (team.md Way of Working). Admins keep U1's
// general limit and are not counted here.

/** Authoring writes per instructor per 60-second window. */
export const AUTHORING_WRITES_PER_MINUTE = 60;
/** Course creations per instructor per Dhaka calendar day. */
export const COURSE_CREATIONS_PER_DHAKA_DAY = 10;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Asia/Dhaka is fixed at UTC+06:00 with no daylight saving. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export type LimitKind = 'authoring' | 'courseCreate';

export type LimitWindow = {
  action: string;
  limit: number;
  windowStart: Date;
  expiredAtOrBefore: Date;
  /** When a window that started at `start` ends. */
  endsAt(start: Date): Date;
};

/** The start of the Dhaka calendar day containing `now`, as a UTC instant. */
export function dhakaDayStart(now: Date): Date {
  const local = now.getTime() + DHAKA_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - DHAKA_OFFSET_MS);
}

/** The fixed window for a limit at `now`: 60 s from the first attempt, or the Dhaka day. */
export function limitWindow(kind: LimitKind, now: Date): LimitWindow {
  if (kind === 'authoring') {
    return {
      action: 'catalog_authoring',
      limit: AUTHORING_WRITES_PER_MINUTE,
      windowStart: now,
      expiredAtOrBefore: new Date(now.getTime() - MINUTE_MS),
      endsAt: (start) => new Date(start.getTime() + MINUTE_MS),
    };
  }
  const dayStart = dhakaDayStart(now);
  return {
    action: 'catalog_course_create',
    limit: COURSE_CREATIONS_PER_DHAKA_DAY,
    windowStart: dayStart,
    expiredAtOrBefore: new Date(dayStart.getTime() - 1),
    endsAt: (start) => new Date(start.getTime() + DAY_MS),
  };
}

// ------------------------------------------------------------------ image uploads (Steps 44, 45)
// Design values (NFR6.212, SD-214, SC-204); changing any of them is a threshold change for the human.

/** NFR6.212: an upload is refused at 5 MB + 1 byte (HTTP 413). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Step 45 (approved by the human on 2026-11-17): POST /api/catalog/images is the only path exempt
 * from the app-wide 100 KB request rule (foundation NFR6.17). Its request-body limit is 5 MB + 16 KB
 * (SD-214, INF-213), and Content-Length is required (411 without it). The app has no global
 * in-process body limit, so inside the app the route applies the stricter SD-214 image cap
 * (IMAGE_MAX_BYTES) to the declared length and to the streamed bytes; this value is the per-route
 * rule the reverse proxy carries (INF-213, part of the deferred image infrastructure, Step 47).
 */
export const IMAGE_ROUTE_BODY_LIMIT_BYTES = IMAGE_MAX_BYTES + 16 * 1024;
/** The cap the upload route enforces on the image bytes it reads. */
export const IMAGE_UPLOAD_BODY_LIMIT_BYTES = IMAGE_MAX_BYTES;
/** SC-204: decodes running at once per instance, and requests allowed to wait for one. */
export const IMAGE_PROCESSING_SLOTS = 2;
export const IMAGE_WAITING_SLOTS = 10;
/** SD-214: a refused admission answers RATE_LIMITED imageBusy with this Retry-After. */
export const IMAGE_BUSY_RETRY_AFTER_SECONDS = 5;
