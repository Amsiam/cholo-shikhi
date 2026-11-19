// [LT] Step 24: the publish plan (BR9.2–BR9.4, BR8.12, BR4.3) and the caption confirmation (BR9.5).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkCaptionsConfirmed,
  missingPublishFields,
  type PublishCourseShape,
  type PublishSectionShape,
  planPublish,
} from './publish.ts';

const course = (over: Partial<PublishCourseShape> = {}): PublishCourseShape => ({
  status: 'draft',
  leadInstructorId: 'lead',
  listPricePoisha: 149_900,
  accessDurationMonths: 6,
  descriptionBn: 'বিবরণ',
  descriptionEn: null,
  ...over,
});

const section = (id: string, over: Partial<PublishSectionShape> = {}): PublishSectionShape => ({
  sectionId: id,
  structureState: 'active',
  isLive: false,
  isUnderTakedown: false,
  pendingPosition: null,
  position: Number(id.replace(/\D/g, '')) || 1,
  working: { state: 'approved', isComplete: true },
  ...over,
});

describe('missingPublishFields (BR9.2)', () => {
  it('names each missing field', () => {
    expect(
      missingPublishFields(
        course({
          leadInstructorId: null,
          listPricePoisha: null,
          accessDurationMonths: null,
          descriptionBn: '  ',
        }),
        [],
      ),
    ).toEqual(['leadInstructor', 'listPrice', 'accessDuration', 'description', 'sections']);
  });
  it('one description language is enough; removed sections do not count', () => {
    expect(
      missingPublishFields(course({ descriptionBn: null, descriptionEn: 'x' }), [section('s1')]),
    ).toEqual([]);
    expect(missingPublishFields(course(), [section('s1', { structureState: 'removed' })])).toEqual([
      'sections',
    ]);
  });
});

describe('planPublish', () => {
  it('a Lead first-publishes when every kept section is approved', () => {
    expect(planPublish(course(), [section('s1'), section('s2')], { isAdmin: false })).toEqual({
      ok: true,
      value: {
        isFirstPublish: true,
        publish: ['s1', 's2'],
        adminApprove: [],
        remove: [],
        leftOut: [],
        order: ['s1', 's2'],
      },
    });
  });

  it('a first publish is refused naming a section still in review (AC3.8.2)', () => {
    const result = planPublish(
      course(),
      [section('s1'), section('s2', { working: { state: 'in_review', isComplete: true } })],
      { isAdmin: false },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_STATE',
        i18nKey: 'errors.catalog.publishPreconditions',
        details: { blockingSectionIds: 's2' },
      },
    });
  });

  it('missing fields are refused as booleans in details (AC3.0.2)', () => {
    expect(
      planPublish(course({ listPricePoisha: null }), [section('s1')], { isAdmin: false }),
    ).toMatchObject({
      ok: false,
      error: { details: { 'missing.listPrice': true } },
    });
  });

  it('an Admin approves complete draft or in-review copies and is refused by an incomplete one (BR9.3)', () => {
    const sections = [
      section('s1', { working: { state: 'draft', isComplete: true } }),
      section('s2', { working: { state: 'in_review', isComplete: true } }),
      section('s3'),
    ];
    expect(planPublish(course(), sections, { isAdmin: true })).toMatchObject({
      ok: true,
      value: { publish: ['s3'], adminApprove: ['s1', 's2'] },
    });
    expect(
      planPublish(
        course(),
        [...sections, section('s4', { working: { state: 'draft', isComplete: false } })],
        { isAdmin: true },
      ),
    ).toMatchObject({ ok: false, error: { details: { blockingSectionIds: 's4' } } });
  });

  it('a republish publishes approved copies and leaves drafts out without blocking (BR9.4)', () => {
    const result = planPublish(
      course({ status: 'published' }),
      [
        section('s1', { isLive: true }),
        section('s2', { isLive: true, working: { state: 'draft', isComplete: true } }),
        section('s3', { isLive: true, working: null }),
      ],
      { isAdmin: false },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { publish: ['s1'], leftOut: ['s2'], isFirstPublish: false },
    });
  });

  it('nothing to publish on a published course is refused; an unpublished course may return as is', () => {
    const live = [section('s1', { isLive: true, working: null })];
    expect(planPublish(course({ status: 'published' }), live, { isAdmin: false })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.catalog.nothingToPublish' },
    });
    expect(planPublish(course({ status: 'unpublished' }), live, { isAdmin: false }).ok).toBe(true);
  });

  it('applies pending removals and pending positions (BR8.12, BR9.4)', () => {
    const result = planPublish(
      course({ status: 'published' }),
      [
        section('s1', { isLive: true, working: null, pendingPosition: 2 }),
        section('s2', { isLive: true, working: null, structureState: 'removal_pending' }),
        section('s3', { isLive: true, working: null, pendingPosition: 1 }),
      ],
      { isAdmin: false },
    );
    expect(result).toMatchObject({ ok: true, value: { remove: ['s2'], order: ['s3', 's1'] } });
  });

  it('refuses hidden (underTakedown), retired (invalidTransition) and content under takedown', () => {
    expect(
      planPublish(course({ status: 'hidden' }), [section('s1')], { isAdmin: true }),
    ).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.catalog.underTakedown' },
    });
    expect(
      planPublish(course({ status: 'retired' }), [section('s1')], { isAdmin: true }),
    ).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.catalog.invalidTransition' },
    });
    expect(
      planPublish(course(), [section('s1', { isUnderTakedown: true })], { isAdmin: false }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.catalog.underTakedown' } });
  });

  it('property: the final order is a permutation of the kept, non-removed sections', () => {
    const shapes = fc.array(
      fc.record({
        pending: fc.option(fc.integer({ min: 1, max: 20 }), { nil: null }),
        removal: fc.boolean(),
      }),
      { minLength: 1, maxLength: 12 },
    );
    fc.assert(
      fc.property(shapes, (rows) => {
        const sections = rows.map((r, i) =>
          section(`s${i + 1}`, {
            isLive: true,
            working: null,
            pendingPosition: r.pending,
            structureState: r.removal ? 'removal_pending' : 'active',
          }),
        );
        const result = planPublish(course({ status: 'unpublished' }), sections, { isAdmin: false });
        if (!result.ok) return false;
        const expected = sections
          .filter((s) => s.structureState === 'active')
          .map((s) => s.sectionId);
        return [...result.value.order].sort().join() === [...expected].sort().join();
      }),
      { seed: 2401, numRuns: 300 },
    );
  });
});

describe('checkCaptionsConfirmed (BR9.5)', () => {
  it('passes with no missing captions, or with exactly the missing set confirmed', () => {
    expect(checkCaptionsConfirmed([], []).ok).toBe(true);
    expect(checkCaptionsConfirmed(['a', 'b'], ['b', 'a']).ok).toBe(true);
  });
  it.each([[[]], [['a']], [['a', 'b', 'c']], [['a', 'x']]])(
    'refuses confirmation %j for missing [a, b]',
    (ack) => {
      expect(checkCaptionsConfirmed(['a', 'b'], ack)).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_STATE',
          i18nKey: 'errors.catalog.captionsNotConfirmed',
          details: { lessonIds: 'a,b', count: 2 },
        },
      });
    },
  );
});
