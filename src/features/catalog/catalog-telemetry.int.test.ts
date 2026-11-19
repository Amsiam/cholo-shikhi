// [LT] Step 52: catalog log lines carry IDs, enums, codes and counts only (NFR5.203, NFR9.205,
// OD-204, OD-205). A Catalog built exactly like the app's instance, but with a capturing logger, runs
// refused and accepted flows seeded with marker titles, lesson text, link hosts, blocked domains and
// image bytes; the captured log output must contain none of them.
import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit, flags, outbox, settings } from '#src/features/platform/index.ts';
import { createLogger } from '#src/lib/logger.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { ok } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { TEST_ORIGIN } from '#src/test/browser.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { type Catalog, createCatalog } from './server/catalog.server.ts';
import { createImageUploads } from './server/catalog-images.server.ts';
import { createModeration } from './server/catalog-moderation.server.ts';
import { createImageAdmission } from './server/image-admission.ts';
import { createMemoryImageStorage, unavailableHelperClient } from './server/image-ports.server.ts';
import { value } from './test-fixtures/publish-helper.ts';

const marker = (label: string) => `${label}${randomBytes(5).toString('hex')}`;
const MARKERS = {
  titleBn: marker('শিরোনামচিহ্ন'),
  titleEn: marker('TitleMarker'),
  body: marker('BodyMarker'),
  linkHost: `${marker('linkmarker')}.example.com`,
  blockedHost: `${marker('blockedmarker')}.example.com`,
};

let s: ServerFnHarness;
let catalog: Catalog;
const lines: string[] = [];
const log = createLogger({
  level: 'trace',
  destination: {
    write: (line: string) => {
      lines.push(line);
    },
  },
}).child({ component: 'catalog' });

let goalId: string;
let lead: Actor;
let other: Actor;
let admin: Actor;

const actor = (userId: string, roles: Actor['roles']): Actor => ({
  userId,
  roles,
  locale: 'en',
  hasStepUp: true,
});

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  lead = actor(s.instructor.userId, ['student', 'instructor']);
  other = actor((await s.newInstructor()).userId, ['student', 'instructor']);
  admin = actor(s.admin.userId, ['student', 'admin']);
  const notify = getNotifications().notify;
  catalog = createCatalog({
    db: getDb(),
    clock: systemClock,
    audit: createAudit({ clock: systemClock }),
    notify: (tx, request, correlationId) => notify(tx, request, correlationId),
    moderation: createModeration({
      db: getDb(),
      clock: systemClock,
      log,
      hashId: (id) => `h:${id}`,
      notify: (tx, request, correlationId) => notify(tx, request, correlationId),
    }),
    readPoisha: async (key) => {
      const result = await settings().get(key);
      return result.ok ? ok(result.value.value) : result;
    },
    hasInstructorRole: (userId) => getIdentity().hasRole(userId, 'instructor'),
    hashId: (id) => `h:${id}`,
    outbox,
    isFlagEnabled: (flagKey, userId) => flags().isEnabled(flagKey, { userId }),
    trialSegmentsOf: async () => [],
    toAscii: domainToASCII,
    log,
  });
});
afterAll(async () => {
  await s?.close();
});

const doc = (text: string, href?: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text,
          ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
        },
      ],
    },
  ],
});

describe('catalog telemetry is IDs-only (NFR5.203, OD-205)', () => {
  it('logs refusals with IDs and reason codes, never titles, lesson text, links, domains or bytes', async () => {
    const created = await catalog.createCourse(
      lead,
      {
        goalId,
        titleBn: MARKERS.titleBn,
        titleEn: MARKERS.titleEn,
        sections: [{ titleBn: MARKERS.titleBn, titleEn: MARKERS.titleEn }],
      },
      'corr-telemetry',
    );
    if (!created.ok) throw new Error(created.error.code);
    const { courseId } = created.value;
    const view = await catalog.getCourseForEditing(lead, courseId);
    if (!view.ok) throw new Error(view.error.code);
    const section = view.value.sections[0];
    if (!section) throw new Error('no section');

    // A write by an unrelated instructor: refused NOT_FOUND (SD-202) and logged with IDs only.
    const forbidden = await catalog.editSectionTitle(
      other,
      {
        courseId,
        sectionId: section.sectionId,
        expectedVersion: 1,
        titleBn: MARKERS.titleBn,
        titleEn: MARKERS.titleEn,
      },
      'corr-telemetry',
    );
    expect(forbidden.ok).toBe(false);

    // A lesson with text, then a refused http link and a refused blocked domain.
    const edit = await catalog.getSectionForEditing(lead, {
      courseId,
      sectionId: section.sectionId,
    });
    if (!edit.ok) throw new Error(edit.error.code);
    const added = await catalog.addLesson(
      lead,
      {
        courseId,
        sectionId: section.sectionId,
        expectedVersion: edit.value.editVersion ?? 1,
        kind: 'text',
        titleBn: MARKERS.titleBn,
        titleEn: MARKERS.titleEn,
      },
      'corr-telemetry',
    );
    if (!added.ok) throw new Error(added.error.code);
    const lessonVersion = async () => {
      const again = await catalog.getSectionForEditing(lead, {
        courseId,
        sectionId: section.sectionId,
      });
      if (!again.ok) throw new Error(again.error.code);
      return again.value.lessons.find((l) => l.lessonId === added.value.lessonId)
        ?.version as number;
    };
    const save = async (href?: string) =>
      catalog.saveTextLessonBody(
        lead,
        {
          courseId,
          sectionId: section.sectionId,
          lessonId: added.value.lessonId,
          expectedVersion: await lessonVersion(),
          language: 'en',
          body: doc(MARKERS.body, href),
        },
        'corr-telemetry',
      );
    expect((await save()).ok).toBe(true);
    expect((await save(`http://${MARKERS.linkHost}/x`)).ok).toBe(false);
    expect(
      (await catalog.addBlockedDomain(admin, { domain: MARKERS.blockedHost }, 'corr-telemetry')).ok,
    ).toBe(true);
    expect((await save(`https://${MARKERS.blockedHost}/x`)).ok).toBe(false);

    // A refused publish (preconditions) and a refused image upload with marker bytes.
    expect((await catalog.publishCourse(lead, { courseId, expectedVersion: 1 }, 'c')).ok).toBe(
      false,
    );
    const uploads = createImageUploads({
      db: getDb(),
      clock: systemClock,
      audit: createAudit({ clock: systemClock }),
      log,
      metrics: createMetrics(),
      getActor: async () => ok(lead),
      isFlagEnabled: async () => true,
      trustedOrigins: () => [TEST_ORIGIN],
      owners: {
        assertSectionOwner: (a, id) => catalog.assertSectionOwner(a, id),
        assertCourseLead: (a, id) => catalog.assertCourseLead(a, id),
        admitAuthoring: (a) => catalog.admitAuthoring(a),
      },
      // Ready, so the body is read and sniffed (the SVG is then refused by type, Step 44).
      helper: { ...unavailableHelperClient, isReady: async () => true },
      storage: createMemoryImageStorage(systemClock),
      admission: createImageAdmission({ processing: 2, waiting: 10 }),
    });
    const svg = new TextEncoder().encode(`<svg>${MARKERS.body}</svg>`);
    const response = await uploads.handle(
      new Request(`${TEST_ORIGIN}/api/catalog/images?kind=inline&targetId=${section.sectionId}`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-length': String(svg.byteLength) },
        body: svg,
      }),
    );
    expect(response.status).toBe(422);

    const output = lines.join('');
    // The flows really logged (so the absence below is meaningful).
    for (const event of [
      '"operation":"editSectionTitle"',
      'catalog.link_blocked',
      'catalog.image.refused',
    ]) {
      expect(output).toContain(event);
    }
    for (const value of Object.values(MARKERS)) expect(output).not.toContain(value);
    expect(output).not.toContain('<svg>');
  });
});
