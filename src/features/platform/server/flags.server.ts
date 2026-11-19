// flags.isEnabled (contract 3, evaluated server-side from the BD database on every call, BR8.1)
// and the Admin change path (BR8.5–BR8.7). Roles are resolved from the userId (BR8.8).
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { type AppError, appError, fromZodError } from '#src/lib/errors.ts';
import { getLogger } from '#src/lib/logger.ts';
import type { Metrics } from '#src/lib/metrics.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createFlagsRepository } from '../data/flags.repository.ts';
import { evaluateFlag, type FlagRole } from '../domain/flags.ts';
import type { Instrument } from '../domain/instrumentation.ts';
import { createAudit } from './audit.server.ts';
import { FlagChangeInput } from './flags.schema.ts';

export type FlagView = {
  flagKey: string;
  description: string;
  state: 'off' | 'on' | 'targeted';
  targetRoles: string[];
  targetGoalSegmentIds: string[];
  rolloutPercent: number;
  revision: number;
  updatedAt: string;
};

export function createFlags(deps: {
  db: Database;
  clock: Clock;
  metrics: Metrics;
  rolesOf: (userId: string) => Promise<FlagRole[]>;
  instrument?: Instrument;
}) {
  const repo = createFlagsRepository();
  const audit = createAudit({ clock: deps.clock });
  const log = getLogger().child({ component: 'flags' });

  function view(row: NonNullable<Awaited<ReturnType<typeof repo.get>>>): FlagView {
    return {
      flagKey: row.flagKey,
      description: row.description,
      state: row.state,
      targetRoles: row.targetRoles,
      targetGoalSegmentIds: row.targetGoalSegmentIds,
      rolloutPercent: row.rolloutPercent,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Contract 3. No cache outlives the call (BR8.1). */
  async function isEnabled(
    flagKey: string,
    ctx: { userId?: string; goalSegmentId?: string } = {},
  ): Promise<boolean> {
    const row = await repo.get(deps.db, flagKey);
    const roles: FlagRole[] = ctx.userId ? await deps.rolesOf(ctx.userId) : [];
    const decision = evaluateFlag(row, {
      roles,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
      ...(ctx.goalSegmentId ? { goalSegmentId: ctx.goalSegmentId } : {}),
    });
    if (decision.reason === 'segment_missing') {
      log.warn(
        { flagKey, code: 'FLAG_SEGMENT_MISSING' },
        'segment-targeted flag evaluated without a goal segment',
      );
    }
    deps.metrics.increment('flag_evaluations_total', {
      flag: flagKey,
      enabled: String(decision.isEnabled),
    });
    return decision.isEnabled;
  }

  async function get(flagKey: string): Promise<FlagView | undefined> {
    const row = await repo.get(deps.db, flagKey);
    return row ? view(row) : undefined;
  }

  async function list(): Promise<FlagView[]> {
    return (await repo.list(deps.db)).map(view);
  }

  /** BR8.5: Admin with two-step only. BR8.6: every change is audit-logged with before and after. */
  async function save(
    actor: Actor,
    raw: FlagChangeInput,
    correlationId: string,
  ): Promise<Result<FlagView, AppError>> {
    if (!actor.roles.includes('admin') || !actor.hasStepUp) return err(appError('FORBIDDEN'));
    const parsed = FlagChangeInput.safeParse(raw);
    if (!parsed.success) return err(fromZodError(parsed.error));
    const input = parsed.data;
    return withTransaction(deps.db, async (tx) => {
      const exec = unwrapTx(tx);
      const current = await repo.getForUpdate(exec, input.flagKey);
      if (current && input.expectedRevision !== current.revision) {
        return err(appError('CONFLICT', { details: { currentRevision: current.revision } }));
      }
      const now = new Date(deps.clock.now());
      const next = {
        flagKey: input.flagKey,
        description: input.description,
        state: input.state,
        targetRoles: input.targetRoles,
        targetGoalSegmentIds: input.targetGoalSegmentIds,
        rolloutPercent: input.rolloutPercent,
        revision: (current?.revision ?? 0) + 1,
        updatedBy: actor.userId,
        updatedAt: now,
      };
      await repo.upsert(exec, next);
      const snapshot = (f: typeof next | NonNullable<typeof current>) => ({
        state: f.state,
        targetRoles: f.targetRoles,
        targetGoalSegmentIds: f.targetGoalSegmentIds,
        rolloutPercent: f.rolloutPercent,
        revision: f.revision,
      });
      await audit.record(tx, {
        actorId: actor.userId,
        action: 'platform.flag.changed',
        subjectType: 'feature_flag',
        subjectId: input.flagKey,
        before: current ? snapshot(current) : null,
        after: snapshot(next),
        correlationId,
      });
      deps.instrument?.emit({
        eventName: 'flag_changed',
        featureArea: 'platform',
        correlationId,
        properties: { state: input.state },
      });
      return ok(view({ ...next, updatedBy: actor.userId }));
    });
  }

  return { isEnabled, get, list, save };
}

export type Flags = ReturnType<typeof createFlags>;
