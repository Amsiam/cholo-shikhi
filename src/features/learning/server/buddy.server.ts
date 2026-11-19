// Study buddies (FR5.6; US5.12–US5.14), screen S12 Me → Study buddy.
// - Invite: a Student with a Goal creates a six-character code (valid 7 days) and shares it.
// - Accept: a friend in the same Goal-segment enters the code, sees the inviter's masked name and
//   accepts; the pair counts from today. Nobody can be looked up by email or phone, so an invite
//   never reveals whether an account exists.
// - One pair at a time: inviting or accepting while paired is refused ("end your pair first").
// - End: either buddy ends the pair; it stops counting from tomorrow (Asia/Dhaka), so today's
//   bonus still applies, and the former buddy sees that it ended.
// Pairing changes lock both Students' token accounts (in ID order), so concurrent accepts and ends
// are applied one after the other; the open-member unique index is the last line of defence.
import { getCurrentGoal } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { maskName } from '#src/lib/mask-name.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createBuddyRepository } from '../data/buddy.repository.ts';
import { createRewardsRepository } from '../data/rewards.repository.ts';
import {
  buddyDailyTokens,
  INVITE_DAYS,
  makeInviteCode,
  normaliseInviteCode,
} from '../domain/buddy.ts';
import { dhakaDay, shiftDay } from '../domain/streak.ts';
import { BuddyCodeInput } from './learning.schema.ts';
import { buddyRounding, dailyTokenAmount, goalDays, syncStreak } from './streak.server.ts';

const repo = createBuddyRepository();
const rewards = createRewardsRepository();
type BuddyError = AppError<'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN'>;
const withKey = <C extends BuddyError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});

async function nameOf(userId: string): Promise<string> {
  const names = await getIdentity().displayNamesOf([userId]);
  return maskName(names[userId] ?? '');
}

export type MyBuddy = {
  hasGoal: boolean;
  /** The current pair (still counting today), if any. */
  pair: {
    buddyName: string;
    sinceDay: string;
    /** Set once either buddy ended it: the first day it no longer counts. */
    endsDay: string | null;
    today: { me: boolean; buddy: boolean };
  } | null;
  /** The most recent pair that has ended (shown when there is no current pair). */
  ended: { buddyName: string; lastDay: string } | null;
  invite: { code: string; expiresAt: string } | null;
  dailyTokens: number;
  buddyDayTokens: number;
};

export async function getMyBuddy(actor: Actor): Promise<Result<MyBuddy, never>> {
  const now = new Date();
  const today = dhakaDay(now);
  const db = getDb();
  const [goal, current, ended, invite, daily, rounding] = await Promise.all([
    getCurrentGoal(actor.userId),
    repo.currentPair(db, actor.userId, today),
    repo.lastEndedPair(db, actor.userId, today),
    repo.openInviteOf(db, actor.userId, now),
    dailyTokenAmount(),
    buddyRounding(),
  ]);
  let pair: MyBuddy['pair'] = null;
  if (current) {
    const [mine, theirs, buddyName] = await Promise.all([
      syncStreak(actor.userId, now),
      goalDays(current.buddyId),
      nameOf(current.buddyId),
    ]);
    pair = {
      buddyName,
      sinceDay: current.startsDay,
      endsDay: current.endsDay,
      today: { me: mine.isActiveToday, buddy: (theirs?.days ?? []).includes(today) },
    };
  }
  return ok({
    hasGoal: goal.ok,
    pair,
    ended:
      !current && ended?.endsDay
        ? { buddyName: await nameOf(ended.buddyId), lastDay: shiftDay(ended.endsDay, -1) }
        : null,
    invite:
      invite && !current ? { code: invite.code, expiresAt: invite.expiresAt.toISOString() } : null,
    dailyTokens: daily,
    buddyDayTokens: buddyDailyTokens(daily, rounding),
  });
}

/** Creates (or returns the open) invite code. Needs a Goal and no current pair. */
export async function createBuddyInvite(
  actor: Actor,
): Promise<Result<{ code: string; expiresAt: string }, BuddyError>> {
  const goal = await getCurrentGoal(actor.userId);
  if (!goal.ok) return err(withKey('INVALID_STATE', 'errors.buddy.noGoal'));
  const now = new Date();
  const today = dhakaDay(now);
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    await rewards.lockAccount(exec, actor.userId);
    if (await repo.currentPair(exec, actor.userId, today))
      return err(withKey('INVALID_STATE', 'errors.buddy.alreadyPaired'));
    const open = await repo.openInviteOf(exec, actor.userId, now);
    if (open) return ok({ code: open.code, expiresAt: open.expiresAt.toISOString() });
    await repo.closeExpired(exec, now);
    for (let tries = 0; tries < 5; tries += 1) {
      const code = makeInviteCode(Math.random);
      if (await repo.codeTaken(exec, code)) continue;
      const row = await repo.insertInvite(exec, {
        inviterId: actor.userId,
        code,
        segmentId: goal.value.segmentId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
      });
      return ok({ code: row.code, expiresAt: row.expiresAt.toISOString() });
    }
    return err(withKey('INVALID_STATE', 'errors.buddy.tryAgain'));
  });
}

export async function cancelBuddyInvite(actor: Actor): Promise<Result<{ cancelled: true }, never>> {
  await repo.closeInvites(getDb(), actor.userId, new Date());
  return ok({ cancelled: true as const });
}

/** Checks an invite code for the caller; the same rules as accepting. */
async function checkInvite(
  exec: Parameters<typeof repo.inviteByCode>[0],
  actor: Actor,
  code: string,
  now: Date,
) {
  const invite = await repo.inviteByCode(exec, normaliseInviteCode(code), now);
  if (!invite) return err(withKey('NOT_FOUND', 'errors.buddy.codeNotFound'));
  if (invite.inviterId === actor.userId)
    return err(withKey('INVALID_STATE', 'errors.buddy.ownCode'));
  const [mine, theirs] = await Promise.all([
    getCurrentGoal(actor.userId),
    getCurrentGoal(invite.inviterId),
  ]);
  if (!mine.ok) return err(withKey('INVALID_STATE', 'errors.buddy.noGoal'));
  // AC5.12.2: both Students must be in the same Goal-segment (the inviter's current one).
  if (!theirs.ok || mine.value.segmentId !== theirs.value.segmentId)
    return err(withKey('FORBIDDEN', 'errors.buddy.otherSegment'));
  const today = dhakaDay(now);
  // AC5.12.3: one pair at a time, for either Student.
  if (await repo.currentPair(exec, actor.userId, today))
    return err(withKey('INVALID_STATE', 'errors.buddy.alreadyPaired'));
  if (await repo.currentPair(exec, invite.inviterId, today))
    return err(withKey('INVALID_STATE', 'errors.buddy.inviterPaired'));
  return ok({ invite, segmentId: mine.value.segmentId });
}

export async function previewBuddyInvite(
  actor: Actor,
  raw: BuddyCodeInput,
): Promise<Result<{ inviterName: string }, BuddyError>> {
  const input = BuddyCodeInput.parse(raw);
  const checked = await checkInvite(getDb(), actor, input.code, new Date());
  if (!checked.ok) return checked;
  return ok({ inviterName: await nameOf(checked.value.invite.inviterId) });
}

export async function acceptBuddyInvite(
  actor: Actor,
  raw: BuddyCodeInput,
): Promise<Result<{ paired: true }, BuddyError>> {
  const input = BuddyCodeInput.parse(raw);
  const now = new Date();
  const invite = await repo.inviteByCode(getDb(), normaliseInviteCode(input.code), now);
  if (!invite) return err(withKey('NOT_FOUND', 'errors.buddy.codeNotFound'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    for (const userId of [actor.userId, invite.inviterId].sort())
      await rewards.lockAccount(exec, userId);
    const checked = await checkInvite(exec, actor, input.code, now);
    if (!checked.ok) return checked;
    await repo.createPair(exec, {
      segmentId: checked.value.segmentId,
      startsDay: dhakaDay(now),
      userIds: [invite.inviterId, actor.userId],
    });
    await repo.closeInvites(exec, invite.inviterId, now, actor.userId);
    await repo.closeInvites(exec, actor.userId, now);
    return ok({ paired: true as const });
  });
}

/** AC5.14.1: either buddy ends the pair; it stops counting from tomorrow. */
export async function endBuddyPair(actor: Actor): Promise<Result<{ endsDay: string }, BuddyError>> {
  const now = new Date();
  const today = dhakaDay(now);
  const tomorrow = shiftDay(today, 1);
  const current = await repo.currentPair(getDb(), actor.userId, today);
  if (!current) return err(withKey('NOT_FOUND', 'errors.buddy.noPair'));
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    for (const userId of [actor.userId, current.buddyId].sort())
      await rewards.lockAccount(exec, userId);
    const pair = await repo.currentPair(exec, actor.userId, today);
    if (!pair) return err(withKey('NOT_FOUND', 'errors.buddy.noPair'));
    if (pair.endsDay) return ok({ endsDay: pair.endsDay });
    await repo.endPair(exec, pair.pairId, tomorrow, actor.userId);
    return ok({ endsDay: tomorrow });
  });
}
