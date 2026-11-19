// [LT] Step 32: the catalog read module (UC5, UC6; BR11.1–BR11.10; NFR6.204, NFR6.220; PD-201–PD-206)
// on a real PostgreSQL schema, through the real server functions, over really published courses.
// The key checks: a byte-for-byte comparison of the "not visible" and "non-existent" answers, no
// unpublished item on any page, and the keyset paging boundaries with the signed cursor.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hideContent } from '#src/features/catalog/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';

type Page = {
  items: Array<{ courseId: string; isPinned: boolean }>;
  nextCursor: string | null;
  tabsWithItems: string[];
};
type CoursePage = {
  instructors: Array<{ instructorId: string; displayName: string; role: string }>;
  outline: Array<{ sectionId: string; lessons: Array<{ lessonId: string }> }>;
};

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
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

async function freshGoal() {
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  return goalId;
}
async function studentOf(goalId: string) {
  const student = await s.newStudent();
  value(await s.call('chooseGoal', student.request, { goalId }));
  return student;
}
const list = (request: Request, tab: string, cursor?: string) =>
  s.call('listCatalog', request, { tab, ...(cursor ? { cursor } : {}) });
const hide = (type: 'course' | 'section' | 'lesson', id: string) =>
  withTransaction(getDb(), (tx) =>
    hideContent(tx, { contentRef: { type, id }, takedownNoticeId: randomUUID() }),
  );

async function allPages(request: Request) {
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = value<Page>(await list(request, 'courses', cursor));
    expect(page.items.length).toBeLessThanOrEqual(20);
    seen.push(...page.items.map((x) => x.courseId));
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < 10);
  return { seen, pages };
}

describe('S3 paging and visibility (BR11.1, BR11.5, PD-203, NFR6.204)', () => {
  let goalId: string;
  let student: Awaited<ReturnType<typeof studentOf>>;
  const published: string[] = [];
  const invisible: string[] = [];

  beforeAll(async () => {
    goalId = await freshGoal();
    for (let i = 0; i < 20; i += 1) published.push((await p.published(goalId)).courseId);
    invisible.push((await p.draft(goalId)).courseId);
    const hidden = await p.published(goalId);
    value(await hide('course', hidden.courseId));
    invisible.push(hidden.courseId);
    const unpublished = await p.published(goalId);
    value(
      await s.call('unpublishCourse', unpublished.lead.request, {
        courseId: unpublished.courseId,
        expectedVersion: (await p.view(unpublished.courseId, unpublished.lead)).course.version,
      }),
    );
    invisible.push(unpublished.courseId);
    student = await studentOf(goalId);
  }, 120_000);

  it('exactly 20 published courses fill one page with no next cursor', async () => {
    const page = value<Page>(await list(student.request, 'courses'));
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });

  it('lists newest first publish first when nothing is pinned', async () => {
    const page = value<Page>(await list(student.request, 'courses'));
    expect(page.items.map((x) => x.courseId)).toEqual([...published].reverse());
  });

  it('the 21st course opens a second page; walking every page lists each published course once and nothing else', async () => {
    published.push((await p.published(goalId)).courseId);
    const first = value<Page>(await list(student.request, 'courses'));
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const { seen, pages } = await allPages(student.request);
    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...published].sort());
    for (const id of invisible) expect(seen).not.toContain(id);
  });

  it('a cursor issued for one Goal or tab is refused on another (filter-bound)', async () => {
    const { nextCursor } = value<Page>(await list(student.request, 'courses'));
    const other = await studentOf(await freshGoal());
    const refused = {
      ok: false,
      error: { code: 'VALIDATION_FAILED', i18nKey: 'errors.catalog.badCursor' },
    };
    expect(await list(other.request, 'courses', nextCursor as string)).toMatchObject(refused);
    expect(await list(student.request, 'free_trial', nextCursor as string)).toMatchObject(refused);
    expect(await list(student.request, 'exam_packages', nextCursor as string)).toMatchObject(
      refused,
    );
  });

  it('a pinned course moves to the top and keeps paging consistent', async () => {
    const target = published[3] as string;
    value(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'course', id: target },
        pinRank: 5,
        expectedVersion: (await p.view(target, s.admin)).course.version,
      }),
    );
    const first = value<Page>(await list(student.request, 'courses'));
    expect(first.items[0]).toMatchObject({ courseId: target, isPinned: true });
    const { seen } = await allPages(student.request);
    expect(seen.filter((x) => x === target)).toHaveLength(1);
    expect(seen).toHaveLength(published.length);
  });

  it('hiding a listed course removes it from the very next page read (NFR6.218)', async () => {
    const target = published[0] as string;
    value(await hide('course', target));
    const { seen } = await allPages(student.request);
    expect(seen).not.toContain(target);
    published.shift();
  });
});

describe('S4 and not-found answers (BR4.4, SD-204, NFR6.204)', () => {
  it('answers a draft, hidden, unpublished or retired course byte for byte like a missing one', async () => {
    const goalId = await freshGoal();
    const student = await studentOf(goalId);
    const missing = JSON.stringify(
      await s.call('getCoursePage', student.request, { courseId: randomUUID() }),
    );
    const draft = await p.draft(goalId);
    const hidden = await p.published(goalId);
    value(await hide('course', hidden.courseId));
    const retired = await p.published(goalId);
    value(
      await s.call('retireCourse', retired.lead.request, {
        courseId: retired.courseId,
        expectedVersion: (await p.view(retired.courseId, retired.lead)).course.version,
      }),
    );
    for (const caller of [student, draft.lead, s.admin]) {
      for (const courseId of [draft.courseId, hidden.courseId, retired.courseId]) {
        expect(JSON.stringify(await s.call('getCoursePage', caller.request, { courseId }))).toBe(
          missing,
        );
      }
    }
  });

  it('refuses a malformed course ID at the schema, before any read', async () => {
    const student = await studentOf(await freshGoal());
    expect(await s.call('getCoursePage', student.request, { courseId: 'not-an-id' })).toMatchObject(
      { ok: false, error: { code: 'VALIDATION_FAILED' } },
    );
  });

  it('shows the instructors by display name, the Lead first', async () => {
    const goalId = await freshGoal();
    const course = await p.published(goalId, { sections: 2, withCo: true });
    await s.t.pool.query('UPDATE user_account SET display_name = $2 WHERE user_id = $1', [
      course.lead.userId,
      'Synthetic Lead',
    ]);
    const page = value<CoursePage>(
      await s.call('getCoursePage', (await studentOf(goalId)).request, {
        courseId: course.courseId,
      }),
    );
    expect(page.instructors.map((i) => [i.role, i.instructorId])).toEqual([
      ['lead', course.lead.userId],
      ['co_instructor', course.co?.userId],
    ]);
    expect(page.instructors[0]?.displayName).toBe('Synthetic Lead');
  });

  it('leaves a withdrawn lesson out of the outline once the removal is published (BR7.4)', async () => {
    const goalId = await freshGoal();
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
    const student = await studentOf(goalId);
    const before = value<CoursePage>(
      await s.call('getCoursePage', student.request, { courseId: course.courseId }),
    );
    // Nothing reaches students without a publish: the live outline is unchanged until then.
    expect(before.outline[0]?.lessons.map((l) => l.lessonId)).toEqual([
      course.lessonIds[0],
      second,
    ]);
    value(await p.publish(s.admin, course.courseId));
    const after = value<CoursePage>(
      await s.call('getCoursePage', student.request, { courseId: course.courseId }),
    );
    expect(after.outline[0]?.lessons.map((l) => l.lessonId)).toEqual([second]);
  });

  it('a Goal with no published course reports no tab with items (BR11.6)', async () => {
    const student = await studentOf(await freshGoal());
    const page = value<Page>(await list(student.request, 'courses'));
    expect(page).toMatchObject({ items: [], nextCursor: null, tabsWithItems: [] });
  });

  it('an anonymous caller is refused before any read (NFR6.201)', async () => {
    expect(await list(s.anonymous(), 'courses')).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(await s.call('getCoursePage', s.anonymous(), { courseId: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it("lists only the caller's own Goal: another student's Goal never leaks (wrong user)", async () => {
    const goalA = await freshGoal();
    const goalB = await freshGoal();
    const courseA = await p.published(goalA);
    await studentOf(goalA);
    const studentB = await studentOf(goalB);
    const page = value<Page>(await list(studentB.request, 'courses'));
    expect(page.items.map((x) => x.courseId)).not.toContain(courseA.courseId);
  });
});

describe('catalog course finder: search and numbered pages (public)', () => {
  type FinderPage = {
    items: Array<{ courseId: string }>;
    total: number;
    page: number;
    pageCount: number;
    goal: { goalId: string };
  };
  let goalId: string;
  const published: Array<{ courseId: string; titles: { titleBn: string; titleEn: string } }> = [];
  let draftId: string;
  const search = (data: Record<string, unknown>) =>
    s.call('searchCatalogCourses', s.anonymous(), { goalId, ...data });

  beforeAll(async () => {
    goalId = await freshGoal();
    for (let i = 0; i < 13; i += 1) published.push(await p.published(goalId));
    draftId = (await p.draft(goalId)).courseId;
  }, 120_000);

  it('an anonymous visitor gets 12 courses a page, 13 in total over 2 pages, drafts excluded', async () => {
    const first = value<FinderPage>(await search({ page: 1 }));
    const second = value<FinderPage>(await search({ page: 2 }));
    expect(first.items).toHaveLength(12);
    expect(second.items).toHaveLength(1);
    expect(first.total).toBe(13);
    expect(first.pageCount).toBe(2);
    const seen = [...first.items, ...second.items].map((x) => x.courseId);
    expect(new Set(seen).size).toBe(13);
    expect([...seen].sort()).toEqual(published.map((x) => x.courseId).sort());
    expect(seen).not.toContain(draftId);
  });

  it('a page past the last one is empty but keeps the total', async () => {
    const page = value<FinderPage>(await search({ page: 3 }));
    expect(page.items).toEqual([]);
    expect(page.total).toBe(13);
  });

  it('finds a course by its English or Bangla title, case-insensitively', async () => {
    const target = published[4];
    if (!target) throw new Error('fixture missing');
    const byEn = value<FinderPage>(await search({ query: target.titles.titleEn.toUpperCase() }));
    expect(byEn.items.map((x) => x.courseId)).toContain(target.courseId);
    const byBn = value<FinderPage>(await search({ query: target.titles.titleBn }));
    expect(byBn.items.map((x) => x.courseId)).toContain(target.courseId);
  });

  it('matches LIKE wildcards literally', async () => {
    const page = value<FinderPage>(await search({ query: '%_%' }));
    expect(page.total).toBe(0);
  });
});
