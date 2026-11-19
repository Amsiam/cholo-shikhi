// [AT] Step 37: Given/When/Then acceptance tests for US2.28 (exam packages), US2.8 (subscription
// plans) and US5.4 (Practice Packs), written from stories.md, functional-spec UC17–UC19 and the
// rules.md error mapping before any implementation. They call the real server functions through
// their real builders on a per-file schema with real Better Auth sessions, over courses that were
// really published.
//
// Deferred (CR-8 data from U4 Assessment, completes in u4-learning Code Generation): AC2.28.1 and
// AC5.4.1 need tagged questions and question sets in a real bank. Until Assessment registers the
// question-reference check, publish answers INVALID_STATE errors.catalog.questionCheckUnavailable;
// that refusal is asserted here, and the happy paths run against an in-repo stub check registered
// through the test seam (never a mock of U2 code).
// Partly met (CR-6 has no recorded approval): AC2.28.3 and AC2.8.3 are asserted on the immutable
// version rows Catalog keeps; U3 / U4 binding to a version needs CR-6's version reads.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as catalogModule from '#src/features/catalog/index.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from './test-fixtures/publish-helper.ts';

type Saved = { version: number; status: string };
type ExamSaved = Saved & { examPackageId: string };
type PlanSaved = Saved & { planId: string };
type PackSaved = Saved & { practicePackId: string };
type Published = { status: string; version: number; versionNumber: number };
type QuestionCheck = (input: {
  questionIds?: string[];
  questionSetIds?: string[];
  courseId?: string;
}) => Promise<{ valid: true } | { valid: false; unknownIds: string[] }>;

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let goalId: string;
let otherGoalId: string;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  otherGoalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  await setSetting('catalog.coursePrice.minPoisha', 10_000);
  await setSetting('catalog.coursePrice.maxPoisha', 5_000_000);
});
afterAll(async () => {
  await unregisterCheck();
  await s?.close();
});

async function setSetting(settingKey: string, v: number) {
  value(
    await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'AT bounds' }),
  );
}
const setCeilings = async () => {
  await setSetting('catalog.examPackagePrice.maxPoisha', 500_000);
  await setSetting('catalog.planMonthlyPrice.maxPoisha', 300_000);
};

/** The CR-8 port, looked up at call time so a missing export fails its own test only. */
async function registerCheck(check: QuestionCheck) {
  const register = (catalogModule as unknown as Record<string, unknown>)
    .registerQuestionReferenceCheck;
  if (typeof register !== 'function') throw new Error('registerQuestionReferenceCheck is missing');
  await unregisterCheck();
  register(check);
}
/** Test seam: forgets a registered check (the port refuses a second registration in production). */
async function unregisterCheck() {
  const seam = (await import('./server/question-check.server.ts').catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const reset = seam?.resetQuestionReferenceCheckForTests;
  if (typeof reset === 'function') reset();
}
/** An Assessment stub: every ID it was told about exists; anything else is unknown. */
const bankWith =
  (known: string[]): QuestionCheck =>
  async (input) => {
    const asked = [...(input.questionIds ?? []), ...(input.questionSetIds ?? [])];
    const unknownIds = asked.filter((id) => !known.includes(id));
    return unknownIds.length === 0 ? { valid: true } : { valid: false, unknownIds };
  };

const questions = (n: number) => Array.from({ length: n }, () => randomUUID());

function examInput(overrides: Record<string, unknown> = {}) {
  return {
    goalId,
    ...buildTitle(),
    price: '৪৯৯',
    questionIds: questions(5),
    timeLimitMinutes: 60,
    ...overrides,
  };
}
async function createExam(overrides: Record<string, unknown> = {}) {
  return value<ExamSaved>(await s.call('saveExamPackage', s.admin.request, examInput(overrides)));
}
const publishExam = (examPackageId: string, expectedVersion: number) =>
  s.call('publishExamPackage', s.admin.request, { examPackageId, expectedVersion });

function planInput(courseIds: string[], overrides: Record<string, unknown> = {}) {
  const title = buildTitle();
  return {
    goalId,
    nameBn: title.titleBn,
    nameEn: title.titleEn,
    monthlyPrice: '৩৯৯',
    courseIds,
    examPackageIds: [],
    ...overrides,
  };
}
const versionRows = async (table: string, key: string, id: string) =>
  (await s.t.pool.query(`SELECT * FROM ${table} WHERE ${key} = $1 ORDER BY version_number`, [id]))
    .rows;

describe('ceilings not set yet (BR5.9)', () => {
  it('AC2.8.2 Given no plan price ceiling, When I save a plan, Then it is refused SETTING_NOT_SET', async () => {
    const course = await p.published(goalId);
    expect(await s.call('savePlan', s.admin.request, planInput([course.courseId]))).toMatchObject({
      ok: false,
      error: { code: 'SETTING_NOT_SET' },
    });
  });

  it('Given no exam package price ceiling, When I save a package, Then it is refused SETTING_NOT_SET', async () => {
    expect(await s.call('saveExamPackage', s.admin.request, examInput())).toMatchObject({
      ok: false,
      error: { code: 'SETTING_NOT_SET' },
    });
  });
});

describe('US2.28 Create an exam package', () => {
  beforeAll(setCeilings);

  it('AC2.28.2 Given a package with no questions, When I publish, Then it is refused VALIDATION_FAILED examPackageIncomplete and stays a draft', async () => {
    await unregisterCheck();
    const saved = await createExam({ questionIds: [] });
    expect(saved.status).toBe('draft');
    expect(await publishExam(saved.examPackageId, saved.version)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.catalog.examPackageIncomplete',
        fieldErrors: { questionIds: ['errors.catalog.examPackageIncomplete'] },
      },
    });
    expect(
      await versionRows('exam_package_version', 'exam_package_id', saved.examPackageId),
    ).toEqual([]);
  });

  it('AC2.28.2 Given a package with no time limit, When I publish, Then it is refused VALIDATION_FAILED examPackageIncomplete', async () => {
    const saved = await createExam({ timeLimitMinutes: null });
    expect(await publishExam(saved.examPackageId, saved.version)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.catalog.examPackageIncomplete',
        fieldErrors: { timeLimitMinutes: ['errors.catalog.examPackageIncomplete'] },
      },
    });
  });

  it('AC2.28.1 (Deferred, CR-8) Given a complete package and no question check registered yet, When I publish, Then it is refused INVALID_STATE questionCheckUnavailable and kept as a draft', async () => {
    await unregisterCheck();
    const saved = await createExam();
    expect(await publishExam(saved.examPackageId, saved.version)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.questionCheckUnavailable' },
    });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const page = value<{ items: Array<{ examPackageId?: string }> }>(
      await s.call('listCatalog', student.request, { tab: 'exam_packages' }),
    );
    expect(page.items.map((i) => i.examPackageId)).not.toContain(saved.examPackageId);
  });

  it('AC2.28.1 Given tagged questions in the bank (stub check), When I publish a package with 100 questions and a 60-minute limit, Then it appears under Exam packages for its Goal', async () => {
    const ids = questions(100);
    await registerCheck(bankWith(ids));
    const saved = await createExam({ questionIds: ids, timeLimitMinutes: 60 });
    const published = value<Published>(await publishExam(saved.examPackageId, saved.version));
    expect(published).toMatchObject({ status: 'published', versionNumber: 1 });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const page = value<{ items: Array<{ kind: string; examPackageId?: string }> }>(
      await s.call('listCatalog', student.request, { tab: 'exam_packages' }),
    );
    expect(page.items).toContainEqual(
      expect.objectContaining({ kind: 'exam_package', examPackageId: saved.examPackageId }),
    );
  });

  it('BR10.4 Given questions the bank does not know, When I publish, Then it is refused VALIDATION_FAILED listing them', async () => {
    const known = questions(2);
    const stranger = randomUUID();
    await registerCheck(bankWith(known));
    const saved = await createExam({ questionIds: [...known, stranger] });
    const refused = await publishExam(saved.examPackageId, saved.version);
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { questionIds: ['errors.catalog.unknownQuestions'] },
      },
    });
    // Contract 1: details (the unknown IDs) stay on the server; products.test.ts checks the list.
    expect((refused as { error: Record<string, unknown> }).error.details).toBeUndefined();
    expect(
      await versionRows('exam_package_version', 'exam_package_id', saved.examPackageId),
    ).toEqual([]);
  });

  it('AC2.28.3 (partly met, CR-6) Given a published package, When I edit its questions and publish again, Then a new version is current and the version past attempts used is unchanged', async () => {
    const first = questions(3);
    const second = questions(4);
    await registerCheck(bankWith([...first, ...second]));
    const saved = await createExam({ questionIds: first, timeLimitMinutes: 45 });
    const v1 = value<Published>(await publishExam(saved.examPackageId, saved.version));
    const edited = value<ExamSaved>(
      await s.call(
        'saveExamPackage',
        s.admin.request,
        examInput({
          examPackageId: saved.examPackageId,
          expectedVersion: v1.version,
          questionIds: second,
          timeLimitMinutes: 90,
        }),
      ),
    );
    // The edit is a draft change only: the package stays published on version 1 (BR10.3).
    expect(edited.status).toBe('published');
    const v2 = value<Published>(await publishExam(saved.examPackageId, edited.version));
    expect(v2.versionNumber).toBe(2);
    const rows = await versionRows('exam_package_version', 'exam_package_id', saved.examPackageId);
    expect(rows.map((r) => [r.version_number, r.question_ids, r.time_limit_minutes])).toEqual([
      [1, first, 45],
      [2, second, 90],
    ]);
  });

  it('BR5.9 Given a price above the exam package ceiling, When I save, Then it is refused VALIDATION_FAILED priceAboveMax', async () => {
    expect(
      await s.call('saveExamPackage', s.admin.request, examInput({ price: '5000.01' })),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
      },
    });
  });

  it('BR10.11 Given I am an instructor, When I save an exam package, Then it is refused FORBIDDEN', async () => {
    expect(await s.call('saveExamPackage', s.instructor.request, examInput())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});

describe('US2.8 Define subscription plans', () => {
  beforeAll(setCeilings);

  it('AC2.8.1 Given published courses, When I create a plan with a monthly price, a Goal and selected items and publish it, Then it appears in the catalog for that Goal as a plan card at the top of the Courses tab', async () => {
    const course = await p.published(goalId);
    const saved = value<PlanSaved>(
      await s.call('savePlan', s.admin.request, planInput([course.courseId])),
    );
    expect(saved.status).toBe('draft');
    value(
      await s.call('publishPlan', s.admin.request, {
        planId: saved.planId,
        expectedVersion: saved.version,
      }),
    );
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const page = value<{
      items: Array<{ kind: string; planId?: string; monthlyPricePoisha?: number }>;
    }>(await s.call('listCatalog', student.request, { tab: 'courses' }));
    expect(page.items[0]).toMatchObject({ kind: 'plan' });
    expect(page.items).toContainEqual(
      expect.objectContaining({ kind: 'plan', planId: saved.planId, monthlyPricePoisha: 39_900 }),
    );
  });

  it('AC2.8.2 Given a plan with no items, When I save, Then validation refuses it', async () => {
    expect(await s.call('savePlan', s.admin.request, planInput([]))).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { items: ['errors.catalog.planNoItems'] } },
    });
  });

  it('AC2.8.2 Given a 0-poisha price, When I save, Then validation refuses it', async () => {
    const course = await p.published(goalId);
    expect(
      await s.call(
        'savePlan',
        s.admin.request,
        planInput([course.courseId], { monthlyPrice: '0' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { price: ['errors.catalog.priceTooLow'] } },
    });
  });

  it('AC2.8.2 / BR5.9 Given a price above the plan ceiling, When I save, Then validation refuses it', async () => {
    const course = await p.published(goalId);
    expect(
      await s.call(
        'savePlan',
        s.admin.request,
        planInput([course.courseId], { monthlyPrice: '3000.01' }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
      },
    });
  });

  it('BR10.1 Given a course of another Goal, When I add it to a plan, Then validation refuses it', async () => {
    const foreign = await p.published(otherGoalId);
    expect(await s.call('savePlan', s.admin.request, planInput([foreign.courseId]))).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { items: ['errors.catalog.planItemNotEligible'] },
      },
    });
  });

  it('AC2.8.3 (partly met, CR-6) Given a published plan, When I change its items and publish, Then a new version holds the new items, the old version keeps its items, and both are audit-logged', async () => {
    const a = await p.published(goalId);
    const b = await p.published(goalId);
    const saved = value<PlanSaved>(
      await s.call('savePlan', s.admin.request, planInput([a.courseId])),
    );
    const v1 = value<Published>(
      await s.call('publishPlan', s.admin.request, {
        planId: saved.planId,
        expectedVersion: saved.version,
      }),
    );
    const edited = value<PlanSaved>(
      await s.call(
        'savePlan',
        s.admin.request,
        planInput([a.courseId, b.courseId], {
          planId: saved.planId,
          expectedVersion: v1.version,
          nameBn: 'পরিকল্পনা',
          nameEn: 'Plan',
        }),
      ),
    );
    const v2 = value<Published>(
      await s.call('publishPlan', s.admin.request, {
        planId: saved.planId,
        expectedVersion: edited.version,
      }),
    );
    expect(v2.versionNumber).toBe(2);
    const versions = await versionRows('subscription_plan_version', 'plan_id', saved.planId);
    const itemsOf = async (planVersionId: string) =>
      (
        await s.t.pool.query<{ course_id: string }>(
          'SELECT course_id FROM subscription_plan_version_item WHERE plan_version_id = $1 ORDER BY course_id',
          [planVersionId],
        )
      ).rows.map((r) => r.course_id);
    expect(await itemsOf(versions[0]?.plan_version_id)).toEqual([a.courseId]);
    expect(await itemsOf(versions[1]?.plan_version_id)).toEqual([a.courseId, b.courseId].sort());
    const audit = await s.t.pool.query<{ action: string }>(
      `SELECT action FROM audit_log_entry WHERE subject_id = $1 AND action = 'catalog.plan.published'`,
      [saved.planId],
    );
    expect(audit.rows).toHaveLength(2);
  });

  it('BR10.11 Given I am Finance, When I save a plan, Then it is refused FORBIDDEN', async () => {
    const finance = await s.newFinance();
    expect(await s.call('savePlan', finance.request, planInput([]))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});

describe('US5.4 Create a Practice Pack', () => {
  const packInput = (courseId: string, overrides: Record<string, unknown> = {}) => ({
    courseId,
    ...buildTitle(),
    price: '১৯৯',
    questionSetIds: questions(2),
    ...overrides,
  });

  it('AC5.4.2 Given I am a Co-instructor, When I try to create a Practice Pack, Then it is refused FORBIDDEN notLead', async () => {
    const course = await p.published(goalId, { sections: 2, withCo: true });
    expect(
      await s.call('savePracticePack', course.co?.request as Request, packInput(course.courseId)),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' } });
  });

  it('BR10.9 Given my course is not published, When I create a Practice Pack, Then it is refused INVALID_STATE', async () => {
    const course = await p.draft(goalId);
    expect(
      await s.call('savePracticePack', course.lead.request, packInput(course.courseId)),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
  });

  it('AC5.4.1 (Deferred, CR-8) Given my published course and no question check registered yet, When I publish a pack, Then it saves as a draft and publish is refused INVALID_STATE questionCheckUnavailable', async () => {
    await unregisterCheck();
    const course = await p.published(goalId);
    const saved = value<PackSaved>(
      await s.call('savePracticePack', course.lead.request, packInput(course.courseId)),
    );
    expect(saved.status).toBe('draft');
    expect(
      await s.call('publishPracticePack', course.lead.request, {
        practicePackId: saved.practicePackId,
        expectedVersion: saved.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.questionCheckUnavailable' },
    });
  });

  it('AC5.4.1 Given my published course and question sets from its bank (stub check), When I create and publish a pack with a price, Then it appears on S4 as a separate item', async () => {
    const sets = questions(2);
    await registerCheck(bankWith(sets));
    const course = await p.published(goalId);
    const saved = value<PackSaved>(
      await s.call(
        'savePracticePack',
        course.lead.request,
        packInput(course.courseId, { questionSetIds: sets, price: '১৯৯.৫' }),
      ),
    );
    value(
      await s.call('publishPracticePack', course.lead.request, {
        practicePackId: saved.practicePackId,
        expectedVersion: saved.version,
      }),
    );
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const page = value<{
      practicePacks: Array<{ practicePackId: string; listPricePoisha: number }>;
    }>(await s.call('getCoursePage', student.request, { courseId: course.courseId }));
    expect(page.practicePacks).toEqual([
      expect.objectContaining({ practicePackId: saved.practicePackId, listPricePoisha: 19_950 }),
    ]);
  });

  it('BR10.9 Given a pack price above the course maximum, When I save, Then it is refused VALIDATION_FAILED priceAboveMax', async () => {
    const course = await p.published(goalId);
    expect(
      await s.call(
        'savePracticePack',
        course.lead.request,
        packInput(course.courseId, { price: '50000.01' }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
      },
    });
  });
});
