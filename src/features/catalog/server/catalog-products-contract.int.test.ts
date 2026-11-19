// [LT] Step 42: contract 5 product reads on a real PostgreSQL schema: getProductTerms for exam
// packages, Practice Packs and plans (BR13.1), getExamPackage (BR13.7) under the CR-6 fallback (the
// current shape only), the CR-5 fallback (unpublished reported as retired), and that none of the new
// exports is reachable over HTTP (NFR6.201).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as catalog from '#src/features/catalog/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  allServerFns,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';
import { resetQuestionReferenceCheckForTests } from './question-check.server.ts';

type Saved = { version: number; status: string };

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
  catalog.registerQuestionReferenceCheck(async () => ({ valid: true }));
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'catalog.unpublish',
      description: 'LT: unpublish on',
      state: 'on',
    }),
  );
});
afterAll(async () => {
  resetQuestionReferenceCheckForTests();
  await s?.close();
});

const saveExam = async () =>
  value<Saved & { examPackageId: string }>(
    await s.call('saveExamPackage', s.admin.request, {
      goalId,
      ...buildTitle(),
      price: '৪৯৯.৫০',
      questionIds: [randomUUID()],
      timeLimitMinutes: 40,
    }),
  );

describe('getProductTerms (BR13.1)', () => {
  it('exam package: Goal, poisha price, no access duration, status, no included items', async () => {
    const saved = await saveExam();
    expect(
      await catalog.getProductTerms({ type: 'exam_package', id: saved.examPackageId }),
    ).toEqual({
      ok: true,
      value: {
        product: { type: 'exam_package', id: saved.examPackageId },
        goalId,
        listPrice: 49_950,
        accessDurationMonths: null,
        status: 'draft',
        includedCourseIds: [],
        includedExamPackageIds: [],
      },
    });
  });

  it('CR-5 fallback: an unpublished exam package is reported as retired', async () => {
    const saved = await saveExam();
    const pub = value<Saved>(
      await s.call('publishExamPackage', s.admin.request, {
        examPackageId: saved.examPackageId,
        expectedVersion: saved.version,
      }),
    );
    value(
      await s.call('unpublishExamPackage', s.admin.request, {
        examPackageId: saved.examPackageId,
        expectedVersion: pub.version,
      }),
    );
    expect(
      await catalog.getProductTerms({ type: 'exam_package', id: saved.examPackageId }),
    ).toMatchObject({ ok: true, value: { status: 'retired' } });
  });

  it('plan before its first publish: the draft price and items, one paid period', async () => {
    const a = await p.published(goalId);
    const title = buildTitle();
    const saved = value<Saved & { planId: string }>(
      await s.call('savePlan', s.admin.request, {
        goalId,
        nameBn: title.titleBn,
        nameEn: title.titleEn,
        monthlyPrice: '২৯৯',
        courseIds: [a.courseId],
        examPackageIds: [],
      }),
    );
    expect(
      await catalog.getProductTerms({ type: 'subscription_plan', id: saved.planId }),
    ).toMatchObject({
      ok: true,
      value: {
        listPrice: 29_900,
        accessDurationMonths: 1,
        status: 'draft',
        includedCourseIds: [a.courseId],
        includedExamPackageIds: [],
      },
    });
  });

  it('published plan: the current version, never the unpublished draft edits', async () => {
    const a = await p.published(goalId);
    const b = await p.published(goalId);
    const title = buildTitle();
    const base = { goalId, nameBn: title.titleBn, nameEn: title.titleEn, examPackageIds: [] };
    const saved = value<Saved & { planId: string }>(
      await s.call('savePlan', s.admin.request, {
        ...base,
        monthlyPrice: '২৯৯',
        courseIds: [a.courseId],
      }),
    );
    const pub = value<Saved>(
      await s.call('publishPlan', s.admin.request, {
        planId: saved.planId,
        expectedVersion: saved.version,
      }),
    );
    value(
      await s.call('savePlan', s.admin.request, {
        ...base,
        planId: saved.planId,
        expectedVersion: pub.version,
        monthlyPrice: '১৯৯',
        courseIds: [a.courseId, b.courseId],
      }),
    );
    expect(
      await catalog.getProductTerms({ type: 'subscription_plan', id: saved.planId }),
    ).toMatchObject({
      ok: true,
      value: { listPrice: 29_900, status: 'published', includedCourseIds: [a.courseId] },
    });
  });

  it('Practice Pack: its course Goal, no access duration, and hidden while its course is hidden', async () => {
    const course = await p.published(goalId);
    const pack = value<Saved & { practicePackId: string }>(
      await s.call('savePracticePack', course.lead.request, {
        courseId: course.courseId,
        ...buildTitle(),
        price: '১৯৯',
        questionSetIds: [randomUUID()],
      }),
    );
    const ref = { type: 'practice_pack' as const, id: pack.practicePackId };
    expect(await catalog.getProductTerms(ref)).toMatchObject({
      ok: true,
      value: { goalId, listPrice: 19_900, accessDurationMonths: null, status: 'draft' },
    });
    value(
      await withTransaction(getDb(), (tx) =>
        catalog.hideContent(tx, {
          contentRef: { type: 'course', id: course.courseId },
          takedownNoticeId: randomUUID(),
        }),
      ),
    );
    expect(await catalog.getProductTerms(ref)).toMatchObject({
      ok: true,
      value: { status: 'hidden' },
    });
  });

  it('answers NOT_FOUND for an unknown ID of every product type and a malformed ID', async () => {
    for (const type of ['exam_package', 'practice_pack', 'subscription_plan'] as const) {
      expect(await catalog.getProductTerms({ type, id: randomUUID() })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(await catalog.getProductTerms({ type: 'exam_package', id: 'nope' })).toMatchObject({
      ok: false,
    });
  });

  it('CR-6 fallback: terms carry no versionId or parentCourseId', async () => {
    const saved = await saveExam();
    const terms = await catalog.getProductTerms({ type: 'exam_package', id: saved.examPackageId });
    expect(terms.ok && Object.keys(terms.value).sort()).toEqual([
      'accessDurationMonths',
      'goalId',
      'includedCourseIds',
      'includedExamPackageIds',
      'listPrice',
      'product',
      'status',
    ]);
  });
});

describe('getExamPackage (BR13.7, CR-6 fallback)', () => {
  it('returns only the ID, the Goal and the status, never the draft fields', async () => {
    const saved = await saveExam();
    expect(await catalog.getExamPackage(saved.examPackageId)).toEqual({
      ok: true,
      value: { examPackageId: saved.examPackageId, goalId, status: 'draft' },
    });
  });

  it('answers NOT_FOUND for an unknown or malformed ID', async () => {
    expect(await catalog.getExamPackage(randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await catalog.getExamPackage('x')).toMatchObject({ ok: false });
  });
});

describe('the new contract 5 exports are never reachable over HTTP (NFR6.201)', () => {
  it.each(['getExamPackage', 'registerQuestionReferenceCheck'])(
    '%s is a plain in-process function, not a server function',
    (name) => {
      const fn = (catalog as Record<string, unknown>)[name];
      expect(typeof fn).toBe('function');
      expect(fn).not.toHaveProperty('serverFnAccess');
      expect(Object.keys(allServerFns())).not.toContain(name);
    },
  );
});
