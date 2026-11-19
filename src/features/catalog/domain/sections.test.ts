// [LT] Step 15: section structure (BR8.10–BR8.12; functional-spec §3.8). fast-check: no event
// sequence reaches an illegal structure state, and every reorder or removal keeps positions 1..n.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkSectionWritable,
  planAddSection,
  planRemoval,
  planReorder,
  type SectionShape,
  type StructureEvent,
  type StructureState,
  transitionSection,
} from './sections.ts';

function shape(id: string, position: number, overrides: Partial<SectionShape> = {}): SectionShape {
  return {
    sectionId: id,
    position,
    pendingPosition: null,
    structureState: 'active',
    isLive: false,
    isUnderTakedown: false,
    ...overrides,
  };
}

const three = [shape('a', 1), shape('b', 2), shape('c', 3)];

describe('transitionSection (§3.8)', () => {
  it.each([
    ['active', 'remove', false, 'removed'],
    ['active', 'remove', true, 'removal_pending'],
    ['removal_pending', 'cancelRemoval', true, 'active'],
    ['removal_pending', 'publishRemoval', true, 'removed'],
  ] as const)('%s --%s (live=%s)--> %s', (from, event, isLive, to) => {
    expect(transitionSection(from, event, isLive)).toEqual({ ok: true, value: to });
  });

  it.each([
    ['active', 'cancelRemoval', 'errors.catalog.sectionNotPendingRemoval'],
    ['active', 'publishRemoval', 'errors.catalog.sectionNotPendingRemoval'],
    ['removal_pending', 'remove', 'errors.catalog.sectionRemovalPending'],
    ['removed', 'remove', 'errors.catalog.sectionRemoved'],
    ['removed', 'cancelRemoval', 'errors.catalog.sectionRemoved'],
  ] as const)('refuses %s --%s--> with %s', (from, event, key) => {
    expect(transitionSection(from, event, true)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: key },
    });
  });

  it('only an active section takes content, review and ownership writes (BR8.12)', () => {
    expect(checkSectionWritable('active').ok).toBe(true);
    expect(checkSectionWritable('removal_pending')).toMatchObject({
      error: { i18nKey: 'errors.catalog.sectionRemovalPending' },
    });
    expect(checkSectionWritable('removed')).toMatchObject({
      error: { i18nKey: 'errors.catalog.sectionRemoved' },
    });
  });

  it('property: removed is terminal and every state reached is legal', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom<StructureEvent>('remove', 'cancelRemoval', 'publishRemoval'),
            fc.boolean(),
          ),
          { maxLength: 30 },
        ),
        (events) => {
          let state: StructureState = 'active';
          for (const [event, isLive] of events) {
            const next = transitionSection(state, event, isLive);
            if (state === 'removed' && next.ok) return false;
            if (next.ok) state = next.value;
          }
          return ['active', 'removal_pending', 'removed'].includes(state);
        },
      ),
      { seed: 61116, numRuns: 500 },
    );
  });
});

describe('planAddSection (BR8.10)', () => {
  it('appends last among sections that are not removed', () => {
    expect(planAddSection([])).toEqual({ position: 1, pendingPosition: null });
    expect(planAddSection([...three, shape('x', 4, { structureState: 'removed' })])).toEqual({
      position: 4,
      pendingPosition: null,
    });
  });

  it('also appends to a held pending order', () => {
    const pending = three.map((s, i) => ({ ...s, pendingPosition: 3 - i }));
    expect(planAddSection(pending)).toEqual({ position: 4, pendingPosition: 4 });
  });
});

describe('planReorder (BR8.11)', () => {
  it('applies the order at once on a never-published course', () => {
    expect(planReorder(three, ['c', 'a', 'b'], false)).toEqual({
      ok: true,
      value: [
        { sectionId: 'c', position: 1, pendingPosition: null },
        { sectionId: 'a', position: 2, pendingPosition: null },
        { sectionId: 'b', position: 3, pendingPosition: null },
      ],
    });
  });

  it('holds the order as pendingPosition on a published course and keeps the live positions', () => {
    expect(planReorder(three, ['c', 'a', 'b'], true)).toEqual({
      ok: true,
      value: [
        { sectionId: 'c', position: 3, pendingPosition: 1 },
        { sectionId: 'a', position: 1, pendingPosition: 2 },
        { sectionId: 'b', position: 2, pendingPosition: 3 },
      ],
    });
  });

  it.each([[['a', 'b']], [['a', 'b', 'c', 'd']], [['a', 'a', 'b']], [['a', 'b', 'x']]])(
    'refuses %j, which is not a permutation of the sections',
    (order) => {
      expect(planReorder(three, order, false)).toMatchObject({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          fieldErrors: { sectionIds: ['errors.catalog.reorderNotPermutation'] },
        },
      });
    },
  );

  it('includes removal_pending sections and excludes removed ones', () => {
    const mixed = [
      shape('a', 1, { structureState: 'removal_pending', isLive: true }),
      shape('b', 2),
      shape('z', 3, { structureState: 'removed' }),
    ];
    expect(planReorder(mixed, ['b', 'a'], true).ok).toBe(true);
    expect(planReorder(mixed, ['b', 'a', 'z'], true).ok).toBe(false);
  });

  it('property: any permutation yields positions or pending positions 1..n', () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(['a', 'b', 'c', 'd', 'e'], { minLength: 5, maxLength: 5 }),
        fc.boolean(),
        (order, published) => {
          const sections = ['a', 'b', 'c', 'd', 'e'].map((id, i) => shape(id, i + 1));
          const plan = planReorder(sections, order, published);
          if (!plan.ok) return false;
          const field = plan.value.map((c) => (published ? c.pendingPosition : c.position));
          return JSON.stringify([...field].sort()) === JSON.stringify([1, 2, 3, 4, 5]);
        },
      ),
      { seed: 61116, numRuns: 300 },
    );
  });
});

describe('planRemoval (BR8.12)', () => {
  it('case A: removes a never-live section at once and renumbers the rest', () => {
    expect(planRemoval(three, 'a', false)).toEqual({
      ok: true,
      value: {
        kind: 'removeNow',
        renumber: [
          { sectionId: 'b', position: 1, pendingPosition: null },
          { sectionId: 'c', position: 2, pendingPosition: null },
        ],
      },
    });
  });

  it('case A also renumbers a held pending order', () => {
    const pending = [
      shape('a', 1, { pendingPosition: 3 }),
      shape('b', 2, { pendingPosition: 1 }),
      shape('c', 3, { pendingPosition: 2 }),
    ];
    const plan = planRemoval(pending, 'b', true);
    expect(plan).toEqual({
      ok: true,
      value: {
        kind: 'removeNow',
        renumber: [
          { sectionId: 'a', position: 1, pendingPosition: 2 },
          { sectionId: 'c', position: 2, pendingPosition: 1 },
        ],
      },
    });
  });

  it('case B: marks a live section removal_pending', () => {
    const live = [shape('a', 1, { isLive: true }), shape('b', 2, { isLive: true })];
    expect(planRemoval(live, 'a', true)).toEqual({ ok: true, value: { kind: 'markPending' } });
  });

  it('refuses the last active section of a published course', () => {
    const live = [
      shape('a', 1, { isLive: true }),
      shape('b', 2, { isLive: true, structureState: 'removal_pending' }),
    ];
    expect(planRemoval(live, 'a', true)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.lastSection' },
    });
    // A never-published course may remove its last section.
    expect(planRemoval([shape('a', 1)], 'a', false).ok).toBe(true);
  });

  it('refuses a section under takedown, a pending one and an unknown or removed one', () => {
    expect(
      planRemoval([shape('a', 1, { isUnderTakedown: true }), shape('b', 2)], 'a', false),
    ).toMatchObject({
      error: { i18nKey: 'errors.catalog.underTakedown' },
    });
    expect(
      planRemoval(
        [shape('a', 1, { structureState: 'removal_pending', isLive: true }), shape('b', 2)],
        'a',
        true,
      ),
    ).toMatchObject({
      error: { i18nKey: 'errors.catalog.sectionRemovalPending' },
    });
    expect(planRemoval(three, 'nope', false)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(planRemoval([shape('z', 1, { structureState: 'removed' })], 'z', false)).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('property: removing any never-live section leaves positions 1..n-1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.nat(), (n, pick) => {
        const sections = Array.from({ length: n }, (_, i) => shape(`s${i}`, i + 1));
        const target = `s${pick % n}`;
        const plan = planRemoval(sections, target, false);
        if (!plan.ok || plan.value.kind !== 'removeNow') return false;
        return (
          plan.value.renumber.map((c) => c.position).join(',') ===
          Array.from({ length: n - 1 }, (_, i) => i + 1).join(',')
        );
      }),
      { seed: 61116, numRuns: 300 },
    );
  });
});
