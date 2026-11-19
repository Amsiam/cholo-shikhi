// Dead-letter review (contract 2, BR11.8): Admin inspects, replays or discards. Replay re-queues the
// same envelope id with attempts reset (the processed-event rule keeps it safe); discard needs a
// written justification and is audit-logged.
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { type AppError, appError, fromZodError } from '#src/lib/errors.ts';
import type { Json } from '#src/lib/json.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import { type Database, unwrapTx, withTransaction } from '#src/server/db.ts';
import { outboxDelivery, outboxEvent } from '#src/server/schema/index.ts';
import { createAudit } from './audit.server.ts';

export const DeadLetterActionInput = z.object({
  outboxDeliveryId: z.uuid(),
  action: z.enum(['replay', 'discard']),
  justification: z.string().trim().min(10).max(1000).optional(),
});
export const DeadLetterListInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type DeadLetterView = {
  outboxDeliveryId: string;
  outboxEventId: string;
  consumerName: string;
  eventType: string;
  aggregateKey: string;
  payload: Json;
  lastErrorCode: string | null;
  attemptTimes: string[];
  deadLetteredAt: string | null;
};

export function createDeadLetters(deps: { db: Database; clock: Clock }) {
  const audit = createAudit({ clock: deps.clock });
  const isAdmin = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

  async function list(
    actor: Actor,
    raw: z.input<typeof DeadLetterListInput>,
  ): Promise<Result<{ rows: DeadLetterView[]; total: number }, AppError>> {
    if (!isAdmin(actor)) return err(appError('FORBIDDEN'));
    const input = DeadLetterListInput.parse(raw);
    const where = eq(outboxDelivery.status, 'dead_lettered');
    const rows = await deps.db
      .select({ d: outboxDelivery, e: outboxEvent })
      .from(outboxDelivery)
      .innerJoin(outboxEvent, eq(outboxEvent.outboxEventId, outboxDelivery.outboxEventId))
      .where(where)
      .orderBy(desc(outboxDelivery.deadLetteredAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
    const [total] = await deps.db.select({ n: count() }).from(outboxDelivery).where(where);
    return ok({
      total: total?.n ?? 0,
      rows: rows.map(({ d, e }) => ({
        outboxDeliveryId: d.outboxDeliveryId,
        outboxEventId: d.outboxEventId,
        consumerName: d.consumerName,
        eventType: e.eventType,
        aggregateKey: d.aggregateKey,
        // Payloads carry IDs and amounts only (BR11.2), so they may be shown to the Admin.
        payload: e.payload as Json,
        lastErrorCode: d.lastErrorCode,
        attemptTimes: d.attemptTimes,
        deadLetteredAt: d.deadLetteredAt ? d.deadLetteredAt.toISOString() : null,
      })),
    });
  }

  async function resolve(
    actor: Actor,
    raw: z.input<typeof DeadLetterActionInput>,
    correlationId: string,
  ): Promise<Result<void, AppError>> {
    if (!isAdmin(actor)) return err(appError('FORBIDDEN'));
    const parsed = DeadLetterActionInput.safeParse(raw);
    if (!parsed.success) return err(fromZodError(parsed.error));
    const input = parsed.data;
    if (input.action === 'discard' && !input.justification) {
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: { justification: ['errors.validation.required'] },
        }),
      );
    }
    return withTransaction(deps.db, async (tx) => {
      const exec = unwrapTx(tx);
      const [row] = await exec
        .select()
        .from(outboxDelivery)
        .where(
          and(
            eq(outboxDelivery.outboxDeliveryId, input.outboxDeliveryId),
            eq(outboxDelivery.status, 'dead_lettered'),
          ),
        )
        .for('update');
      if (!row) return err(appError('NOT_FOUND'));
      await exec
        .update(outboxDelivery)
        .set(
          input.action === 'replay'
            ? { status: 'pending', attempts: 0, nextAttemptAt: null, resolvedBy: actor.userId }
            : {
                status: 'discarded',
                resolvedBy: actor.userId,
                discardJustification: input.justification ?? null,
              },
        )
        .where(eq(outboxDelivery.outboxDeliveryId, row.outboxDeliveryId));
      await audit.record(tx, {
        actorId: actor.userId,
        action:
          input.action === 'replay'
            ? 'platform.dead_letter.replayed'
            : 'platform.dead_letter.discarded',
        subjectType: 'outbox_delivery',
        subjectId: row.outboxDeliveryId,
        before: {
          status: 'dead_lettered',
          attempts: row.attempts,
          lastErrorCode: row.lastErrorCode,
        },
        after: { status: input.action === 'replay' ? 'pending' : 'discarded' },
        ...(input.justification ? { reason: input.justification } : {}),
        correlationId,
      });
      return ok(undefined);
    });
  }

  return { list, resolve };
}
