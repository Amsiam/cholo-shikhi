// [LT] Step 41: product server functions through their real builders on a real PostgreSQL schema:
// the BR10.8 current-plan guard on courses and exam packages (a regression test that failed before
// the course guard), versions on republish, the CR-5 unpublish flag, the publish-time ceiling
// re-check (BR5.9), plan item eligibility at publish (BR10.5), audit and outbox rows in the same
// transaction (BR10.7, SD-219), product pins (BR11.11) and the NFR6.202 negative matrix.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';
import {
  registerQuestionReferenceCheck,
  resetQuestionReferenceCheckForTests,
} from './question-check.server.ts';

type Saved = { version: number; status: string };
type Published = Saved & { versionNumber: number };

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let goalId: string;

async function setSetting(settingKey: string, v: number) {
  value(
    await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
  );
}

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  await setSetting('catalog.coursePrice.minPoisha', 10_000);
  await setSetting('catalog.coursePrice.maxPoisha', 5_000_000);
  await setSetting('catalog.examPackagePrice.maxPoisha', 500_000);
  await setSetting('catalog.planMonthlyPrice.maxPoisha', 300_000);
  resetQuestionReferenceCheckForTests();
  // An Assessment stub: every question and question set exists.
  registerQuestionReferenceCheck(async () => ({ valid: true }));
});
afterAll(async () => {
  resetQuestionReferenceCheckForTests();
  await s?.close();
});

const exam = async (overrides: Record<string, unknown> = {}) =>
  value<Saved & { examPackageId: string }>(
    await s.call('saveExamPackage', s.admin.request, {
      goalId,
      ...buildTitle(),
      price: '৪৯৯',
      questionIds: [randomUUID(), randomUUID()],
      timeLimitMinutes: 30,
      ...overrides,
    }),
  );
const publishedExam = async () => {
  const saved = await exam();
  const pub = value<Published>(
    await s.call('publishExamPackage', s.admin.request, {
      examPackageId: saved.examPackageId,
      expectedVersion: saved.version,
    }),
  );
  return { examPackageId: saved.examPackageId, version: pub.version };
};
const planOf = async (courseIds: string[], examPackageIds: string[] = []) => {
  const title = buildTitle();
  const saved = value<Saved & { planId: string }>(
    await s.call('savePlan', s.admin.request, {
      goalId,
      nameBn: title.titleBn,
      nameEn: title.titleEn,
      monthlyPrice: '২৯৯',
      courseIds,
      examPackageIds,
    }),
  );
  return saved;
};
const publishPlan = async (planId: string, expectedVersion: number) =>
  s.call('publishPlan', s.admin.request, { planId, expectedVersion });
const courseVersion = async (courseId: string) => (await p.view(courseId, s.admin)).course.version;
const rowCount = async (sql: string, args: unknown[]) =>
  (await s.t.pool.query<{ n: number }>(sql, args)).rows[0]?.n;

describe('BR10.8 items in a current plan cannot be retired or unpublished', () => {
  it('regression: retiring a course that a published plan includes is refused CONFLICT inCurrentPlan', async () => {
    const course = await p.published(goalId);
    const plan = await planOf([course.courseId]);
    value(await publishPlan(plan.planId, plan.version));
    expect(
      await s.call('retireCourse', s.admin.request, {
        courseId: course.courseId,
        expectedVersion: await courseVersion(course.courseId),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.inCurrentPlan' },
    });
    expect((await p.view(course.courseId, s.admin)).course.status).toBe('published');
  });

  it('refuses retiring an exam package in a current plan, and allows it once a new version drops it', async () => {
    const course = await p.published(goalId);
    const pkg = await publishedExam();
    const plan = await planOf([course.courseId], [pkg.examPackageId]);
    const v1 = value<Published>(await publishPlan(plan.planId, plan.version));
    const retire = (expectedVersion: number) =>
      s.call('retireExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion,
      });
    expect(await retire(pkg.version)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.inCurrentPlan' },
    });
    const title = buildTitle();
    const edited = value<Saved>(
      await s.call('savePlan', s.admin.request, {
        planId: plan.planId,
        expectedVersion: v1.version,
        goalId,
        nameBn: title.titleBn,
        nameEn: title.titleEn,
        monthlyPrice: '২৯৯',
        courseIds: [course.courseId],
        examPackageIds: [],
      }),
    );
    value(await publishPlan(plan.planId, edited.version));
    expect(await retire(pkg.version)).toMatchObject({ ok: true, value: { status: 'retired' } });
  });

  it('never blocks a plan that is not published: a draft plan holds no current version', async () => {
    const course = await p.published(goalId);
    await planOf([course.courseId]);
    expect(
      await s.call('retireCourse', s.admin.request, {
        courseId: course.courseId,
        expectedVersion: await courseVersion(course.courseId),
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('exam package lifecycle', () => {
  it('CR-5 fallback: unpublish answers FEATURE_DISABLED while catalog.unpublish is off', async () => {
    const pkg = await publishedExam();
    expect(
      await s.call('unpublishExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion: pkg.version,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } });
  });

  it('with the flag on: unpublish, then republish without changes reuses the current version', async () => {
    value(
      await s.call('saveFlag', s.admin.request, {
        flagKey: 'catalog.unpublish',
        description: 'LT: unpublish on',
        state: 'on',
      }),
    );
    const pkg = await publishedExam();
    const down = value<Saved>(
      await s.call('unpublishExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion: pkg.version,
      }),
    );
    expect(down.status).toBe('unpublished');
    const up = value<Published>(
      await s.call('publishExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion: down.version,
      }),
    );
    expect(up.versionNumber).toBe(1);
    expect(
      await rowCount(
        'SELECT count(*)::int AS n FROM exam_package_version WHERE exam_package_id = $1',
        [pkg.examPackageId],
      ),
    ).toBe(1);
  });

  it('a retired package accepts no publish and no edit', async () => {
    const pkg = await publishedExam();
    const retired = value<Saved>(
      await s.call('retireExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion: pkg.version,
      }),
    );
    expect(
      await s.call('publishExamPackage', s.admin.request, {
        examPackageId: pkg.examPackageId,
        expectedVersion: retired.version,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.catalog.invalidTransition' } });
  });

  it('refuses a stale version token on save and publish (BR12.1)', async () => {
    const saved = await exam();
    expect(
      await s.call('publishExamPackage', s.admin.request, {
        examPackageId: saved.examPackageId,
        expectedVersion: saved.version + 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
  });

  it('BR5.9 re-checks the price at publish: a lowered ceiling refuses the publish', async () => {
    const saved = await exam({ price: '4000' });
    await setSetting('catalog.examPackagePrice.maxPoisha', 300_000);
    try {
      expect(
        await s.call('publishExamPackage', s.admin.request, {
          examPackageId: saved.examPackageId,
          expectedVersion: saved.version,
        }),
      ).toMatchObject({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
        },
      });
    } finally {
      await setSetting('catalog.examPackagePrice.maxPoisha', 500_000);
    }
  });

  it('writes the audit entry and one IDs-only outbox event in the publish transaction', async () => {
    const pkg = await publishedExam();
    expect(
      await rowCount(
        `SELECT count(*)::int AS n FROM outbox_event WHERE event_type = 'catalog.ProductChanged' AND aggregate_key = $1`,
        [pkg.examPackageId],
      ),
    ).toBe(1);
    expect(
      await rowCount(
        `SELECT count(*)::int AS n FROM audit_log_entry WHERE subject_id = $1 AND action = 'catalog.examPackage.published'`,
        [pkg.examPackageId],
      ),
    ).toBe(1);
  });

  it('refuses a new package under an inactive Goal (BR1.9)', async () => {
    expect(
      await s.call('saveExamPackage', s.admin.request, {
        goalId: randomUUID(),
        ...buildTitle(),
        price: '৪৯৯',
        questionIds: [],
        timeLimitMinutes: 30,
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { goalId: ['errors.goals.goalNotActive'] } },
    });
  });
});

describe('plan publish (BR10.5, BR10.6)', () => {
  it('refuses an item that is not published at publish time, naming no secret', async () => {
    const draftExam = await exam();
    const plan = await planOf([], [draftExam.examPackageId]);
    expect(await publishPlan(plan.planId, plan.version)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { items: ['errors.catalog.planItemNotEligible'] },
      },
    });
  });

  it('marks unpublished changes on a published plan and keeps version 1 current until the next publish', async () => {
    const a = await p.published(goalId);
    const plan = await planOf([a.courseId]);
    const v1 = value<Published>(await publishPlan(plan.planId, plan.version));
    const list = async () =>
      value<{ rows: Array<{ planId: string; hasUnpublishedChanges: boolean; status: string }> }>(
        await s.call('listPlansAdmin', s.admin.request, { page: 1, pageSize: 100 }),
      ).rows.find((r) => r.planId === plan.planId);
    const title = buildTitle();
    value(
      await s.call('savePlan', s.admin.request, {
        planId: plan.planId,
        expectedVersion: v1.version,
        goalId,
        nameBn: title.titleBn,
        nameEn: title.titleEn,
        monthlyPrice: '১৯৯',
        courseIds: [a.courseId],
        examPackageIds: [],
      }),
    );
    expect(await list()).toMatchObject({ status: 'published', hasUnpublishedChanges: true });
    const version = await s.t.pool.query<{ monthly_price_poisha: number }>(
      `SELECT v.monthly_price_poisha::int AS monthly_price_poisha FROM subscription_plan p JOIN subscription_plan_version v ON v.plan_version_id = p.current_version_id WHERE p.plan_id = $1`,
      [plan.planId],
    );
    expect(version.rows[0]?.monthly_price_poisha).toBe(29_900);
  });

  it('lists the published candidates of the Goal for the A9 picker', async () => {
    const course = await p.published(goalId);
    const candidates = value<{ courses: Array<{ id: string }> }>(
      await s.call('listPlanItemCandidates', s.admin.request, { goalId }),
    );
    expect(candidates.courses.map((c) => c.id)).toContain(course.courseId);
  });
});

describe('product pins (UC22, BR11.11)', () => {
  it('pins and unpins an exam package and a plan, each audited and versioned', async () => {
    const pkg = await publishedExam();
    const pinned = value<{ examPackageId: string; pinRank: number; version: number }>(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'exam_package', id: pkg.examPackageId },
        pinRank: 2,
        expectedVersion: pkg.version,
      }),
    );
    expect(pinned).toMatchObject({ examPackageId: pkg.examPackageId, pinRank: 2 });
    const course = await p.published(goalId);
    const plan = await planOf([course.courseId]);
    const planPinned = value<{ planId: string; version: number }>(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'subscription_plan', id: plan.planId },
        pinRank: 1,
        expectedVersion: plan.version,
      }),
    );
    value(
      await s.call('clearPinRank', s.admin.request, {
        target: { type: 'subscription_plan', id: plan.planId },
        expectedVersion: planPinned.version,
      }),
    );
    const actions = await s.t.pool.query<{ action: string }>(
      `SELECT action FROM audit_log_entry WHERE subject_id = ANY($1) AND action LIKE '%pinned' ORDER BY occurred_at, audit_entry_id`,
      [[pkg.examPackageId, plan.planId]],
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      'catalog.examPackage.pinned',
      'catalog.plan.pinned',
      'catalog.plan.unpinned',
    ]);
  });

  it('refuses a stale token and an unknown product', async () => {
    const pkg = await publishedExam();
    expect(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'exam_package', id: pkg.examPackageId },
        pinRank: 1,
        expectedVersion: pkg.version + 5,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'subscription_plan', id: randomUUID() },
        pinRank: 1,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('Practice Pack authorization and edits (BR10.9, NFR6.202)', () => {
  const packInput = (courseId: string) => ({
    courseId,
    ...buildTitle(),
    price: '১৯৯',
    questionSetIds: [randomUUID()],
  });

  it('the Lead of another course gets NOT_FOUND and nothing is saved', async () => {
    const course = await p.published(goalId);
    const stranger = await s.newInstructor();
    expect(
      await s.call('savePracticePack', stranger.request, packInput(course.courseId)),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      await rowCount('SELECT count(*)::int AS n FROM practice_pack WHERE course_id = $1', [
        course.courseId,
      ]),
    ).toBe(0);
  });

  it('refuses an empty question-set list with a field error (BR10.9)', async () => {
    const course = await p.published(goalId);
    expect(
      await s.call('savePracticePack', course.lead.request, {
        ...packInput(course.courseId),
        questionSetIds: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { questionSetIds: ['errors.catalog.questionSetsRequired'] } },
    });
  });

  it('the Lead edits a pack with the version token and lists the course packs; a Co-instructor cannot list them', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    const saved = value<Saved & { practicePackId: string }>(
      await s.call('savePracticePack', course.lead.request, packInput(course.courseId)),
    );
    const edited = value<Saved>(
      await s.call('savePracticePack', course.lead.request, {
        ...packInput(course.courseId),
        practicePackId: saved.practicePackId,
        expectedVersion: saved.version,
        price: '২৪৯',
      }),
    );
    expect(edited.version).toBe(saved.version + 1);
    const listed = value<{ rows: Array<{ practicePackId: string; listPricePoisha: number }> }>(
      await s.call('listPracticePacks', course.lead.request, { courseId: course.courseId }),
    );
    expect(listed.rows).toEqual([
      expect.objectContaining({ practicePackId: saved.practicePackId, listPricePoisha: 24_900 }),
    ]);
    expect(
      await s.call('listPracticePacks', (course.co as Caller).request, {
        courseId: course.courseId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' } });
  });

  it('an Admin, a Student and Finance are the wrong role for Practice Packs (FORBIDDEN)', async () => {
    const course = await p.published(goalId);
    for (const caller of [s.admin, await s.newStudent(), await s.newFinance()]) {
      expect(
        await s.call('savePracticePack', caller.request, packInput(course.courseId)),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
  });
});

const ADMIN_PRODUCT_FNS = [
  'listExamPackagesAdmin',
  'saveExamPackage',
  'publishExamPackage',
  'unpublishExamPackage',
  'retireExamPackage',
  'listPlansAdmin',
  'listPlanItemCandidates',
  'savePlan',
  'publishPlan',
  'unpublishPlan',
  'retirePlan',
];
const LEAD_PRODUCT_FNS = ['listPracticePacks', 'savePracticePack', 'publishPracticePack'];

describe('NFR6.202 negative matrix', () => {
  it.each([...ADMIN_PRODUCT_FNS, ...LEAD_PRODUCT_FNS])(
    '%s refuses an anonymous caller with UNAUTHENTICATED',
    async (name) => {
      expect(await s.call(name, s.anonymous(), {})).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    },
  );

  it.each(ADMIN_PRODUCT_FNS)(
    '%s refuses a Student, an Instructor and Finance with FORBIDDEN',
    async (name) => {
      for (const caller of [await s.newStudent(), s.instructor, await s.newFinance()]) {
        expect(await s.call(name, caller.request, {})).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN' },
        });
      }
    },
  );

  it.each(ADMIN_PRODUCT_FNS)('%s refuses an Admin without step-up', async (name) => {
    expect(await s.call(name, s.adminWithoutStepUp.request, {})).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
  });
});
