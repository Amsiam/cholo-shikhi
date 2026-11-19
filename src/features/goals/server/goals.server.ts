// Goals service (UC1–UC4; contract 5 Goals reads; contract 6 GoalChanged). Every write runs in one
// transaction with its audit entry (BR1.8) and, for a Goal choice, its outbox event (BR2.5). Refused
// writes change nothing and log one line with the reason code (NFR6.203).
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/index.ts';
import type { Audit } from '#src/features/platform/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import { Id } from '#src/lib/ids.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import {
  createGoalsRepository,
  type GoalRow,
  isUniqueViolation,
  type SegmentRow,
} from '../data/goals.repository.ts';
import { createSelectionRepository } from '../data/selection.repository.ts';
import { GOAL_CHANGED, type GoalChangedV1 } from '../domain/goal-changed.schema.ts';
import {
  checkSegmentChange,
  checkSegmentDeletable,
  checkVersion,
  decideGoalSelection,
  type GoalEvent,
  goalChangeConflict,
  groupActiveGoals,
  initialGoalStatus,
  noActiveGoalsNoticeKey,
  notFound,
  type PickerGroup,
  staleVersion,
  statusEventFor,
  transitionGoal,
  validateGoalFields,
  validateSegmentFields,
} from '../domain/goals.ts';
import { NO_ACTIVE_GOALS_TYPE } from '../domain/goals-notifications.ts';
import {
  ChangeGoalInput,
  ChooseGoalInput,
  GoalRetireInput,
  GoalSaveInput,
  GoalsAdminListInput,
  PageInput,
  SegmentDeleteInput,
  SegmentSaveInput,
} from './goals.schema.ts';

export type GoalsDeps = {
  db: Database;
  clock: Clock;
  audit: Audit;
  outbox: {
    publish<P>(
      tx: TxHandle,
      event: {
        type: string;
        version: number;
        aggregateKey: string;
        occurredAt: string;
        payload: P;
        correlationId: string;
      },
    ): Promise<void>;
  };
  /** Contract 4 notify(): enqueues a NotificationRequested event in the caller's transaction. */
  notify(
    tx: TxHandle,
    request: {
      recipientUserId: string;
      templateKey: string;
      dedupeKey: string;
      params: Record<string, string | number | boolean>;
      channels: Array<'in_app' | 'push' | 'email' | 'sms'>;
      priority: 'normal' | 'high';
    },
    correlationId: string,
  ): Promise<void>;
  /** The user IDs that hold an active Admin role (BR2.3 notice recipients). */
  listAdminUserIds(): Promise<string[]>;
  log: Logger;
};

export type SegmentView = { segmentId: string; segmentType: string; battleBand: string };
export type StudentGoal = { userId: string; goalId: string; segmentId: string; selectedAt: string };
export type CurrentGoalView = StudentGoal & { nameBn: string; nameEn: string };

type Failure = AppError;

/** Thrown inside a transaction to roll it back when a concurrent writer won a unique race. */
class UniqueRace extends Error {}

const segmentSnapshot = (s: SegmentRow) => ({
  segmentType: s.segmentType,
  battleBand: s.battleBand,
  sortOrder: s.sortOrder,
  version: s.version,
});
const goalSnapshot = (g: GoalRow) => ({
  segmentId: g.segmentId,
  status: g.status,
  sortOrder: g.sortOrder,
  version: g.version,
});

export function createGoals(deps: GoalsDeps) {
  const repo = createGoalsRepository();
  const selections = createSelectionRepository();
  const log = deps.log;
  const now = () => new Date(deps.clock.now());
  let lastNoticeKey: string | undefined;

  function refused<T>(
    error: Failure,
    context: { actorId?: string; action: string; subjectId?: string },
  ): Result<T, Failure> {
    log.warn({ code: error.code, reason: error.i18nKey, ...context }, 'goals write refused');
    return err(error);
  }

  /** Runs a write transaction; a lost unique race becomes CONFLICT and nothing is kept. */
  async function write<T>(
    action: string,
    actorId: string,
    fn: (tx: TxHandle) => Promise<Result<T, Failure>>,
    onRace: () => Failure = () => staleVersion(0),
  ): Promise<Result<T, Failure>> {
    try {
      return await withTransaction(deps.db, async (tx) => {
        const result = await fn(tx);
        // A refused write must leave no row behind: roll back by throwing, then report.
        if (!result.ok) throw Object.assign(new Error('refused'), { refusal: result.error });
        return result;
      });
    } catch (error) {
      const refusal = (error as { refusal?: Failure }).refusal;
      if (refusal) return refused(refusal, { actorId, action });
      if (error instanceof UniqueRace || isUniqueViolation(error))
        return refused(onRace(), { actorId, action });
      throw error;
    }
  }

  // ---------------------------------------------------------------- Admin: segments (UC3)

  async function listSegments(raw: z.input<typeof PageInput>) {
    const page = PageInput.parse(raw);
    const result = await repo.segments.list(deps.db, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return ok({
      page: page.page,
      total: result.total,
      rows: result.rows.map((r) => ({
        segmentId: r.segmentId,
        nameBn: r.nameBn,
        nameEn: r.nameEn,
        segmentType: r.segmentType,
        battleBand: r.battleBand,
        sortOrder: r.sortOrder,
        version: r.version,
        goalCount: r.goalCount,
      })),
    });
  }

  async function saveSegment(
    actor: Actor,
    raw: z.input<typeof SegmentSaveInput>,
    correlationId: string,
  ): Promise<Result<{ segmentId: string; version: number }, Failure>> {
    const input = SegmentSaveInput.parse(raw);
    return write('goals.segment.save', actor.userId, async (tx) => {
      const exec = unwrapTx(tx);
      const current = input.segmentId
        ? await repo.segments.getForUpdate(exec, input.segmentId)
        : undefined;
      if (input.segmentId && !current) return err(notFound());
      if (current) {
        const version = checkVersion(current.version, input.expectedVersion);
        if (!version.ok) return version;
      }
      const clashes = await repo.segments.nameClashes(exec, input, current?.segmentId);
      const valid = validateSegmentFields(input, clashes);
      if (!valid.ok) return valid;
      if (!current) {
        const row = await repo.segments.insert(exec, {
          ...valid.value,
          createdAt: now(),
          updatedAt: now(),
        });
        await deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'goals.segment.created',
          subjectType: 'goal_segment',
          subjectId: row.segmentId,
          after: segmentSnapshot(row),
          correlationId,
        });
        return ok({ segmentId: row.segmentId, version: row.version });
      }
      const updated = await repo.segments.update(
        exec,
        current.segmentId,
        current.version,
        valid.value,
        now(),
      );
      if (updated.kind !== 'applied') return err(staleVersion(current.version));
      const isTypeChange = current.segmentType !== updated.row.segmentType;
      await deps.audit.record(tx, {
        actorId: actor.userId,
        // BR1.6: a type change applies to new purchases only and is audit-logged as such.
        action: isTypeChange ? 'goals.segment.typeChanged' : 'goals.segment.updated',
        subjectType: 'goal_segment',
        subjectId: current.segmentId,
        before: segmentSnapshot(current),
        after: segmentSnapshot(updated.row),
        correlationId,
      });
      return ok({ segmentId: updated.row.segmentId, version: updated.row.version });
    });
  }

  async function deleteSegment(
    actor: Actor,
    raw: z.input<typeof SegmentDeleteInput>,
    correlationId: string,
  ): Promise<Result<{ segmentId: string }, Failure>> {
    const input = SegmentDeleteInput.parse(raw);
    return write('goals.segment.delete', actor.userId, async (tx) => {
      const exec = unwrapTx(tx);
      const current = await repo.segments.getForUpdate(exec, input.segmentId);
      if (!current) return err(notFound());
      const version = checkVersion(current.version, input.expectedVersion);
      if (!version.ok) return version;
      const deletable = checkSegmentDeletable(
        await repo.segments.goalCount(exec, current.segmentId),
      );
      if (!deletable.ok) return deletable;
      const deleted = await repo.segments.delete(exec, current.segmentId, current.version);
      if (deleted.kind !== 'applied') return err(staleVersion(current.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'goals.segment.deleted',
        subjectType: 'goal_segment',
        subjectId: current.segmentId,
        before: segmentSnapshot(current),
        correlationId,
      });
      return ok({ segmentId: current.segmentId });
    });
  }

  // ---------------------------------------------------------------- Admin: Goals (UC4)

  async function listGoalsAdmin(raw: z.input<typeof GoalsAdminListInput>) {
    const input = GoalsAdminListInput.parse(raw);
    const result = await repo.goals.list(deps.db, {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      ...(input.segmentId ? { segmentId: input.segmentId } : {}),
    });
    return ok({
      page: input.page,
      total: result.total,
      rows: result.rows.map((g) => ({
        goalId: g.goalId,
        segmentId: g.segmentId,
        nameBn: g.nameBn,
        nameEn: g.nameEn,
        status: g.status,
        sortOrder: g.sortOrder,
        version: g.version,
      })),
    });
  }

  function goalAction(event: GoalEvent | null, isFieldChange: boolean): string {
    if (!event || isFieldChange) return 'goals.goal.updated';
    return event === 'activate' ? 'goals.goal.activated' : 'goals.goal.deactivated';
  }

  async function saveGoal(
    actor: Actor,
    raw: z.input<typeof GoalSaveInput>,
    correlationId: string,
  ): Promise<Result<{ goalId: string; version: number }, Failure>> {
    const input = GoalSaveInput.parse(raw);
    return write('goals.goal.save', actor.userId, async (tx) => {
      const exec = unwrapTx(tx);
      const current = input.goalId ? await repo.goals.getForUpdate(exec, input.goalId) : undefined;
      if (input.goalId && !current) return err(notFound());
      if (current) {
        const version = checkVersion(current.version, input.expectedVersion);
        if (!version.ok) return version;
      }
      const event = current ? statusEventFor(current.status, input.status) : ok(null);
      if (!event.ok) return event;
      if (current) {
        const selectionCount = await repo.goals.selectionCount(exec, current.goalId);
        // Products (courses, exam packages, plans) arrive with later Catalog Bolts; none exist yet.
        const fixed = checkSegmentChange(current.segmentId, input.segmentId, {
          selectionCount,
          productCount: 0,
        });
        if (!fixed.ok) return fixed;
      }
      const segment = await repo.segments.get(exec, input.segmentId);
      const clashes = segment
        ? await repo.goals.nameClashes(exec, input.segmentId, input, current?.goalId)
        : {};
      const valid = validateGoalFields(input, { isSegmentKnown: Boolean(segment), clashes });
      if (!valid.ok) return valid;
      if (!current) {
        const row = await repo.goals.insert(exec, {
          ...valid.value,
          segmentId: input.segmentId,
          status: initialGoalStatus(input.status),
          createdAt: now(),
          updatedAt: now(),
        });
        await deps.audit.record(tx, {
          actorId: actor.userId,
          action: 'goals.goal.created',
          subjectType: 'goal',
          subjectId: row.goalId,
          after: goalSnapshot(row),
          correlationId,
        });
        return ok({ goalId: row.goalId, version: row.version });
      }
      const updated = await repo.goals.update(
        exec,
        current.goalId,
        current.version,
        { ...valid.value, segmentId: input.segmentId, status: input.status },
        now(),
      );
      if (updated.kind !== 'applied') return err(staleVersion(current.version));
      const isFieldChange =
        current.nameBn !== updated.row.nameBn ||
        current.nameEn !== updated.row.nameEn ||
        current.segmentId !== updated.row.segmentId ||
        current.sortOrder !== updated.row.sortOrder;
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: goalAction(event.value, isFieldChange),
        subjectType: 'goal',
        subjectId: current.goalId,
        before: goalSnapshot(current),
        after: goalSnapshot(updated.row),
        correlationId,
      });
      return ok({ goalId: updated.row.goalId, version: updated.row.version });
    });
  }

  async function retireGoal(
    actor: Actor,
    raw: z.input<typeof GoalRetireInput>,
    correlationId: string,
  ): Promise<Result<{ goalId: string; version: number }, Failure>> {
    const input = GoalRetireInput.parse(raw);
    return write('goals.goal.retire', actor.userId, async (tx) => {
      const exec = unwrapTx(tx);
      const current = await repo.goals.getForUpdate(exec, input.goalId);
      if (!current) return err(notFound());
      const version = checkVersion(current.version, input.expectedVersion);
      if (!version.ok) return version;
      const next = transitionGoal(current.status, 'retire');
      if (!next.ok) return next;
      // BR1.4: open selections on the Goal are left untouched.
      const updated = await repo.goals.update(
        exec,
        current.goalId,
        current.version,
        { status: next.value, retiredAt: now() },
        now(),
      );
      if (updated.kind !== 'applied') return err(staleVersion(current.version));
      await deps.audit.record(tx, {
        actorId: actor.userId,
        action: 'goals.goal.retired',
        subjectType: 'goal',
        subjectId: current.goalId,
        before: goalSnapshot(current),
        after: goalSnapshot(updated.row),
        correlationId,
      });
      return ok({ goalId: updated.row.goalId, version: updated.row.version });
    });
  }

  // ---------------------------------------------------------------- Student (UC1, UC2)

  /** BR2.3: at most one "no active Goals" notice per Admin per Dhaka day. */
  async function noticeNoActiveGoals(correlationId: string): Promise<void> {
    const key = noActiveGoalsNoticeKey(deps.clock.now());
    if (key === lastNoticeKey) return;
    const admins = await deps.listAdminUserIds();
    await withTransaction(deps.db, async (tx) => {
      for (const recipientUserId of admins) {
        await deps.notify(
          tx,
          {
            recipientUserId,
            templateKey: NO_ACTIVE_GOALS_TYPE,
            dedupeKey: key,
            params: {},
            channels: ['in_app'],
            priority: 'normal',
          },
          correlationId,
        );
      }
    });
    lastNoticeKey = key;
    log.info({ code: 'GOALS_NONE_ACTIVE', recipients: admins.length }, 'no active goals notice');
  }

  async function listActiveGoals(
    correlationId: string,
  ): Promise<Result<{ segments: PickerGroup[] }, Failure>> {
    const [segments, goals] = await Promise.all([
      repo.segments.listAll(deps.db),
      repo.goals.listActive(deps.db),
    ]);
    const groups = groupActiveGoals(segments, goals);
    if (groups.length === 0) await noticeNoActiveGoals(correlationId);
    return ok({ segments: groups });
  }

  /**
   * The public catalog's goal picker: the same active groups, read-only. It never sends the
   * "no active goals" Admin notice, so an anonymous caller cannot trigger a notification.
   */
  async function listPublicGoals(): Promise<Result<{ segments: PickerGroup[] }, Failure>> {
    const [segments, goals] = await Promise.all([
      repo.segments.listAll(deps.db),
      repo.goals.listActive(deps.db),
    ]);
    return ok({ segments: groupActiveGoals(segments, goals) });
  }

  /** An active Goal by ID for the public catalog; any other status answers NOT_FOUND. */
  async function getActiveGoal(
    goalId: string,
  ): Promise<
    Result<
      { goalId: string; segmentId: string; nameBn: string; nameEn: string },
      AppError<'NOT_FOUND'>
    >
  > {
    const goal = await repo.goals.get(deps.db, goalId);
    if (goal?.status !== 'active') return err(notFound());
    return ok({
      goalId: goal.goalId,
      segmentId: goal.segmentId,
      nameBn: goal.nameBn,
      nameEn: goal.nameEn,
    });
  }

  async function currentGoalView(
    userId: string,
  ): Promise<Result<CurrentGoalView, AppError<'NOT_FOUND'>>> {
    const selection = await selections.current(deps.db, userId);
    if (!selection) return err(notFound());
    const goal = await repo.goals.get(deps.db, selection.goalId);
    if (!goal) return err(notFound());
    return ok({
      userId,
      goalId: selection.goalId,
      segmentId: selection.segmentId,
      selectedAt: selection.selectedAt.toISOString(),
      nameBn: goal.nameBn,
      nameEn: goal.nameEn,
    });
  }

  async function select(
    actor: Actor,
    request: { mode: 'choose' | 'change'; goalId: string; acknowledgedStreakReset?: boolean },
    correlationId: string,
  ): Promise<Result<{ goalId: string; isChanged: boolean }, Failure>> {
    return write<{ goalId: string; isChanged: boolean }>(
      `goals.selection.${request.mode}`,
      actor.userId,
      async (tx) => {
        const exec = unwrapTx(tx);
        const current = await selections.currentForUpdate(exec, actor.userId);
        const target = await repo.goals.getForShare(exec, request.goalId);
        const decision = decideGoalSelection({
          mode: request.mode,
          current: current ? { goalId: current.goalId } : null,
          target,
          ...(request.acknowledgedStreakReset !== undefined
            ? { acknowledgedStreakReset: request.acknowledgedStreakReset }
            : {}),
          now: deps.clock.now(),
        });
        if (!decision.ok) return decision;
        // BR2.8: re-selecting the current Goal writes nothing and publishes nothing.
        if (decision.value.kind === 'noop')
          return ok({ goalId: decision.value.goalId, isChanged: false });
        const at = new Date(decision.value.changedAt);
        if (current) await selections.close(exec, current.goalSelectionId, at);
        try {
          await selections.open(exec, {
            userId: actor.userId,
            goalId: decision.value.newGoalId,
            segmentId: decision.value.newSegmentId,
            selectedAt: at,
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new UniqueRace();
          throw error;
        }
        const payload: GoalChangedV1 = {
          userId: actor.userId,
          previousGoalId: decision.value.previousGoalId,
          newGoalId: decision.value.newGoalId,
          newSegmentId: decision.value.newSegmentId,
          changedAt: decision.value.changedAt,
        };
        await deps.outbox.publish(tx, {
          type: GOAL_CHANGED.type,
          version: GOAL_CHANGED.version,
          aggregateKey: actor.userId,
          occurredAt: decision.value.changedAt,
          payload,
          correlationId,
        });
        log.info(
          { code: 'GOAL_CHANGED', userId: actor.userId, goalId: payload.newGoalId },
          'goal selection opened',
        );
        return ok({ goalId: payload.newGoalId, isChanged: true });
      },
      goalChangeConflict,
    );
  }

  async function chooseGoal(
    actor: Actor,
    raw: z.input<typeof ChooseGoalInput>,
    correlationId: string,
  ) {
    const input = ChooseGoalInput.parse(raw);
    return select(actor, { mode: 'choose', goalId: input.goalId }, correlationId);
  }

  async function changeGoal(
    actor: Actor,
    raw: z.input<typeof ChangeGoalInput>,
    correlationId: string,
  ) {
    const input = ChangeGoalInput.parse(raw);
    return select(
      actor,
      {
        mode: 'change',
        goalId: input.goalId,
        acknowledgedStreakReset: input.acknowledgedStreakReset,
      },
      correlationId,
    );
  }

  // ---------------------------------------------------------------- contract 5 reads

  /** Contract 5: the student's current Goal; NOT_FOUND = no Goal chosen yet. */
  async function getCurrentGoal(
    userId: string,
  ): Promise<Result<StudentGoal, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(userId).success) return err(notFound());
    const view = await currentGoalView(userId);
    if (!view.ok) return view;
    const { nameBn: _bn, nameEn: _en, ...goal } = view.value;
    return ok(goal);
  }

  /** Contract 5, BR13.5: the segment's current type and battle band. */
  async function getSegment(
    segmentId: string,
  ): Promise<Result<SegmentView, AppError<'NOT_FOUND'>>> {
    if (!Id.safeParse(segmentId).success) return err(notFound());
    const segment = await repo.segments.get(deps.db, segmentId);
    if (!segment) return err(notFound());
    return ok({
      segmentId: segment.segmentId,
      segmentType: segment.segmentType,
      battleBand: segment.battleBand,
    });
  }

  /** Contract 5, BR13.6: every Goal ID (any status) in the segments, ascending, no duplicates. */
  async function listGoalsInSegments(segmentIds: readonly string[]): Promise<string[]> {
    const valid = z.array(Id).safeParse(segmentIds);
    const ids = valid.success ? valid.data : segmentIds.filter((id) => Id.safeParse(id).success);
    return repo.goals.idsInSegments(deps.db, ids);
  }

  return {
    listSegments,
    saveSegment,
    deleteSegment,
    listGoalsAdmin,
    saveGoal,
    retireGoal,
    listActiveGoals,
    listPublicGoals,
    getActiveGoal,
    currentGoalView,
    chooseGoal,
    changeGoal,
    getCurrentGoal,
    getSegment,
    listGoalsInSegments,
  };
}

export type Goals = ReturnType<typeof createGoals>;
