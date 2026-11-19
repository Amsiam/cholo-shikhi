// [AT] Step 30: Given/When/Then acceptance tests for US2.1 (S3 catalog) and US2.2 (S4 course page),
// written from stories.md, functional-spec UC5/UC6 and the rules.md error mapping before any
// implementation. They call the real server functions through their real builders on a per-file
// schema with real Better Auth sessions, over courses that were really published.
// Also here: the Bolt 3 carry-overs "the course appears in S3 for its Goal" (AC3.0.1, AC3.8.1) and the
// student read paths of the takedown requirement (NFR6.218: hidden content is refused to everyone;
// SD-204: unpublished and retired courses are not-found on browse reads only, and their lessons stay
// live for enrolled students through getLessonPlacement).
// AC2.1.3's Retry and AC2.2.2 / AC2.2.3 (images after text; Buy becomes Continue against the
// Entitlements stub) are screen behaviour: catalog-browse.acceptance.test.tsx covers them.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as catalogModule from '#src/features/catalog/index.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from './test-fixtures/publish-helper.ts';

type Card = {
  kind: 'course';
  courseId: string;
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
  accessDurationMonths: number;
  isPinned: boolean;
};
type CatalogPage = {
  goal: { goalId: string; nameBn: string; nameEn: string };
  tab: string;
  items: Card[];
  nextCursor: string | null;
  tabsWithItems: string[];
};
type CoursePage = {
  courseId: string;
  goal: { goalId: string; nameBn: string; nameEn: string };
  isCurrentGoal: boolean;
  titleBn: string;
  titleEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  listPricePoisha: number;
  accessDurationMonths: number;
  instructors: Array<{
    instructorId: string;
    role: 'lead' | 'co_instructor';
    displayName: string;
    sections: Array<{ sectionId: string; titleBn: string; titleEn: string }>;
  }>;
  outline: Array<{
    sectionId: string;
    titleBn: string;
    titleEn: string;
    lessons: Array<{
      lessonId: string;
      kind: string;
      titleBn: string | null;
      titleEn: string | null;
    }>;
  }>;
  practicePacks: unknown[];
};

type ContentRef = { type: 'course' | 'section' | 'lesson'; id: string };
type Takedown = (
  tx: TxHandle,
  input: { contentRef: ContentRef; takedownNoticeId: string },
) => Promise<{ ok: boolean }>;
type Placement = (lessonId: string) => Promise<{
  ok: boolean;
  value?: { lessonId: string; sectionId: string; courseId: string; status: string };
}>;

/** Contract 5 reads, looked up at call time so a missing export fails its own test only. */
function contract<K extends string>(name: K): (...args: never[]) => unknown {
  const fn = (catalogModule as unknown as Record<string, unknown>)[name];
  if (typeof fn !== 'function') throw new Error(`${name} is not exported from catalog index.ts`);
  return fn as (...args: never[]) => unknown;
}
const hide = (ref: ContentRef, notice: string) =>
  withTransaction(getDb(), (tx) =>
    (contract('hideContent') as unknown as Takedown)(tx, {
      contentRef: ref,
      takedownNoticeId: notice,
    }),
  );
const placement = (lessonId: string) =>
  (contract('getLessonPlacement') as unknown as Placement)(lessonId);

/** The BR11.4 trial.policy seam (no unit declares trial.policy yet), looked up at call time. */
async function setTrialCourse(lookup: (segmentId: string) => Promise<string | null>) {
  const instance = (await import('./server/catalog-instance.server.ts')) as unknown as Record<
    string,
    unknown
  >;
  const seam = instance.setTrialCourseOfSegmentForTests;
  if (typeof seam !== 'function') throw new Error('setTrialCourseOfSegmentForTests is missing');
  return seam(lookup) as () => void;
}

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let segmentId: string;
let goalId: string;
let otherGoalId: string;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  segmentId = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  ).segmentId;
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  otherGoalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'AT bounds' }),
    );
  }
  // CR-5 fallback: unpublish ships behind catalog.unpublish; the status cases below need it on.
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'catalog.unpublish',
      description: 'AT: unpublish on',
      state: 'on',
    }),
  );
});
afterAll(async () => {
  await s?.close();
});

async function studentOf(goal: string) {
  const student = await s.newStudent();
  value(await s.call('chooseGoal', student.request, { goalId: goal }));
  return student;
}
const catalog = async (request: Request, tab = 'courses', cursor?: string) =>
  s.call('listCatalog', request, { tab, ...(cursor ? { cursor } : {}) });
const coursePage = async (request: Request, courseId: string) =>
  s.call('getCoursePage', request, { courseId });
const listedIds = (page: CatalogPage) => page.items.map((c) => c.courseId);

describe('US2.1 Browse the catalog for my Goal', () => {
  it('AC2.1.1 Given my Goal, When I open the Courses tab, Then only published courses of my Goal are listed, each with its poisha price and duration', async () => {
    const mine = await p.published(goalId, { price: '১৪৯৯.৫০', months: 6 });
    const draft = await p.draft(goalId);
    const elsewhere = await p.published(otherGoalId);
    const student = await studentOf(goalId);

    const page = value<CatalogPage>(await catalog(student.request));
    expect(page.goal.goalId).toBe(goalId);
    expect(listedIds(page)).toContain(mine.courseId);
    expect(listedIds(page)).not.toContain(draft.courseId);
    expect(listedIds(page)).not.toContain(elsewhere.courseId);
    expect(page.items.find((c) => c.courseId === mine.courseId)).toMatchObject({
      kind: 'course',
      titleBn: mine.titles.titleBn,
      titleEn: mine.titles.titleEn,
      listPricePoisha: 149_950,
      accessDurationMonths: 6,
    });
  });

  it('AC3.0.1 / AC3.8.1 Given a course the Lead published after approval, When a Student of its Goal opens S3, Then it appears there', async () => {
    const built = await p.draft(goalId);
    value(
      await s.call('selfApproveSection', built.lead.request, {
        courseId: built.courseId,
        sectionId: built.sectionIds[0],
        expectedVersion: (
          await p.sectionEdit(built.courseId, built.sectionIds[0] as string, built.lead)
        ).working?.version,
      }),
    );
    value(await p.publish(built.lead, built.courseId));
    const page = value<CatalogPage>(await catalog((await studentOf(goalId)).request));
    expect(listedIds(page)).toContain(built.courseId);
  });

  it('AC2.1.2 Given a tab with no items for my Goal, When I open it, Then it is empty and the tabs that do have items are named for the link', async () => {
    await p.published(goalId);
    const student = await studentOf(goalId);
    const page = value<CatalogPage>(await catalog(student.request, 'exam_packages'));
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.tabsWithItems).toContain('courses');
    expect(page.tabsWithItems).not.toContain('exam_packages');
  });

  it('AC2.1.3 Given an unpublished, retired, draft or hidden course, When I request it by URL, Then it answers exactly like a course that does not exist', async () => {
    const student = await studentOf(goalId);
    const missing = await coursePage(student.request, randomUUID());
    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' },
    });

    const draft = await p.draft(goalId);
    const retired = await p.published(goalId);
    value(
      await s.call('retireCourse', retired.lead.request, {
        courseId: retired.courseId,
        expectedVersion: (await p.view(retired.courseId, retired.lead)).course.version,
      }),
    );
    const unpublished = await p.published(goalId);
    value(
      await s.call('unpublishCourse', unpublished.lead.request, {
        courseId: unpublished.courseId,
        expectedVersion: (await p.view(unpublished.courseId, unpublished.lead)).course.version,
      }),
    );
    const hidden = await p.published(goalId);
    value(await hide({ type: 'course', id: hidden.courseId }, randomUUID()));

    for (const courseId of [
      draft.courseId,
      retired.courseId,
      unpublished.courseId,
      hidden.courseId,
    ]) {
      expect(JSON.stringify(await coursePage(student.request, courseId))).toBe(
        JSON.stringify(missing),
      );
    }
    const listed = listedIds(value<CatalogPage>(await catalog(student.request)));
    for (const id of [draft.courseId, retired.courseId, unpublished.courseId, hidden.courseId])
      expect(listed).not.toContain(id);
  });

  it('BR11.5 Given pinned and unpinned courses, When I open the tab, Then pinned come first by rank, then the newest first publish', async () => {
    const segment = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    const freshGoal = value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, buildGoalInput(segment.segmentId)),
    ).goalId;
    const older = await p.published(freshGoal);
    const newer = await p.published(freshGoal);
    const pinned = await p.published(freshGoal);
    value(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'course', id: older.courseId },
        pinRank: 1,
        expectedVersion: (await p.view(older.courseId, s.admin)).course.version,
      }),
    );
    value(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'course', id: pinned.courseId },
        pinRank: 2,
        expectedVersion: (await p.view(pinned.courseId, s.admin)).course.version,
      }),
    );
    const page = value<CatalogPage>(await catalog((await studentOf(freshGoal)).request));
    expect(listedIds(page)).toEqual([older.courseId, pinned.courseId, newer.courseId]);
    expect(page.items.map((c) => c.isPinned)).toEqual([true, true, false]);
  });

  it('BR11.11 Given I am an instructor, When I try to pin a course, Then it is refused', async () => {
    const course = await p.published(goalId);
    expect(
      await s.call('setPinRank', course.lead.request, {
        target: { type: 'course', id: course.courseId },
        pinRank: 1,
        expectedVersion: (await p.view(course.courseId, course.lead)).course.version,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('BR11.4 Given the segment trial course is published in my segment, When I open Free trial, Then it is listed; a wrong-segment course is not', async () => {
    const trial = await p.published(goalId);
    const restore = await setTrialCourse(async (seg) =>
      seg === segmentId ? trial.courseId : null,
    );
    try {
      const student = await studentOf(goalId);
      const page = value<CatalogPage>(await catalog(student.request, 'free_trial'));
      expect(listedIds(page)).toEqual([trial.courseId]);
    } finally {
      restore();
    }
    const otherSegment = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    ).segmentId;
    const otherSegmentGoal = value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, buildGoalInput(otherSegment)),
    ).goalId;
    const restoreWrong = await setTrialCourse(async () => trial.courseId);
    try {
      const student = await studentOf(otherSegmentGoal);
      const page = value<CatalogPage>(await catalog(student.request, 'free_trial'));
      expect(page.items).toEqual([]);
    } finally {
      restoreWrong();
    }
  });

  it('BR2.1 Given I have no Goal, When the catalog loads, Then it answers NOT_FOUND so the screen sends me to S1', async () => {
    const student = await s.newStudent();
    expect(await catalog(student.request)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('NFR6.204 Given a tampered paging cursor, When I load more, Then it is refused VALIDATION_FAILED badCursor', async () => {
    const student = await studentOf(goalId);
    expect(await catalog(student.request, 'courses', 'eyJ2IjoxfQ.AAAA')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', i18nKey: 'errors.catalog.badCursor' },
    });
  });
});

describe('US2.2 See what a course includes before buying', () => {
  it('AC2.2.1 Given a published course, When I open it, Then I see the Lead and Co-instructors with their sections, the duration, the price, the description and the outline', async () => {
    const course = await p.published(goalId, {
      sections: 2,
      withCo: true,
      price: '২৫০০',
      months: 12,
    });
    const student = await studentOf(goalId);
    const page = value<CoursePage>(await coursePage(student.request, course.courseId));
    expect(page).toMatchObject({
      courseId: course.courseId,
      isCurrentGoal: true,
      titleBn: course.titles.titleBn,
      titleEn: course.titles.titleEn,
      descriptionBn: 'বিসিএস প্রস্তুতির কোর্স',
      listPricePoisha: 250_000,
      accessDurationMonths: 12,
      practicePacks: [],
    });
    const lead = page.instructors.find((i) => i.role === 'lead');
    const co = page.instructors.find((i) => i.role === 'co_instructor');
    expect(lead?.instructorId).toBe(course.lead.userId);
    expect(lead?.sections.map((x) => x.sectionId)).toEqual([course.sectionIds[1]]);
    expect(co?.instructorId).toBe(course.co?.userId);
    expect(co?.sections.map((x) => x.sectionId)).toEqual([course.sectionIds[0]]);
    expect(page.outline.map((x) => x.sectionId)).toEqual(course.sectionIds);
    expect(page.outline.flatMap((x) => x.lessons.map((l) => l.lessonId))).toEqual(course.lessonIds);
    // BR7.5: titles only, no previews: no lesson body, video asset or media status reaches S4.
    const raw = JSON.stringify(page);
    for (const field of ['bodyBn', 'bodyEn', 'videoAssetId', 'mediaStatus'])
      expect(raw).not.toContain(field);
  });

  it('UC6 E1 Given a course of another Goal, When I open it by URL, Then it is shown with its own Goal named', async () => {
    const course = await p.published(otherGoalId);
    const page = value<CoursePage>(
      await coursePage((await studentOf(goalId)).request, course.courseId),
    );
    expect(page.isCurrentGoal).toBe(false);
    expect(page.goal.goalId).toBe(otherGoalId);
  });
});

describe('NFR6.218 / SD-204 takedown and status on the student read paths', () => {
  it('Given a hidden course, When a Student reads S3, S4 or the lesson placement, Then it is refused to everyone at once', async () => {
    const course = await p.published(goalId);
    const student = await studentOf(goalId);
    expect(listedIds(value<CatalogPage>(await catalog(student.request)))).toContain(
      course.courseId,
    );
    value(await hide({ type: 'course', id: course.courseId }, randomUUID()));
    expect(listedIds(value<CatalogPage>(await catalog(student.request)))).not.toContain(
      course.courseId,
    );
    expect(await coursePage(student.request, course.courseId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await placement(course.lessonIds[0] as string)).toMatchObject({
      ok: true,
      value: { status: 'hidden' },
    });
  });

  it('Given a hidden section or lesson, When a Student opens S4, Then it is left out of the outline and its placement is hidden', async () => {
    const course = await p.published(goalId, { sections: 2 });
    value(await hide({ type: 'section', id: course.sectionIds[0] as string }, randomUUID()));
    value(await hide({ type: 'lesson', id: course.lessonIds[1] as string }, randomUUID()));
    const page = value<CoursePage>(
      await coursePage((await studentOf(goalId)).request, course.courseId),
    );
    expect(page.outline.map((x) => x.sectionId)).toEqual([course.sectionIds[1]]);
    expect(page.outline.flatMap((x) => x.lessons)).toEqual([]);
    for (const lessonId of course.lessonIds)
      expect(await placement(lessonId)).toMatchObject({ ok: true, value: { status: 'hidden' } });
  });

  it('Given an unpublished course, When it is browsed it is not-found, But its lessons stay live for enrolled students (BR4.5)', async () => {
    const course = await p.published(goalId);
    value(
      await s.call('unpublishCourse', course.lead.request, {
        courseId: course.courseId,
        expectedVersion: (await p.view(course.courseId, course.lead)).course.version,
      }),
    );
    const student = await studentOf(goalId);
    expect(await coursePage(student.request, course.courseId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await placement(course.lessonIds[0] as string)).toMatchObject({
      ok: true,
      value: { courseId: course.courseId, status: 'live' },
    });
  });
});
