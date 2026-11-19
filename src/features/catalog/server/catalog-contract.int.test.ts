// [LT] Step 34: the contract 5 reads (UC25; BR13.1–BR13.4, BR13.8, BR6.7), called in-process from
// src/features/catalog/index.ts as U3, U4, U8 and U9 will call them, over really published courses on
// a real PostgreSQL schema. Includes a fast-check property for listPiecesPublished (NFR4.202): for any
// cut of a time range into adjacent half-open periods, each first-published lesson is counted exactly
// once, for the owner at its first-publish instant, and later reassignment or takedown never changes
// a past count. CR-5 / CR-6 fallbacks: the current ProductTerms shape, unpublished reported as retired.
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as catalog from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import {
  allServerFns,
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';

const SEED = 20261117;
const READS = [
  'getProductTerms',
  'getLessonPlacement',
  'listPiecesPublished',
  'getOwnershipSnapshot',
  'listInstructorCourses',
  'canScheduleLive',
  'assertSectionOwner',
] as const;

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let goalId: string;

const actorOf = (caller: Caller, roles: Actor['roles'] = ['student', 'instructor']): Actor => ({
  userId: caller.userId,
  roles,
  locale: 'en',
  hasStepUp: true,
});
const adminActor = (): Actor => actorOf(s.admin, ['student', 'admin']);
const hide = (type: 'course' | 'section' | 'lesson', id: string) =>
  withTransaction(getDb(), (tx) =>
    catalog.hideContent(tx, { contentRef: { type, id }, takedownNoticeId: randomUUID() }),
  );
const firstPublishedAt = async (lessonId: string) =>
  (
    await s.t.pool.query<{ at: Date }>(
      'SELECT first_published_at AS at FROM lesson WHERE lesson_id = $1',
      [lessonId],
    )
  ).rows[0]?.at as Date;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  }
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'catalog.unpublish',
      description: 'LT: unpublish on',
      state: 'on',
    }),
  );
});
afterAll(async () => {
  await s?.close();
});

describe('contract 5 surface', () => {
  it('exports every read in-process and none is reachable as a server function (NFR6.201)', () => {
    const fns = allServerFns();
    for (const name of READS) {
      expect(typeof (catalog as Record<string, unknown>)[name]).toBe('function');
      expect(fns[name]).toBeUndefined();
    }
  });
});

describe('getProductTerms (BR13.1)', () => {
  it('maps a published course to its Goal, poisha price and duration', async () => {
    const course = await p.published(goalId, { price: '১৪৯৯.৫০', months: 12 });
    expect(await catalog.getProductTerms({ type: 'course', id: course.courseId })).toEqual({
      ok: true,
      value: {
        product: { type: 'course', id: course.courseId },
        goalId,
        listPrice: 149_950,
        accessDurationMonths: 12,
        status: 'published',
        includedCourseIds: [],
        includedExamPackageIds: [],
      },
    });
  });

  it('answers NOT_FOUND for an unknown course, an unpriced draft and product types not built yet', async () => {
    const lead = await s.newInstructor();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        titleBn: 'খসড়া',
        titleEn: 'Draft',
        sections: [],
      }),
    );
    for (const product of [
      { type: 'course' as const, id: randomUUID() },
      { type: 'course' as const, id: courseId },
      { type: 'exam_package' as const, id: randomUUID() },
      { type: 'course' as const, id: 'not-an-id' },
    ]) {
      expect(await catalog.getProductTerms(product)).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
  });

  it('reports hidden at once after a takedown, and an unpublished course as retired (CR-5 fallback)', async () => {
    const hidden = await p.published(goalId);
    value(await hide('course', hidden.courseId));
    expect(await catalog.getProductTerms({ type: 'course', id: hidden.courseId })).toMatchObject({
      ok: true,
      value: { status: 'hidden' },
    });
    const unpublished = await p.published(goalId);
    value(
      await s.call('unpublishCourse', unpublished.lead.request, {
        courseId: unpublished.courseId,
        expectedVersion: (await p.view(unpublished.courseId, unpublished.lead)).course.version,
      }),
    );
    expect(
      await catalog.getProductTerms({ type: 'course', id: unpublished.courseId }),
    ).toMatchObject({ ok: true, value: { status: 'retired' } });
  });
});

describe('getLessonPlacement (BR13.2)', () => {
  it('answers live for a published lesson and never_published for one added after the publish', async () => {
    const course = await p.published(goalId);
    const sectionId = course.sectionIds[0] as string;
    expect(await catalog.getLessonPlacement(course.lessonIds[0] as string)).toEqual({
      ok: true,
      value: {
        lessonId: course.lessonIds[0],
        sectionId,
        courseId: course.courseId,
        status: 'live',
      },
    });
    const added = await p.addTextLesson(course.lead, course.courseId, sectionId);
    expect(await catalog.getLessonPlacement(added)).toMatchObject({
      ok: true,
      value: { status: 'never_published' },
    });
  });

  it('answers withdrawn once a removal is published, and keeps a retired course live (BR4.5)', async () => {
    const course = await p.published(goalId);
    const sectionId = course.sectionIds[0] as string;
    const second = await p.addTextLesson(course.lead, course.courseId, sectionId);
    value(await p.publish(s.admin, course.courseId));
    const edit = await p.sectionEdit(course.courseId, sectionId, course.lead);
    value(
      await s.call('removeLesson', course.lead.request, {
        courseId: course.courseId,
        sectionId,
        lessonId: course.lessonIds[0],
        expectedVersion: edit.editVersion,
      }),
    );
    value(await p.publish(s.admin, course.courseId));
    expect(await catalog.getLessonPlacement(course.lessonIds[0] as string)).toMatchObject({
      ok: true,
      value: { status: 'withdrawn' },
    });
    value(
      await s.call('retireCourse', course.lead.request, {
        courseId: course.courseId,
        expectedVersion: (await p.view(course.courseId, course.lead)).course.version,
      }),
    );
    expect(await catalog.getLessonPlacement(second)).toMatchObject({
      ok: true,
      value: { status: 'live' },
    });
  });

  it('answers hidden when the lesson, its section or its course is under takedown, and NOT_FOUND for an unknown ID', async () => {
    const byLesson = await p.published(goalId);
    value(await hide('lesson', byLesson.lessonIds[0] as string));
    const bySection = await p.published(goalId);
    value(await hide('section', bySection.sectionIds[0] as string));
    const byCourse = await p.published(goalId);
    value(await hide('course', byCourse.courseId));
    for (const lessonId of [byLesson.lessonIds[0], bySection.lessonIds[0], byCourse.lessonIds[0]])
      expect(await catalog.getLessonPlacement(lessonId as string)).toMatchObject({
        ok: true,
        value: { status: 'hidden' },
      });
    expect(await catalog.getLessonPlacement(randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('listPiecesPublished and getOwnershipSnapshot (BR13.3, BR6.7)', () => {
  it('counts each lesson at its first publication for the owner then, on half-open periods', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    const coLesson = course.lessonIds[0] as string;
    const leadLesson = course.lessonIds[1] as string;
    const at = await firstPublishedAt(coLesson);
    const iso = (d: Date) => d.toISOString();
    const around = {
      start: iso(new Date(at.getTime() - 60_000)),
      end: iso(new Date(at.getTime() + 60_000)),
    };
    expect(await catalog.listPiecesPublished(course.co?.userId as string, around)).toEqual([
      { lessonId: coLesson, firstPublishedAt: iso(at) },
    ]);
    expect(
      (await catalog.listPiecesPublished(course.lead.userId, around)).map((x) => x.lessonId),
    ).toEqual([leadLesson]);
    // Half-open: a period that ends at the instant excludes it, one that starts there includes it.
    expect(
      await catalog.listPiecesPublished(course.co?.userId as string, {
        start: around.start,
        end: iso(at),
      }),
    ).toEqual([]);
    expect(
      (
        await catalog.listPiecesPublished(course.co?.userId as string, {
          start: iso(at),
          end: around.end,
        })
      ).length,
    ).toBe(1);
    expect(
      await catalog.listPiecesPublished(course.lead.userId, {
        start: around.end,
        end: around.start,
      }),
    ).toEqual([]);
  });

  it('a later reassignment, republish or takedown never re-attributes a past piece, and the snapshot keeps the earlier owner', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    const coLesson = course.lessonIds[0] as string;
    const sectionId = course.sectionIds[0] as string;
    const at = await firstPublishedAt(coLesson);
    const window = {
      start: new Date(at.getTime() - 60_000).toISOString(),
      end: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const before = await catalog.listPiecesPublished(course.co?.userId as string, window);
    // Reassign the section back to the Lead, republish and take the lesson down.
    const v = await p.view(course.courseId, course.lead);
    const section = v.sections.find((x) => x.sectionId === sectionId);
    value(
      await s.call('assignSection', course.lead.request, {
        courseId: course.courseId,
        sectionId,
        assigneeId: course.lead.userId,
        expectedOwnershipVersion: section?.ownershipVersion,
      }),
    );
    await p.addTextLesson(course.lead, course.courseId, sectionId);
    value(await p.publish(s.admin, course.courseId));
    value(await hide('lesson', coLesson));
    expect(await catalog.listPiecesPublished(course.co?.userId as string, window)).toEqual(before);
    expect(
      (await catalog.listPiecesPublished(course.lead.userId, window)).map((x) => x.lessonId),
    ).not.toContain(coLesson);

    const earlier = await catalog.getOwnershipSnapshot(course.courseId, at.toISOString());
    expect(earlier).toMatchObject({ ok: true });
    const owners = earlier.ok ? earlier.value.sections : [];
    expect(owners.find((x) => x.sectionId === sectionId)?.instructorId).toBe(course.co?.userId);
    const now = await catalog.getOwnershipSnapshot(course.courseId, new Date().toISOString());
    expect(
      (now.ok ? now.value.sections : []).find((x) => x.sectionId === sectionId)?.instructorId,
    ).toBe(course.lead.userId);
  });

  it('the snapshot leaves out sections that did not exist yet and answers NOT_FOUND for an unknown course', async () => {
    const course = await p.published(goalId);
    const long = await catalog.getOwnershipSnapshot(course.courseId, '2000-01-01T00:00:00.000Z');
    expect(long).toMatchObject({ ok: true, value: { sections: [] } });
    expect(
      await catalog.getOwnershipSnapshot(randomUUID(), new Date().toISOString()),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('property: any cut into adjacent half-open periods counts each piece exactly once (NFR4.202)', async () => {
    // A Lead-owned course of three sections, published once: three pieces for that Lead.
    const course = await p.published(goalId, { sections: 3 });
    const owner = course.lead.userId;
    const lessons = course.lessonIds;
    const times = await Promise.all(lessons.map(firstPublishedAt));
    const lo = Math.min(...times.map((t) => t.getTime())) - 1000;
    const hi = Math.max(...times.map((t) => t.getTime())) + 1000;
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: lo + 1, max: hi - 1 }), { maxLength: 6 }),
        async (cuts) => {
          const edges = [lo, ...[...cuts].sort((a, b) => a - b), hi];
          const counted: string[] = [];
          for (let i = 0; i + 1 < edges.length; i += 1) {
            const page = await catalog.listPiecesPublished(owner, {
              start: new Date(edges[i] as number).toISOString(),
              end: new Date(edges[i + 1] as number).toISOString(),
            });
            counted.push(...page.map((x) => x.lessonId));
          }
          return counted.length === lessons.length && new Set(counted).size === lessons.length;
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  }, 120_000);
});

describe('listInstructorCourses (BR13.4)', () => {
  it('lists the Lead and Co-instructor roles in every state, newest first, with an opaque cursor', async () => {
    const lead = await s.newInstructor();
    const co = await s.newInstructor();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { courseId } = value<{ courseId: string }>(
        await s.call('createCourse', lead.request, {
          goalId,
          titleBn: `কোর্স ${i}`,
          titleEn: `Course ${i}`,
          sections: [{ titleBn: 'অংশ', titleEn: 'Part' }],
        }),
      );
      ids.push(courseId);
    }
    const v = await p.view(ids[0] as string, lead);
    value(
      await s.call('assignSection', lead.request, {
        courseId: ids[0],
        sectionId: v.sections[0]?.sectionId,
        assigneeId: co.userId,
        expectedOwnershipVersion: v.sections[0]?.ownershipVersion,
      }),
    );
    const first = await catalog.listInstructorCourses(lead.userId, { limit: 2 });
    expect(first.items.map((x) => x.courseId)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).toBeDefined();
    const second = await catalog.listInstructorCourses(lead.userId, {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second).toEqual({ items: [{ courseId: ids[0], role: 'lead' }] });
    expect(await catalog.listInstructorCourses(co.userId, { limit: 50 })).toEqual({
      items: [{ courseId: ids[0], role: 'co_instructor' }],
    });
    expect(await catalog.listInstructorCourses(randomUUID(), { limit: 0 })).toEqual({ items: [] });
  });

  it('throws on a malformed or foreign cursor (a caller bug, not a result)', async () => {
    const lead = await s.newInstructor();
    await expect(
      catalog.listInstructorCourses(lead.userId, { limit: 5, cursor: 'garbage' }),
    ).rejects.toThrow(/malformed cursor/);
  });
});

describe('canScheduleLive (BR13.8) and assertSectionOwner', () => {
  it('admits the Lead, a current Co-instructor and an Admin on a published course', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    for (const actor of [actorOf(course.lead), actorOf(course.co as Caller), adminActor()])
      expect(await catalog.canScheduleLive(actor, course.courseId)).toEqual({
        ok: true,
        value: undefined,
      });
  });

  it('refuses a draft or hidden course with FORBIDDEN, and a stranger or unknown course with NOT_FOUND', async () => {
    const draft = await p.draft(goalId);
    expect(await catalog.canScheduleLive(actorOf(draft.lead), draft.courseId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const hidden = await p.published(goalId);
    value(await hide('course', hidden.courseId));
    expect(await catalog.canScheduleLive(adminActor(), hidden.courseId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const stranger = await s.newInstructor();
    expect(await catalog.canScheduleLive(actorOf(stranger), draft.courseId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await catalog.canScheduleLive(adminActor(), randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('assertSectionOwner admits the owner and an Admin; the Lead of another owner’s section is FORBIDDEN, a stranger NOT_FOUND', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    const coSection = course.sectionIds[0] as string;
    expect(await catalog.assertSectionOwner(actorOf(course.co as Caller), coSection)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await catalog.assertSectionOwner(adminActor(), coSection)).toMatchObject({ ok: true });
    expect(await catalog.assertSectionOwner(actorOf(course.lead), coSection)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' },
    });
    const stranger = await s.newInstructor();
    expect(await catalog.assertSectionOwner(actorOf(stranger), coSection)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await catalog.assertSectionOwner(adminActor(), randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
