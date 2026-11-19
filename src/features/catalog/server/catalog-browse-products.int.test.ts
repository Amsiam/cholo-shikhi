// [LT] Step 43: the S3 / S4 read module over products, on a real PostgreSQL schema: plan cards head
// only the first Courses page with the current version's price (BR11.2), the Exam packages tab lists
// only published packages of the Goal with keyset paging (BR11.1, BR11.5), the available tabs name
// it (BR11.6), and S4 lists only published Practice Packs (BR11.8).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';
import {
  registerQuestionReferenceCheck,
  resetQuestionReferenceCheckForTests,
} from './question-check.server.ts';

type Card = { kind: string; planId?: string; examPackageId?: string; courseId?: string } & Record<
  string,
  unknown
>;
type Page = { items: Card[]; nextCursor: string | null; tabsWithItems: string[] };
type Saved = { version: number; status: string };

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let segmentId: string;

async function setSetting(settingKey: string, v: number) {
  value(
    await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
  );
}
async function newGoal() {
  return value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
}
async function studentOf(goalId: string) {
  const student = await s.newStudent();
  value(await s.call('chooseGoal', student.request, { goalId }));
  return student;
}
const list = async (request: Request, tab: string, cursor?: string) =>
  value<Page>(await s.call('listCatalog', request, { tab, ...(cursor ? { cursor } : {}) }));

async function publishedExam(goalId: string, price = '৪৯৯') {
  const saved = value<Saved & { examPackageId: string }>(
    await s.call('saveExamPackage', s.admin.request, {
      goalId,
      ...buildTitle(),
      price,
      questionIds: [randomUUID()],
      timeLimitMinutes: 30,
    }),
  );
  value(
    await s.call('publishExamPackage', s.admin.request, {
      examPackageId: saved.examPackageId,
      expectedVersion: saved.version,
    }),
  );
  return saved.examPackageId;
}
async function publishedPlan(goalId: string, courseIds: string[], monthlyPrice = '২৯৯') {
  const title = buildTitle();
  const body = { goalId, nameBn: title.titleBn, nameEn: title.titleEn, examPackageIds: [] };
  const saved = value<Saved & { planId: string }>(
    await s.call('savePlan', s.admin.request, { ...body, monthlyPrice, courseIds }),
  );
  const pub = value<Saved>(
    await s.call('publishPlan', s.admin.request, {
      planId: saved.planId,
      expectedVersion: saved.version,
    }),
  );
  return { planId: saved.planId, version: pub.version, body };
}

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  segmentId = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  ).segmentId;
  await setSetting('catalog.coursePrice.minPoisha', 10_000);
  await setSetting('catalog.coursePrice.maxPoisha', 5_000_000);
  await setSetting('catalog.examPackagePrice.maxPoisha', 500_000);
  await setSetting('catalog.planMonthlyPrice.maxPoisha', 300_000);
  resetQuestionReferenceCheckForTests();
  registerQuestionReferenceCheck(async () => ({ valid: true }));
});
afterAll(async () => {
  resetQuestionReferenceCheckForTests();
  await s?.close();
});

describe('S3 plan cards (BR11.2)', () => {
  it('head the first Courses page only, priced by the current version, never the draft edit', async () => {
    const goalId = await newGoal();
    const course = await p.published(goalId);
    const plan = await publishedPlan(goalId, [course.courseId]);
    value(
      await s.call('savePlan', s.admin.request, {
        ...plan.body,
        planId: plan.planId,
        expectedVersion: plan.version,
        monthlyPrice: '১৯৯',
        courseIds: [course.courseId],
      }),
    );
    const student = await studentOf(goalId);
    const page = await list(student.request, 'courses');
    expect(page.items[0]).toMatchObject({
      kind: 'plan',
      planId: plan.planId,
      monthlyPricePoisha: 29_900,
      isPinned: false,
    });
    expect(page.items[1]).toMatchObject({ kind: 'course', courseId: course.courseId });
  });

  it('a draft plan, a plan of another Goal and a retired plan are not listed', async () => {
    const goalId = await newGoal();
    const otherGoalId = await newGoal();
    const course = await p.published(goalId);
    const foreign = await p.published(otherGoalId);
    const retired = await publishedPlan(goalId, [course.courseId]);
    value(
      await s.call('retirePlan', s.admin.request, {
        planId: retired.planId,
        expectedVersion: retired.version,
      }),
    );
    await publishedPlan(otherGoalId, [foreign.courseId]);
    const title = buildTitle();
    value(
      await s.call('savePlan', s.admin.request, {
        goalId,
        nameBn: title.titleBn,
        nameEn: title.titleEn,
        monthlyPrice: '২৯৯',
        courseIds: [course.courseId],
        examPackageIds: [],
      }),
    );
    const page = await list((await studentOf(goalId)).request, 'courses');
    expect(page.items.filter((i) => i.kind === 'plan')).toEqual([]);
  });

  it('names the Courses tab as having items when the Goal has a plan but no course (BR11.6)', async () => {
    const goalId = await newGoal();
    const examPackageId = await publishedExam(goalId);
    const title = buildTitle();
    const saved = value<Saved & { planId: string }>(
      await s.call('savePlan', s.admin.request, {
        goalId,
        nameBn: title.titleBn,
        nameEn: title.titleEn,
        monthlyPrice: '২৯৯',
        courseIds: [],
        examPackageIds: [examPackageId],
      }),
    );
    value(
      await s.call('publishPlan', s.admin.request, {
        planId: saved.planId,
        expectedVersion: saved.version,
      }),
    );
    const page = await list((await studentOf(goalId)).request, 'exam_packages');
    expect(page.tabsWithItems).toEqual(['courses', 'exam_packages']);
  });
});

describe('S3 Exam packages tab (BR11.1, BR11.5, BR11.6)', () => {
  it('lists only published packages of the Goal, and names the tab as having items', async () => {
    const goalId = await newGoal();
    const mine = await publishedExam(goalId, '৪৯৯.৫০');
    const draft = value<{ examPackageId: string }>(
      await s.call('saveExamPackage', s.admin.request, {
        goalId,
        ...buildTitle(),
        price: '১০০',
        questionIds: [],
        timeLimitMinutes: null,
      }),
    ).examPackageId;
    const foreign = await publishedExam(await newGoal());
    const student = await studentOf(goalId);
    const page = await list(student.request, 'exam_packages');
    const ids = page.items.map((i) => i.examPackageId);
    expect(ids).toEqual([mine]);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(foreign);
    expect(page.items[0]).toMatchObject({ kind: 'exam_package', listPricePoisha: 49_950 });
    expect(page.tabsWithItems).toContain('exam_packages');
    expect((await list(student.request, 'courses')).tabsWithItems).toContain('exam_packages');
  });

  it('pages 20 at a time with a signed cursor, pinned first, never repeating a package', async () => {
    const goalId = await newGoal();
    const ids: string[] = [];
    for (let i = 0; i < 21; i += 1) ids.push(await publishedExam(goalId));
    const pinned = ids[20] as string;
    value(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'exam_package', id: pinned },
        pinRank: 1,
        expectedVersion: 2,
      }),
    );
    const student = await studentOf(goalId);
    const first = await list(student.request, 'exam_packages');
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.examPackageId).toBe(pinned);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(student.request, 'exam_packages', first.nextCursor as string);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((i) => i.examPackageId);
    expect(new Set(seen).size).toBe(21);
    // A Courses cursor is bound to its tab and refused on this one (SD-205).
    expect(
      await s.call('listCatalog', student.request, {
        tab: 'courses',
        cursor: first.nextCursor as string,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  }, 60_000);
});

describe('S4 Practice Packs (BR11.8)', () => {
  it('lists only the published packs of the course', async () => {
    const goalId = await newGoal();
    const course = await p.published(goalId);
    const pack = async () =>
      value<Saved & { practicePackId: string }>(
        await s.call('savePracticePack', course.lead.request, {
          courseId: course.courseId,
          ...buildTitle(),
          price: '১৯৯',
          questionSetIds: [randomUUID()],
        }),
      );
    const live = await pack();
    await pack();
    value(
      await s.call('publishPracticePack', course.lead.request, {
        practicePackId: live.practicePackId,
        expectedVersion: live.version,
      }),
    );
    const page = value<{ practicePacks: Array<{ practicePackId: string }> }>(
      await s.call('getCoursePage', (await studentOf(goalId)).request, {
        courseId: course.courseId,
      }),
    );
    expect(page.practicePacks.map((x) => x.practicePackId)).toEqual([live.practicePackId]);
  });
});
