// [LT] Step 22: lesson titles, kinds, completeness (BR7.3), reorder (BR7.2), removal (BR7.4) and the
// U4 media push plan (BR7.6).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LessonDocument } from './lesson-document.ts';
import {
  checkSectionComplete,
  checkTextLesson,
  isLessonComplete,
  type LessonContent,
  planLessonReorder,
  planMediaPush,
  removalOf,
  renumberAfterRemoval,
  validateLessonTitles,
} from './lessons.ts';

const body = (text: string) =>
  ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }) as LessonDocument;

const lesson = (over: Partial<LessonContent> = {}): LessonContent => ({
  lessonId: 'l1',
  kind: 'text',
  titleBn: 'শিরোনাম',
  titleEn: null,
  bodyBn: body('x'),
  bodyEn: null,
  videoAssetId: null,
  mediaStatus: 'none',
  quizQuestionCount: 0,
  youtubeVideoId: null,
  ...over,
});

describe('validateLessonTitles (BR3.2)', () => {
  it('accepts one language and stores the other as null', () => {
    expect(validateLessonTitles({ titleBn: ' ক ', titleEn: '' })).toEqual({
      ok: true,
      value: { titleBn: 'ক', titleEn: null },
    });
  });
  it('refuses both empty with lessonTitleRequired', () => {
    expect(validateLessonTitles({ titleBn: ' ', titleEn: '' })).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { titleBn: ['errors.catalog.lessonTitleRequired'] },
      },
    });
  });
  it('refuses 151 characters in either language', () => {
    const long = 'a'.repeat(151);
    expect(validateLessonTitles({ titleBn: long, titleEn: long })).toMatchObject({
      ok: false,
      error: {
        fieldErrors: {
          titleBn: ['errors.catalog.titleTooLong'],
          titleEn: ['errors.catalog.titleTooLong'],
        },
      },
    });
    expect(validateLessonTitles({ titleBn: 'a'.repeat(150), titleEn: '' }).ok).toBe(true);
  });
});

describe('checkTextLesson (BR7.1)', () => {
  it('accepts a body only on a text lesson', () => {
    expect(checkTextLesson('text').ok).toBe(true);
    expect(checkTextLesson('video')).toMatchObject({
      ok: false,
      error: { fieldErrors: { body: ['errors.catalog.lessonKindMismatch'] } },
    });
  });
});

describe('isLessonComplete (BR7.3)', () => {
  it.each([
    ['text with a body', lesson(), true],
    ['text with a body in English only', lesson({ bodyBn: null, bodyEn: body('y') }), true],
    ['text with only blank bodies', lesson({ bodyBn: body('  ') }), false],
    ['text with no body', lesson({ bodyBn: null }), false],
    ['no title at all', lesson({ titleBn: ' ', titleEn: null }), false],
    ['video ready', lesson({ kind: 'video', videoAssetId: 'a', mediaStatus: 'ready' }), true],
    [
      'video processing',
      lesson({ kind: 'video', videoAssetId: 'a', mediaStatus: 'processing' }),
      false,
    ],
    ['video failed', lesson({ kind: 'video', videoAssetId: 'a', mediaStatus: 'failed' }), false],
    ['video without an asset', lesson({ kind: 'video', mediaStatus: 'ready' }), false],
    ['quiz with questions', lesson({ kind: 'quiz', quizQuestionCount: 3 }), true],
    ['quiz without questions', lesson({ kind: 'quiz', quizQuestionCount: 0 }), false],
  ])('%s → %s', (_n, l, expected) => {
    expect(isLessonComplete(l)).toBe(expected);
  });
});

describe('checkSectionComplete (BR7.3)', () => {
  it('passes when every lesson is complete', () => {
    expect(checkSectionComplete([lesson(), lesson({ lessonId: 'l2' })]).ok).toBe(true);
  });
  it('refuses an empty section', () => {
    expect(checkSectionComplete([])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.incompleteLessons' },
    });
  });
  it('lists every incomplete lesson ID in details', () => {
    const result = checkSectionComplete([
      lesson(),
      lesson({ lessonId: 'v', kind: 'video' }),
      lesson({ lessonId: 'q', kind: 'quiz' }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: { details: { incompleteLessonIds: 'v,q', lessonCount: 3 } },
    });
  });
});

describe('planLessonReorder (BR7.2)', () => {
  it('assigns positions 1..n in the given order', () => {
    expect(planLessonReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({
      ok: true,
      value: [
        { lessonId: 'c', position: 1 },
        { lessonId: 'a', position: 2 },
        { lessonId: 'b', position: 3 },
      ],
    });
  });
  it.each([[['a', 'b']], [['a', 'b', 'b']], [['a', 'b', 'x']], [['a', 'b', 'c', 'd']]])(
    'refuses %j, which is not a permutation',
    (requested) => {
      expect(planLessonReorder(['a', 'b', 'c'], requested)).toMatchObject({
        ok: false,
        error: { fieldErrors: { lessonIds: ['errors.catalog.reorderNotPermutation'] } },
      });
    },
  );
  it('property: any permutation is accepted and positions are contiguous', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 }),
        fc.nat(),
        (ids, seed) => {
          const shuffled = [...ids].sort(
            (a, b) =>
              a.charCodeAt(seed % a.length) - b.charCodeAt(seed % b.length) || a.localeCompare(b),
          );
          const plan = planLessonReorder(ids, shuffled);
          return (
            plan.ok &&
            plan.value.every((p, i) => p.position === i + 1 && p.lessonId === shuffled[i])
          );
        },
      ),
      { seed: 2201, numRuns: 200 },
    );
  });
});

describe('removal (BR7.4)', () => {
  it('deletes a never-published lesson in no other version; otherwise only unlinks it', () => {
    expect(removalOf({ liveState: 'never_published', otherVersionCount: 0 })).toBe('delete');
    expect(removalOf({ liveState: 'never_published', otherVersionCount: 1 })).toBe('unlink');
    expect(removalOf({ liveState: 'live', otherVersionCount: 1 })).toBe('unlink');
    expect(removalOf({ liveState: 'withdrawn', otherVersionCount: 0 })).toBe('unlink');
  });
  it('renumbers the rest 1..n keeping their order', () => {
    expect(renumberAfterRemoval(['a', 'b', 'c'], 'b')).toEqual([
      { lessonId: 'a', position: 1 },
      { lessonId: 'c', position: 2 },
    ]);
  });
});

describe('planMediaPush (BR7.6)', () => {
  const working = (state: string, asset: string | null) => ({
    lessonVersionId: 'w',
    role: 'working' as const,
    reviewState: state,
    videoAssetId: asset,
  });
  const live = (asset: string | null) => ({
    lessonVersionId: 'lv',
    role: 'live' as const,
    reviewState: 'published',
    videoAssetId: asset,
  });

  it('binds a new asset to a draft working copy', () => {
    expect(planMediaPush('video', [working('draft', null)], 'A')).toEqual({
      ok: true,
      value: { bindTo: 'w', statusOn: ['w'] },
    });
  });
  it('refuses a new asset on a working copy that is not draft', () => {
    expect(planMediaPush('video', [working('in_review', null)], 'A').ok).toBe(false);
  });
  it('updates status on the working copy (any state) and the live version holding the same asset', () => {
    expect(planMediaPush('video', [working('approved', 'A'), live('A')], 'A')).toEqual({
      ok: true,
      value: { bindTo: null, statusOn: ['w', 'lv'] },
    });
  });
  it('updates the live version alone when there is no working copy', () => {
    expect(planMediaPush('video', [live('A')], 'A')).toEqual({
      ok: true,
      value: { bindTo: null, statusOn: ['lv'] },
    });
  });
  it('refuses an asset no version holds, and any non-video lesson', () => {
    expect(planMediaPush('video', [live('A')], 'B')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.mediaNotAccepted' },
    });
    expect(planMediaPush('text', [working('draft', null)], 'A').ok).toBe(false);
  });
});
