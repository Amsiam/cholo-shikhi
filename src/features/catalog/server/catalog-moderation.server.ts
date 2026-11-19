// OD-207 moderation signals to the Admin (Step 50; ships normally, no approval needed).
// - `catalog.moderation.signals` runs every 5 minutes in the jobs lane: an instructor with more than
//   20 publishes or republishes in the current Dhaka day raises a signal.
// - A link refusal is counted at refusal time; the 11th in an hour raises a signal.
// - Reaching the course-creation limit (SD-218) raises a signal at refusal time.
// Each signal is one in-app notification per Admin (contract 4 notify, IDs and enums only),
// de-duplicated per instructor per window. A signal never blocks or changes the instructor's action.
import type { Logger } from 'pino';
import type { AppError } from '#src/lib/errors.ts';
import type { Json } from '#src/lib/json.ts';
import { ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { type Database, withTransaction } from '#src/server/db.ts';
import { createModerationRepository } from '../data/moderation.repository.ts';
import { MODERATION_SIGNAL_TYPE } from '../domain/catalog-notifications.ts';
import {
  hourWindowStart,
  type ModerationSignal,
  publishBursts,
  shouldRaiseLinkSignal,
  signalDedupeKey,
} from '../domain/moderation.ts';
import { dhakaDayStart } from './limits.ts';

export const MODERATION_JOB = 'catalog.moderation.signals';

export type ModerationDeps = {
  db: Database;
  clock: Clock;
  log: Logger;
  hashId(userId: string): string;
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
};

export function createModeration(deps: ModerationDeps) {
  const repo = createModerationRepository();
  const now = () => new Date(deps.clock.now());

  async function raise(
    signal: ModerationSignal,
    instructorId: string,
    windowStart: Date,
    correlationId: string,
  ): Promise<void> {
    const admins = await repo.adminUserIds(deps.db);
    const dedupeKey = signalDedupeKey(signal, instructorId, windowStart);
    await withTransaction(deps.db, async (tx) => {
      for (const recipientUserId of admins) {
        await deps.notify(
          tx,
          {
            recipientUserId,
            templateKey: MODERATION_SIGNAL_TYPE,
            dedupeKey,
            params: { signal, instructorId },
            channels: ['in_app'],
            priority: 'normal',
          },
          correlationId,
        );
      }
    });
    deps.log.info(
      { event: 'catalog.moderation.signal', signal, instructorId, recipients: admins.length },
      'moderation signal raised',
    );
  }

  /** The 5-minute job: publish bursts in the current Dhaka day. Returns the instructors signalled. */
  async function runSignals(correlationId: string): Promise<number> {
    const dayStart = dhakaDayStart(now());
    const flagged = publishBursts(await repo.publishCountsSince(deps.db, dayStart));
    for (const instructorId of flagged)
      await raise('publishBurst', instructorId, dayStart, correlationId);
    return flagged.length;
  }

  /** Called after a save is refused for an invalid or blocked link. */
  async function linkRefused(instructorId: string, correlationId: string): Promise<void> {
    const windowStart = hourWindowStart(now());
    const count = await repo.countLinkRefusal(
      deps.db,
      `catalog.linkRefusals:${deps.hashId(instructorId)}`,
      windowStart,
    );
    if (shouldRaiseLinkSignal(count))
      await raise('linkRefusals', instructorId, windowStart, correlationId);
  }

  /** Called when a course creation is refused by the daily limit (SD-218). */
  async function courseCreateLimitReached(instructorId: string, correlationId: string) {
    await raise('courseCreateLimit', instructorId, dhakaDayStart(now()), correlationId);
  }

  function jobHandlers(): Record<
    string,
    (ctx: { correlationId: string }) => Promise<Result<Json, AppError>>
  > {
    return {
      [MODERATION_JOB]: async ({ correlationId }) =>
        ok({ signalled: await runSignals(correlationId) }),
    };
  }

  return { runSignals, linkRefused, courseCreateLimitReached, jobHandlers };
}

export type Moderation = ReturnType<typeof createModeration>;
