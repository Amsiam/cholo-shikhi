// Fraud review queues (US4.8, US4.9, US5.15, US8.10, US8.11; screen A3), Admin with two-step
// sign-in only. REVIEW QUEUES ONLY, the human's choice: there is no automatic detector and no
// threshold. An Admin flags an account by hand (Vault gaming, live-quiz collusion or referral
// fraud) with a reason; while the flag is open its hold applies (see fraud-holds.server.ts). The
// Admin then clears it (the hold is lifted) or bans the account. A ban SUSPENDS the account through
// IdentityAccess (it cannot sign in and its sessions end); it is not account closure, and an Admin
// can reverse it (reinstate). Finance cannot ban (AC8.11.3). Every step is audit-logged.
import {
  type Actor,
  getIdentity,
  reinstateAccount,
  suspendAccount,
} from '#src/features/identity-access/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createFraudRepository, type FlagRow } from '../data/fraud.repository.ts';
import { isFraudReason, nextFraudState, userRefOf } from '../domain/fraud.ts';
import { DecideFlagInput, FlagAccountInput, FraudQueueInput } from './fraud.schema.ts';

const repo = createFraudRepository();
const audit = createAudit({ clock: systemClock });
type FraudError = AppError<
  'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'CONFLICT'
>;
const withKey = <C extends FraudError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canManage = (actor: Actor) => actor.roles.includes('admin') && actor.hasStepUp;

export async function flagAccount(
  actor: Actor,
  raw: FlagAccountInput,
  correlationId: string,
): Promise<Result<{ flagId: string }, FraudError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.fraud.forbidden'));
  const input = FlagAccountInput.parse(raw);
  if (!isFraudReason(input.reason)) return err(withKey('VALIDATION_FAILED', 'errors.fraud.reason'));
  const ref = userRefOf(input.user);
  const userId = !ref
    ? undefined
    : 'userId' in ref
      ? ref.userId
      : await getIdentity().userIdByEmail(ref.email);
  const names = userId ? await getIdentity().displayNamesOf([userId]) : {};
  if (!userId || names[userId] === undefined)
    return err(withKey('NOT_FOUND', 'errors.fraud.noUser'));
  if (userId === actor.userId) return err(withKey('INVALID_STATE', 'errors.fraud.self'));
  const reason = input.reason.trim();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    if (await repo.openOf(exec, userId, input.kind))
      return err(withKey('CONFLICT', 'errors.fraud.alreadyFlagged'));
    const row = await repo.insert(exec, {
      kind: input.kind,
      userId,
      reason,
      flaggedBy: actor.userId,
      flaggedAt: new Date(),
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: `trustops.fraud.flagged`,
      subjectType: 'fraud_flag',
      subjectId: row.flagId,
      after: { kind: row.kind, userId, state: 'open' },
      reason,
      correlationId,
    });
    return ok({ flagId: row.flagId });
  });
}

/**
 * AC4.9.1 / AC8.11.1: clear (the hold is lifted); AC8.11.2: ban (the account is suspended);
 * reinstate (a banned account's suspension is lifted).
 */
export async function decideFlag(
  actor: Actor,
  raw: DecideFlagInput,
  correlationId: string,
): Promise<Result<{ state: string }, FraudError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.fraud.forbidden'));
  const input = DecideFlagInput.parse(raw);
  if (!isFraudReason(input.reason)) return err(withKey('VALIDATION_FAILED', 'errors.fraud.reason'));
  const reason = input.reason.trim();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const flag = await repo.forUpdate(exec, input.flagId);
    if (!flag) return err(withKey('NOT_FOUND', 'errors.fraud.noFlag'));
    const next = nextFraudState(flag.state, input.action);
    if (!next) return err(withKey('INVALID_STATE', 'errors.fraud.decided'));
    const at = new Date();
    // IdentityAccess first: an error result does not roll the transaction back, so nothing is
    // written to the flag until the account change has succeeded.
    if (next === 'banned') {
      // The account is suspended (reversible): it cannot sign in and its sessions end.
      const suspended = await suspendAccount(tx, actor, {
        userId: flag.userId,
        reason,
        source: `fraud_flag:${flag.flagId}`,
      });
      if (!suspended.ok)
        return err(
          suspended.error.code === 'NOT_FOUND'
            ? withKey('NOT_FOUND', 'errors.fraud.noUser')
            : suspended.error.code === 'INVALID_STATE'
              ? withKey('INVALID_STATE', 'errors.fraud.self')
              : withKey('FORBIDDEN', 'errors.fraud.forbidden'),
        );
    }
    if (next === 'reinstated') {
      // INVALID_STATE (already lifted, e.g. through another banned flag of the account) is fine.
      const lifted = await reinstateAccount(tx, actor, {
        userId: flag.userId,
        reason,
      });
      if (!lifted.ok && lifted.error.code === 'FORBIDDEN')
        return err(withKey('FORBIDDEN', 'errors.fraud.forbidden'));
      await repo.reinstate(exec, flag.flagId, {
        reinstateReason: reason,
        reinstatedBy: actor.userId,
        reinstatedAt: at,
      });
    } else {
      await repo.decide(exec, flag.flagId, {
        state: next,
        decisionReason: reason,
        decidedBy: actor.userId,
        decidedAt: at,
      });
    }
    await audit.record(tx, {
      actorId: actor.userId,
      action: `trustops.fraud.${next}`,
      subjectType: 'fraud_flag',
      subjectId: flag.flagId,
      before: { state: flag.state },
      after: { state: next, kind: flag.kind, userId: flag.userId },
      reason,
      correlationId,
    });
    return ok({ state: next });
  });
}

export type FlagView = Omit<FlagRow, 'flaggedAt' | 'decidedAt' | 'reinstatedAt'> & {
  flaggedAt: string;
  decidedAt: string | null;
  reinstatedAt: string | null;
  name: string;
};

export type FraudQueue = {
  open: FlagView[];
  decided: FlagView[];
  /** Accounts banned now (suspended); each can be reinstated. */
  banned: FlagView[];
  /** When a flag was last raised or decided (the queue has no automatic check). */
  lastReviewAt: string | null;
};

export async function fraudQueue(
  actor: Actor,
  raw: FraudQueueInput,
): Promise<Result<FraudQueue, FraudError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.fraud.forbidden'));
  const input = FraudQueueInput.parse(raw);
  const db = getDb();
  const [open, decided, banned] = await Promise.all([
    repo.open(db, input.kind),
    repo.recentlyDecided(db, 20),
    repo.banned(db, 200),
  ]);
  const names = await getIdentity().displayNamesOf([
    ...new Set([...open, ...decided, ...banned].map((f) => f.userId)),
  ]);
  const view = (f: FlagRow): FlagView => ({
    ...f,
    flaggedAt: f.flaggedAt.toISOString(),
    decidedAt: f.decidedAt?.toISOString() ?? null,
    reinstatedAt: f.reinstatedAt?.toISOString() ?? null,
    name: names[f.userId] ?? '',
  });
  const times = [...open.map((f) => f.flaggedAt), ...decided.map((f) => f.decidedAt as Date)].map(
    (d) => d.getTime(),
  );
  return ok({
    open: open.map(view),
    decided: decided.filter((f) => !input.kind || f.kind === input.kind).map(view),
    banned: banned.filter((f) => !input.kind || f.kind === input.kind).map(view),
    lastReviewAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  });
}
