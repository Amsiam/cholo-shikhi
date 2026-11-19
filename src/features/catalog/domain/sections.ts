// Section structure (rules.md BR8.10–BR8.12; functional-spec §3.8): add, reorder and remove
// sections, and the structure state machine. Plain TypeScript: the server applies the plan this
// module returns inside one transaction.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { invalidState, notFound, validationFailed } from './course.ts';

export type StructureState = 'active' | 'removal_pending' | 'removed';
export type StructureEvent = 'remove' | 'cancelRemoval' | 'publishRemoval';

export type SectionShape = {
  sectionId: string;
  position: number;
  pendingPosition: number | null;
  structureState: StructureState;
  isLive: boolean;
  isUnderTakedown: boolean;
};

/** §3.8: the next structure state, or INVALID_STATE. `isLive` = the section has a live version. */
export function transitionSection(
  state: StructureState,
  event: StructureEvent,
  isLive: boolean,
): Result<StructureState, AppError<'INVALID_STATE'>> {
  if (event === 'remove' && state === 'active') return ok(isLive ? 'removal_pending' : 'removed');
  if (event === 'cancelRemoval' && state === 'removal_pending') return ok('active');
  if (event === 'publishRemoval' && state === 'removal_pending') return ok('removed');
  if (state === 'removal_pending') return err(invalidState('sectionRemovalPending'));
  if (state === 'removed') return err(invalidState('sectionRemoved'));
  return err(invalidState('sectionNotPendingRemoval'));
}

/** BR8.12: content edits, review transitions and ownership changes need an active section. */
export function checkSectionWritable(
  state: StructureState,
): Result<void, AppError<'INVALID_STATE'>> {
  if (state === 'removal_pending') return err(invalidState('sectionRemovalPending'));
  if (state === 'removed') return err(invalidState('sectionRemoved'));
  return ok(undefined);
}

const notRemoved = (s: SectionShape) => s.structureState !== 'removed';

/**
 * BR8.10: a new section goes last among the sections that are not removed. While a held reorder
 * is waiting for the next publish, the new section is also appended to that pending order.
 */
export function planAddSection(sections: readonly SectionShape[]): {
  position: number;
  pendingPosition: number | null;
} {
  const kept = sections.filter(notRemoved);
  const pending = kept.flatMap((s) => (s.pendingPosition === null ? [] : [s.pendingPosition]));
  return {
    position: kept.length + 1,
    pendingPosition: pending.length > 0 ? Math.max(...pending) + 1 : null,
  };
}

export type PositionChange = {
  sectionId: string;
  position: number;
  pendingPosition: number | null;
};

/**
 * BR8.11: the request must be a permutation of every section that is not removed. A course that
 * was never published takes the order at once; a published one holds it as pendingPosition.
 */
export function planReorder(
  sections: readonly SectionShape[],
  requested: readonly string[],
  isEverPublished: boolean,
): Result<PositionChange[], AppError<'VALIDATION_FAILED'>> {
  const kept = sections.filter(notRemoved);
  const byId = new Map(kept.map((s) => [s.sectionId, s]));
  const isPermutation =
    requested.length === kept.length &&
    new Set(requested).size === requested.length &&
    requested.every((id) => byId.has(id));
  if (!isPermutation) {
    return err(validationFailed({ sectionIds: ['errors.catalog.reorderNotPermutation'] }));
  }
  return ok(
    requested.map((sectionId, index) => {
      const current = byId.get(sectionId) as SectionShape;
      return isEverPublished
        ? { sectionId, position: current.position, pendingPosition: index + 1 }
        : { sectionId, position: index + 1, pendingPosition: null };
    }),
  );
}

export type RemovalPlan =
  | { kind: 'removeNow'; renumber: PositionChange[] }
  | { kind: 'markPending' };

/** Positions (and pending positions, if any) renumbered 1..n in their current order. */
function renumber(sections: readonly SectionShape[]): PositionChange[] {
  const byPosition = [...sections].sort((a, b) => a.position - b.position);
  const hasPending = sections.some((s) => s.pendingPosition !== null);
  const byPending = [...sections].sort(
    (a, b) => (a.pendingPosition ?? a.position) - (b.pendingPosition ?? b.position),
  );
  const pendingIndex = new Map(byPending.map((s, i) => [s.sectionId, i + 1]));
  return byPosition.map((s, i) => ({
    sectionId: s.sectionId,
    position: i + 1,
    pendingPosition: hasPending ? (pendingIndex.get(s.sectionId) as number) : null,
  }));
}

/**
 * BR8.12: removing a never-live section takes effect now and renumbers the rest (case A); a live
 * section becomes removal_pending until the next publish (case B). A published course always
 * keeps at least one active section, and a section under takedown cannot be removed.
 */
export function planRemoval(
  sections: readonly SectionShape[],
  sectionId: string,
  isEverPublished: boolean,
): Result<RemovalPlan, AppError<'NOT_FOUND' | 'INVALID_STATE'>> {
  const target = sections.find((s) => s.sectionId === sectionId);
  if (!target || target.structureState === 'removed') return err(notFound());
  if (target.isUnderTakedown) return err(invalidState('underTakedown'));
  const next = transitionSection(target.structureState, 'remove', target.isLive);
  if (!next.ok) return next;
  const othersActive = sections.filter(
    (s) => s.sectionId !== sectionId && s.structureState === 'active',
  );
  if (isEverPublished && othersActive.length === 0) return err(invalidState('lastSection'));
  if (next.value === 'removal_pending') return ok({ kind: 'markPending' });
  const remaining = sections.filter((s) => s.sectionId !== sectionId && notRemoved(s));
  return ok({ kind: 'removeNow', renumber: renumber(remaining) });
}
