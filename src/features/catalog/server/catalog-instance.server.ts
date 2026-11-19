// The process-wide Catalog service, wired to the app's database and the U1 ports.
import { createHmac } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { getActiveGoal, getCurrentGoal } from '#src/features/goals/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit, flags, outbox, settings } from '#src/features/platform/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { getLogger } from '#src/lib/logger.ts';
import { ok } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { keyedHash } from '#src/server/crypto.server.ts';
import { getDb } from '#src/server/db.ts';
import { createCursorCodec } from '../domain/cursor.ts';
import { type Catalog, createCatalog } from './catalog.server.ts';
import { createModeration } from './catalog-moderation.server.ts';
import { registerCatalogWithPlatform } from './register.server.ts';

let shared: Catalog | undefined;

type TrialLookup = (courseId: string) => Promise<string[]>;
/**
 * BR4.8 needs the segments whose trial.policy names a course. No unit declares trial.policy yet (the
 * unit that owns trials will, and will supply this lookup); until then no course is a trial course.
 */
const noTrialCourses: TrialLookup = async () => [];
let trialLookup: TrialLookup = noTrialCourses;

/** Test seam: stands in for the future trial.policy lookup; returns a function that restores it. */
export function setTrialCourseLookupForTests(lookup: TrialLookup): () => void {
  trialLookup = lookup;
  return () => {
    trialLookup = noTrialCourses;
  };
}

type TrialCourseLookup = (segmentId: string) => Promise<string | null>;
/** BR11.4: trial.policy is not declared by any unit yet, so no segment has a trial course. */
const noTrialCourse: TrialCourseLookup = async () => null;
let trialCourseLookup: TrialCourseLookup = noTrialCourse;

/** Test seam: stands in for the future trial.policy read; returns a function that restores it. */
export function setTrialCourseOfSegmentForTests(lookup: TrialCourseLookup): () => void {
  trialCourseLookup = lookup;
  return () => {
    trialCourseLookup = noTrialCourse;
  };
}

const hmacSha256 = (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(createHmac('sha256', key).update(data).digest());

/** The S3 cursor-signing keys (SD-205, LC-213): current and, during a rotation, previous kid. */
function cursorKeys() {
  return getEnv().CATALOG_CURSOR_KEYS;
}

export function getCatalog(): Catalog {
  if (!shared) {
    const notifications = getNotifications();
    const notify: Parameters<typeof createModeration>[0]['notify'] = (tx, request, correlationId) =>
      notifications.notify(tx, request, correlationId);
    const moderation = createModeration({
      db: getDb(),
      clock: systemClock,
      log: getLogger().child({ component: 'catalog' }),
      hashId: (userId) => keyedHash(getEnv().IDENTIFIER_HASH_KEY, userId),
      notify,
    });
    const created = createCatalog({
      db: getDb(),
      clock: systemClock,
      audit: createAudit({ clock: systemClock }),
      notify,
      moderation,
      readPoisha: async (key) => {
        const result = await settings().get(key);
        return result.ok ? ok(result.value.value) : result;
      },
      hasInstructorRole: (userId) => getIdentity().hasRole(userId, 'instructor'),
      hashId: (userId) => keyedHash(getEnv().IDENTIFIER_HASH_KEY, userId),
      outbox,
      isFlagEnabled: (flagKey, userId) => flags().isEnabled(flagKey, { userId }),
      trialSegmentsOf: (courseId) => trialLookup(courseId),
      toAscii: domainToASCII,
      log: getLogger().child({ component: 'catalog' }),
      browse: {
        currentGoal: async (userId) => {
          const current = await getCurrentGoal(userId);
          return current.ok
            ? ok({ goalId: current.value.goalId, segmentId: current.value.segmentId })
            : current;
        },
        activeGoal: (goalId) => getActiveGoal(goalId),
        trialCourseOf: (segmentId) => trialCourseLookup(segmentId),
        displayNamesOf: (userIds) => getIdentity().displayNamesOf(userIds),
        cursor: createCursorCodec({ keys: cursorKeys(), hmac: hmacSha256 }),
      },
    });
    // BR4.9 (foundation CR-3): a failure throws here, so no request is served by an instance
    // whose validator is missing (RD-208).
    registerCatalogWithPlatform(settings(), created);
    shared = created;
  }
  return shared;
}
