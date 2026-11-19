// [LT] Step 40: the product state machines, versioning and content checks (functional-spec §3.5–
// §3.7; BR10.1–BR10.5, BR10.8, BR10.9). Expected values come from rules.md. fast-check runs with a
// fixed seed: no event sequence reaches an illegal state, and a published version is never mutated.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkDistinctIds,
  checkExamPackagePublish,
  checkNotInCurrentPlan,
  checkPlanItems,
  checkProductEditable,
  decidePackAuthoring,
  decideQuestionCheck,
  marksUnpublishedChanges,
  needsNewVersion,
  nextVersionNumber,
  type ProductEvent,
  type ProductStatus,
  transitionProduct,
  validatePlanNames,
} from './products.ts';

const SEED = 20261117;
const GOAL = '0193a3b0-0000-7000-8000-000000000001';
const OTHER_GOAL = '0193a3b0-0000-7000-8000-000000000002';

const draft = {
  titleBn: 'বিসিএস মডেল টেস্ট',
  titleEn: 'BCS model test',
  goalId: GOAL,
  listPricePoisha: 49_900,
  draftQuestionIds: ['q1', 'q2'],
  draftTimeLimitMinutes: 60,
};

describe('transitionProduct (§3.5–§3.7)', () => {
  it.each([
    ['draft', 'publish', 'published'],
    ['published', 'publish', 'published'],
    ['unpublished', 'publish', 'published'],
    ['published', 'unpublish', 'unpublished'],
    ['published', 'retire', 'retired'],
    ['unpublished', 'retire', 'retired'],
  ] as const)('%s --%s--> %s', (from, event, to) => {
    expect(transitionProduct(from, event)).toEqual({ ok: true, value: to });
  });

  it.each([
    ['draft', 'unpublish'],
    ['draft', 'retire'],
    ['unpublished', 'unpublish'],
    ['retired', 'publish'],
    ['retired', 'unpublish'],
    ['retired', 'retire'],
  ] as const)('refuses %s --%s with INVALID_STATE invalidTransition', (from, event) => {
    expect(transitionProduct(from, event)).toEqual({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.invalidTransition' },
    });
  });

  it('property: no event sequence leaves the machine in an illegal state, and retired is terminal', () => {
    const events = fc.array(fc.constantFrom<ProductEvent>('publish', 'unpublish', 'retire'), {
      maxLength: 30,
    });
    fc.assert(
      fc.property(events, (sequence) => {
        let status: ProductStatus = 'draft';
        let wasRetired = false;
        for (const event of sequence) {
          const next = transitionProduct(status, event);
          if (next.ok) status = next.value;
          if (wasRetired && status !== 'retired') return false;
          if (status === 'retired') wasRetired = true;
          // Draft is reachable only as the start state.
          if (status === 'draft' && next.ok) return false;
        }
        return ['draft', 'published', 'unpublished', 'retired'].includes(status);
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it('refuses edits of a retired product only', () => {
    expect(checkProductEditable('retired').ok).toBe(false);
    for (const status of ['draft', 'published', 'unpublished'] as const)
      expect(checkProductEditable(status).ok).toBe(true);
  });
});

describe('versions (BR10.3, BR10.6)', () => {
  it('creates a version on the first publish and on a publish of saved changes only', () => {
    expect(needsNewVersion({ currentVersionId: null, hasUnpublishedChanges: false })).toBe(true);
    expect(needsNewVersion({ currentVersionId: 'v1', hasUnpublishedChanges: true })).toBe(true);
    expect(needsNewVersion({ currentVersionId: 'v1', hasUnpublishedChanges: false })).toBe(false);
  });

  it('numbers versions from 1 upwards', () => {
    expect(nextVersionNumber(null)).toBe(1);
    expect(nextVersionNumber(1)).toBe(2);
    expect(nextVersionNumber(41)).toBe(42);
  });

  it('marks unpublished changes only for a versioned product whose contents changed', () => {
    expect(marksUnpublishedChanges('draft', [['a'], 60], [['b'], 60])).toBe(false);
    expect(marksUnpublishedChanges('published', [['a'], 60], [['a'], 60])).toBe(false);
    expect(marksUnpublishedChanges('published', [['a'], 60], [['a', 'b'], 60])).toBe(true);
    expect(marksUnpublishedChanges('unpublished', [['a'], 60], [['a'], 90])).toBe(true);
  });

  it('property: over any sequence of edits and publishes, every published version keeps its contents', () => {
    type Step = { kind: 'edit'; questions: string[] } | { kind: 'publish' };
    const step = fc.oneof(
      fc.record({
        kind: fc.constant('edit' as const),
        questions: fc.array(fc.string({ minLength: 1, maxLength: 3 }), {
          minLength: 1,
          maxLength: 4,
        }),
      }),
      fc.record({ kind: fc.constant('publish' as const) }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 25 }), (steps: Step[]) => {
        const versions: Array<{ number: number; questions: readonly string[] }> = [];
        const snapshots: string[] = [];
        let status: ProductStatus = 'draft';
        let current: string | null = null;
        let pending = false;
        let questions: string[] = ['q0'];
        for (const s of steps) {
          if (s.kind === 'edit') {
            pending = pending || marksUnpublishedChanges(status, questions, s.questions);
            questions = s.questions;
            continue;
          }
          const next = transitionProduct(status, 'publish');
          if (!next.ok) return false;
          if (needsNewVersion({ currentVersionId: current, hasUnpublishedChanges: pending })) {
            const number = nextVersionNumber(versions.at(-1)?.number ?? null);
            const version = Object.freeze({ number, questions: Object.freeze([...questions]) });
            versions.push(version);
            snapshots.push(JSON.stringify(version));
            current = `v${number}`;
          }
          pending = false;
          status = next.value;
        }
        return versions.every((v, i) => JSON.stringify(v) === snapshots[i] && v.number === i + 1);
      }),
      { seed: SEED, numRuns: 1000 },
    );
  });
});

describe('checkExamPackagePublish (BR10.2)', () => {
  it('passes a complete package and returns the version contents', () => {
    expect(checkExamPackagePublish(draft)).toEqual({
      ok: true,
      value: { questionIds: ['q1', 'q2'], timeLimitMinutes: 60 },
    });
  });

  it('refuses no questions with examPackageIncomplete on questionIds', () => {
    expect(checkExamPackagePublish({ ...draft, draftQuestionIds: [] })).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.catalog.examPackageIncomplete',
        fieldErrors: { questionIds: ['errors.catalog.examPackageIncomplete'] },
      },
    });
  });

  it.each([null, 0, 601])('refuses the time limit %s', (limit) => {
    expect(checkExamPackagePublish({ ...draft, draftTimeLimitMinutes: limit })).toMatchObject({
      ok: false,
      error: { fieldErrors: { timeLimitMinutes: ['errors.catalog.examPackageIncomplete'] } },
    });
  });

  it('accepts the time limit bounds 1 and 600', () => {
    expect(checkExamPackagePublish({ ...draft, draftTimeLimitMinutes: 1 }).ok).toBe(true);
    expect(checkExamPackagePublish({ ...draft, draftTimeLimitMinutes: 600 }).ok).toBe(true);
  });

  it('refuses a missing title, Goal or price with the generic validation key', () => {
    const result = checkExamPackagePublish({
      ...draft,
      titleBn: ' ',
      titleEn: '',
      goalId: null,
      listPricePoisha: null,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: {
          titleBn: ['errors.catalog.titleRequired'],
          titleEn: ['errors.catalog.titleRequired'],
          goalId: ['errors.catalog.goalRequired'],
          price: ['errors.catalog.priceRequired'],
        },
      },
    });
  });
});

describe('checkPlanItems (BR10.1, BR10.5)', () => {
  const course = { type: 'course' as const, id: 'c1' };
  const exam = { type: 'exam_package' as const, id: 'e1' };
  const known = [
    { ...course, goalId: GOAL, status: 'published' },
    { ...exam, goalId: GOAL, status: 'draft' },
    { type: 'course' as const, id: 'c2', goalId: OTHER_GOAL, status: 'published' },
  ];

  it('refuses an empty plan with planNoItems', () => {
    expect(checkPlanItems(GOAL, [], known, false)).toMatchObject({
      ok: false,
      error: { fieldErrors: { items: ['errors.catalog.planNoItems'] } },
    });
  });

  it('accepts items of the plan Goal on save, even before they are published', () => {
    expect(checkPlanItems(GOAL, [course, exam], known, false)).toEqual({
      ok: true,
      value: [course, exam],
    });
  });

  it('refuses an item of another Goal or an unknown item, naming it', () => {
    const result = checkPlanItems(
      GOAL,
      [course, { type: 'course', id: 'c2' }, { type: 'course', id: 'missing' }],
      known,
      false,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        fieldErrors: { items: ['errors.catalog.planItemNotEligible'] },
        details: { itemIds: 'c2,missing' },
      },
    });
  });

  it('refuses an unpublished item at publish (BR10.5)', () => {
    expect(checkPlanItems(GOAL, [course, exam], known, true)).toMatchObject({
      ok: false,
      error: { details: { itemIds: 'e1' } },
    });
  });

  it('does not confuse a course and an exam package with the same ID', () => {
    expect(checkPlanItems(GOAL, [{ type: 'exam_package', id: 'c1' }], known, false).ok).toBe(false);
  });
});

describe('the other product rules', () => {
  it('BR10.8 refuses an item in a current plan with CONFLICT inCurrentPlan and the plan IDs', () => {
    expect(checkNotInCurrentPlan([])).toEqual({ ok: true, value: undefined });
    expect(checkNotInCurrentPlan(['p2', 'p1'])).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        i18nKey: 'errors.catalog.inCurrentPlan',
        details: { planIds: 'p1,p2' },
      },
    });
  });

  it('BR10.9 lets only the Lead of a published course author a pack', () => {
    expect(decidePackAuthoring('lead', 'published').ok).toBe(true);
    expect(decidePackAuthoring('co_instructor', 'published')).toMatchObject({
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
    expect(decidePackAuthoring(null, 'published')).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(decidePackAuthoring('admin', 'published')).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    for (const status of ['draft', 'unpublished', 'retired', 'hidden'])
      expect(decidePackAuthoring('lead', status)).toMatchObject({
        error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.courseNotPublished' },
      });
  });

  it('BR10.4 maps the question check outcome', () => {
    expect(decideQuestionCheck('unavailable', 'questionIds')).toEqual({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.questionCheckUnavailable' },
    });
    expect(decideQuestionCheck({ valid: true }, 'questionIds')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      decideQuestionCheck({ valid: false, unknownIds: ['a', 'b'] }, 'questionSetIds'),
    ).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { questionSetIds: ['errors.catalog.unknownQuestionSets'] },
        details: { unknownIds: 'a,b' },
      },
    });
    expect(decideQuestionCheck({ valid: false, unknownIds: ['x'] }, 'questionIds')).toMatchObject({
      error: { fieldErrors: { questionIds: ['errors.catalog.unknownQuestions'] } },
    });
  });

  it('BR3.1 needs both plan names, at most 100 characters each', () => {
    expect(validatePlanNames({ nameBn: ' প্ল্যান ', nameEn: 'Plan' })).toEqual({
      ok: true,
      value: { nameBn: 'প্ল্যান', nameEn: 'Plan' },
    });
    expect(validatePlanNames({ nameBn: '', nameEn: 'x'.repeat(101) })).toMatchObject({
      error: {
        fieldErrors: {
          nameBn: ['errors.catalog.titleRequired'],
          nameEn: ['errors.catalog.titleTooLong'],
        },
      },
    });
  });

  it('refuses repeated IDs rather than dropping them', () => {
    expect(checkDistinctIds(['a', 'b'], 'questionIds')).toEqual({ ok: true, value: ['a', 'b'] });
    expect(checkDistinctIds(['a', 'a'], 'questionIds')).toMatchObject({
      error: { fieldErrors: { questionIds: ['errors.catalog.duplicateIds'] } },
    });
  });
});
