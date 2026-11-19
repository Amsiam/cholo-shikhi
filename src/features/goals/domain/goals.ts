// Goals domain rules (rules.md BR1.2–BR1.9, BR2.2–BR2.8; functional-spec §3.4). Plain TypeScript:
// no framework, DB or env. Every expected failure is a typed Result, never a throw.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { dhakaDateParts } from '#src/lib/time.ts';

export const SEGMENT_TYPES = ['academic', 'job_aspirant'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export const GOAL_STATUSES = ['inactive', 'active', 'retired'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Name length limits (entities.md): segment names 60, Goal names 80. */
export const SEGMENT_NAME_MAX = 60;
export const GOAL_NAME_MAX = 80;
/** A lowercase key such as class_6_8, hsc, bcs or bank (BR1.2), at most 40 characters. */
export const BATTLE_BAND = /^[a-z][a-z0-9_]{0,39}$/;

// ------------------------------------------------------------------ errors (rules.md mapping)

type FieldErrors = Record<string, string[]>;

function validationFailed(
  fieldErrors: FieldErrors,
  i18nKey: `errors.${string}` = 'errors.common.VALIDATION_FAILED',
): AppError<'VALIDATION_FAILED'> {
  return { code: 'VALIDATION_FAILED', i18nKey, fieldErrors };
}

/** BR12.1: a write based on an old version (CONFLICT stale_version). */
export function staleVersion(currentVersion: number): AppError<'CONFLICT'> {
  return {
    code: 'CONFLICT',
    i18nKey: 'errors.catalog.staleVersion',
    details: { currentVersion },
  };
}

/** BR1.5: a segment still referenced by Goals cannot be deleted. */
export function segmentHasGoals(linkedGoalCount: number): AppError<'CONFLICT'> {
  return {
    code: 'CONFLICT',
    i18nKey: 'errors.goals.segmentHasGoals',
    details: { linkedGoalCount },
  };
}

/** BR2.4: a concurrent second Goal change lost the one-open-selection race. */
export function goalChangeConflict(): AppError<'CONFLICT'> {
  return { code: 'CONFLICT', i18nKey: 'errors.goals.goalChangeConflict' };
}

function invalidState(i18nKey: `errors.${string}`): AppError<'INVALID_STATE'> {
  return { code: 'INVALID_STATE', i18nKey };
}

export function notFound(): AppError<'NOT_FOUND'> {
  return { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' };
}

// ------------------------------------------------------------------ segment and Goal fields

export type NameClashes = { nameBn?: boolean; nameEn?: boolean };

function checkName(value: string, max: number, isTaken: boolean | undefined): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'errors.goals.nameRequired';
  if (trimmed.length > max) return 'errors.goals.nameTooLong';
  if (isTaken) return 'errors.goals.nameDuplicate';
  return null;
}

function checkNames(
  input: { nameBn: string; nameEn: string },
  max: number,
  clashes: NameClashes,
  fieldErrors: FieldErrors,
): void {
  const bn = checkName(input.nameBn, max, clashes.nameBn);
  const en = checkName(input.nameEn, max, clashes.nameEn);
  if (bn) fieldErrors.nameBn = [bn];
  if (en) fieldErrors.nameEn = [en];
}

export type SegmentFields = {
  nameBn: string;
  nameEn: string;
  segmentType: string;
  battleBand: string;
  sortOrder: number;
};

export type ValidSegment = Omit<SegmentFields, 'segmentType'> & { segmentType: SegmentType };

/** BR1.2, BR3.1: both names (trimmed, ≤ 60, unique), a known type and a lowercase band key. */
export function validateSegmentFields(
  input: SegmentFields,
  clashes: NameClashes = {},
): Result<ValidSegment, AppError<'VALIDATION_FAILED'>> {
  const fieldErrors: FieldErrors = {};
  checkNames(input, SEGMENT_NAME_MAX, clashes, fieldErrors);
  if (!(SEGMENT_TYPES as readonly string[]).includes(input.segmentType)) {
    fieldErrors.segmentType = ['errors.validation.invalid_value'];
  }
  if (!BATTLE_BAND.test(input.battleBand.trim())) {
    fieldErrors.battleBand = ['errors.goals.battleBandInvalid'];
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    fieldErrors.sortOrder = ['errors.validation.too_small'];
  }
  if (Object.keys(fieldErrors).length > 0) return err(validationFailed(fieldErrors));
  return ok({
    nameBn: input.nameBn.trim(),
    nameEn: input.nameEn.trim(),
    segmentType: input.segmentType as SegmentType,
    battleBand: input.battleBand.trim(),
    sortOrder: input.sortOrder,
  });
}

export type GoalFields = { nameBn: string; nameEn: string; sortOrder: number };

/** BR1.3: both names (trimmed, ≤ 80, unique in the segment) and an existing segment. */
export function validateGoalFields(
  input: GoalFields,
  context: { isSegmentKnown: boolean; clashes?: NameClashes },
): Result<GoalFields, AppError<'VALIDATION_FAILED'>> {
  const fieldErrors: FieldErrors = {};
  checkNames(input, GOAL_NAME_MAX, context.clashes ?? {}, fieldErrors);
  if (!context.isSegmentKnown) fieldErrors.segmentId = ['errors.goals.segmentNotFound'];
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    fieldErrors.sortOrder = ['errors.validation.too_small'];
  }
  if (Object.keys(fieldErrors).length > 0) return err(validationFailed(fieldErrors));
  return ok({
    nameBn: input.nameBn.trim(),
    nameEn: input.nameEn.trim(),
    sortOrder: input.sortOrder,
  });
}

/** BR12.1: the caller's expectedVersion must equal the stored version. */
export function checkVersion(
  stored: number,
  expected: number | undefined,
): Result<void, AppError<'CONFLICT'>> {
  return expected === stored ? ok(undefined) : err(staleVersion(stored));
}

// ------------------------------------------------------------------ Goal status machine (§3.4)

export type GoalEvent = 'activate' | 'deactivate' | 'retire';

const TRANSITIONS: Readonly<Record<GoalStatus, Partial<Record<GoalEvent, GoalStatus>>>> = {
  inactive: { activate: 'active', retire: 'retired' },
  active: { deactivate: 'inactive', retire: 'retired' },
  retired: {},
};

/** BR1.4: inactive ⇄ active → retired; retired is terminal. */
export function transitionGoal(
  from: GoalStatus,
  event: GoalEvent,
): Result<GoalStatus, AppError<'INVALID_STATE'>> {
  const to = TRANSITIONS[from][event];
  if (to) return ok(to);
  return err(
    invalidState(from === 'retired' ? 'errors.goals.goalRetired' : 'errors.common.INVALID_STATE'),
  );
}

/** The event a save with a requested status implies; an unchanged status needs none. */
export function statusEventFor(
  from: GoalStatus,
  requested: 'inactive' | 'active',
): Result<GoalEvent | null, AppError<'INVALID_STATE'>> {
  if (from === 'retired') return err(invalidState('errors.goals.goalRetired'));
  if (from === requested) return ok(null);
  return ok(requested === 'active' ? 'activate' : 'deactivate');
}

/** A new Goal starts inactive or active (§3.4); never retired. */
export function initialGoalStatus(requested: 'inactive' | 'active'): GoalStatus {
  return requested;
}

/** BR1.7: a Goal's segment is fixed once a student selected it or a product is filed under it. */
export function checkSegmentChange(
  current: string,
  requested: string,
  usage: { selectionCount: number; productCount: number },
): Result<void, AppError<'INVALID_STATE'>> {
  if (current === requested) return ok(undefined);
  if (usage.selectionCount > 0 || usage.productCount > 0) {
    return err(invalidState('errors.goals.segmentFixed'));
  }
  return ok(undefined);
}

/** BR1.5: a segment can be deleted only when no Goal of any status references it. */
export function checkSegmentDeletable(linkedGoalCount: number): Result<void, AppError<'CONFLICT'>> {
  return linkedGoalCount === 0 ? ok(undefined) : err(segmentHasGoals(linkedGoalCount));
}

/**
 * BR1.9 (exported for Catalog): a course, exam package or plan can be filed under, or moved to, an
 * active Goal only. `goal` is undefined when no Goal has that ID.
 */
export function checkGoalAcceptsNewProducts(
  goal: { status: GoalStatus } | undefined,
): Result<void, AppError<'VALIDATION_FAILED'>> {
  if (goal?.status === 'active') return ok(undefined);
  return err(validationFailed({ goalId: ['errors.goals.goalNotActive'] }));
}

// ------------------------------------------------------------------ student selection (BR2)

export type SelectionDecision =
  | { kind: 'noop'; goalId: string }
  | {
      kind: 'open';
      previousGoalId: string | null;
      newGoalId: string;
      newSegmentId: string;
      changedAt: string;
    };

export type SelectionRequest = {
  mode: 'choose' | 'change';
  current: { goalId: string } | null;
  target: { goalId: string; segmentId: string; status: GoalStatus } | undefined;
  /** changeGoal only: the Student confirmed the streak warning (BR2.6). */
  acknowledgedStreakReset?: boolean;
  now: string;
};

/** BR2.4–BR2.8: what a choose or change request does, decided before any write. */
export function decideGoalSelection(
  request: SelectionRequest,
): Result<SelectionDecision, AppError<'VALIDATION_FAILED' | 'INVALID_STATE'>> {
  if (request.mode === 'change' && request.acknowledgedStreakReset !== true) {
    return err(
      validationFailed(
        { acknowledgedStreakReset: ['errors.goals.streakResetNotAcknowledged'] },
        'errors.goals.streakResetNotAcknowledged',
      ),
    );
  }
  const targetId = request.target?.goalId;
  if (request.current && targetId && request.current.goalId === targetId) {
    return ok({ kind: 'noop', goalId: targetId });
  }
  if (request.target?.status !== 'active') {
    return err(
      validationFailed({ goalId: ['errors.goals.goalNotActive'] }, 'errors.goals.goalNotActive'),
    );
  }
  if (request.mode === 'choose' && request.current) {
    return err(invalidState('errors.goals.alreadyHasGoal'));
  }
  return ok({
    kind: 'open',
    previousGoalId: request.current?.goalId ?? null,
    newGoalId: request.target.goalId,
    newSegmentId: request.target.segmentId,
    changedAt: request.now,
  });
}

// ------------------------------------------------------------------ S1 grouping (BR2.2)

export type PickerSegment = {
  segmentId: string;
  nameBn: string;
  nameEn: string;
  sortOrder: number;
};
export type PickerGoal = {
  goalId: string;
  segmentId: string;
  nameBn: string;
  nameEn: string;
  status: GoalStatus;
  sortOrder: number;
};
export type PickerGroup = Omit<PickerSegment, 'sortOrder'> & {
  goals: Array<Pick<PickerGoal, 'goalId' | 'nameBn' | 'nameEn'>>;
};

const bySortThenName = <T extends { sortOrder: number; nameEn: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn, 'en');

/** BR2.2: active Goals grouped under their segment, both in sortOrder; empty segments hidden. */
export function groupActiveGoals(
  segments: readonly PickerSegment[],
  goals: readonly PickerGoal[],
): PickerGroup[] {
  const active = goals.filter((g) => g.status === 'active');
  return [...segments].sort(bySortThenName).flatMap((segment) => {
    const inSegment = active.filter((g) => g.segmentId === segment.segmentId).sort(bySortThenName);
    if (inSegment.length === 0) return [];
    return [
      {
        segmentId: segment.segmentId,
        nameBn: segment.nameBn,
        nameEn: segment.nameEn,
        goals: inSegment.map(({ goalId, nameBn, nameEn }) => ({ goalId, nameBn, nameEn })),
      },
    ];
  });
}

/** BR2.3: the idempotency key of the "no active Goals" Admin notice: one per Dhaka day. */
export function noActiveGoalsNoticeKey(now: string): string {
  const { year, month, day } = dhakaDateParts(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `goals.noActiveGoals:${year}-${pad(month)}-${pad(day)}`;
}
