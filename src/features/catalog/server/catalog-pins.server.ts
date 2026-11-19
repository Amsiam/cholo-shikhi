// Admin pins on S3 (UC22, BR11.11): an Admin with step-up sets or clears the pinRank of a course, an
// exam package or a plan. Pinned items list first by rank (BR11.5). Each change carries the item's
// version token (BR12.1), runs in one transaction under the item's row lock and writes an audit
// entry; a hidden course accepts no change (NFR6.219).
import type { Actor } from '#src/features/identity-access/index.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Executor } from '#src/server/db.ts';
import { createProductRepository } from '../data/products.repository.ts';
import { checkNotUnderTakedown, checkVersion, notFound, staleVersion } from '../domain/course.ts';
import { ClearPinRankInput, type PinTarget, SetPinRankInput } from './catalog-browse.schema.ts';
import type { CatalogKernel, Failure } from './catalog-kernel.ts';

type Pinned = { pinRank: number | null; version: number };

const AUDIT_PREFIX: Record<PinTarget['type'], string> = {
  course: 'catalog.course',
  exam_package: 'catalog.examPackage',
  subscription_plan: 'catalog.plan',
};
const ID_FIELD: Record<PinTarget['type'], 'courseId' | 'examPackageId' | 'planId'> = {
  course: 'courseId',
  exam_package: 'examPackageId',
  subscription_plan: 'planId',
};

export function createPinService(kernel: CatalogKernel) {
  const { courses } = kernel.repos;
  const products = createProductRepository();

  /** Locks the item, checks its token and writes the rank; NOT_FOUND for an unknown item. */
  async function apply(
    exec: Executor,
    target: PinTarget,
    expectedVersion: number,
    pinRank: number | null,
  ): Promise<Result<{ before: number | null; after: Pinned }, Failure>> {
    const at = kernel.now();
    if (target.type === 'course') {
      const row = await courses.getForUpdate(exec, target.id);
      if (!row) return err(notFound());
      const takedown = checkNotUnderTakedown(row.status === 'hidden');
      if (!takedown.ok) return takedown;
      const version = checkVersion(row.version, expectedVersion);
      if (!version.ok) return version;
      const updated = await courses.update(exec, row.courseId, row.version, { pinRank }, at);
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      return ok({ before: row.pinRank, after: updated.row });
    }
    if (target.type === 'exam_package') {
      const row = await products.getExamForUpdate(exec, target.id);
      if (!row) return err(notFound());
      const version = checkVersion(row.version, expectedVersion);
      if (!version.ok) return version;
      const updated = await products.updateExam(
        exec,
        row.examPackageId,
        row.version,
        { pinRank },
        at,
      );
      if (updated.kind !== 'applied') return err(staleVersion(row.version));
      return ok({ before: row.pinRank, after: updated.row });
    }
    const row = await products.getPlanForUpdate(exec, target.id);
    if (!row) return err(notFound());
    const version = checkVersion(row.version, expectedVersion);
    if (!version.ok) return version;
    const updated = await products.updatePlan(exec, row.planId, row.version, { pinRank }, at);
    if (updated.kind !== 'applied') return err(staleVersion(row.version));
    return ok({ before: row.pinRank, after: updated.row });
  }

  async function changePin(
    actor: Actor,
    operation: 'setPinRank' | 'clearPinRank',
    input: { target: PinTarget; expectedVersion: number; pinRank: number | null },
    correlationId: string,
  ): Promise<Result<Record<string, string | number | null>, Failure>> {
    const context = {
      actor,
      operation,
      ...(input.target.type === 'course' ? { courseId: input.target.id } : {}),
    };
    return kernel.write(context, correlationId, async (tx, exec) => {
      // roleFn('admin') already refused everyone else; this keeps the service safe on its own.
      if (!actor.roles.includes('admin')) return err(notFound());
      const applied = await apply(exec, input.target, input.expectedVersion, input.pinRank);
      if (!applied.ok) return applied;
      await kernel.deps.audit.record(tx, {
        actorId: actor.userId,
        action: `${AUDIT_PREFIX[input.target.type]}.${input.pinRank === null ? 'unpinned' : 'pinned'}`,
        subjectType: input.target.type,
        subjectId: input.target.id,
        before: { pinRank: applied.value.before },
        after: { pinRank: input.pinRank },
        correlationId,
      });
      return ok({
        [ID_FIELD[input.target.type]]: input.target.id,
        pinRank: input.pinRank,
        version: applied.value.after.version,
      });
    });
  }

  async function setPinRank(actor: Actor, raw: SetPinRankInput, correlationId: string) {
    const input = SetPinRankInput.parse(raw);
    return changePin(actor, 'setPinRank', input, correlationId);
  }

  async function clearPinRank(actor: Actor, raw: ClearPinRankInput, correlationId: string) {
    const input = ClearPinRankInput.parse(raw);
    return changePin(actor, 'clearPinRank', { ...input, pinRank: null }, correlationId);
  }

  return { setPinRank, clearPinRank };
}
