// Goal streak (FR5.1), streak-shields (FR5.3) and streak-tokens (US5.16).
//
// The streak is computed from the Student's own recorded activity for the courses of their current
// Goal (lessons, quizzes, live classes) and their Vault practice for that Goal. Everything is lazy:
// there is no midnight job. Each read
// - uses a shield for every newly missed whole day inside a live run, and records the use, and
// - credits the daily tokens for each counted day of the last week not yet credited, once per day
//   across all Goals (the first qualifying activity of the day earns them).
// Battles and live quizzes call the token and shield functions below inside their own transaction.
import { getPublishedCourse } from '#src/features/catalog/index.ts';
import { listActiveEnrolments, listTrialsOf } from '#src/features/commerce/index.ts';
import { getCurrentGoal } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { settings } from '#src/features/platform/index.ts';
import { shieldIneligible } from '#src/features/trustops/index.ts';
import { ok, type Result } from '#src/lib/result.ts';
import type { Executor } from '#src/server/db.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import type { TokenReason } from '#src/server/schema/index.ts';
import { createBuddyRepository } from '../data/buddy.repository.ts';
import { createRewardsRepository, type TokenChange } from '../data/rewards.repository.ts';
import { activityDays } from '../data/streak.repository.ts';
import {
  type BuddyRounding,
  buddyBonus,
  isBuddyRounding,
  isPairActiveOn,
} from '../domain/buddy.ts';
import { RETENTION_SETTINGS } from '../domain/retention-settings.ts';
import { computeStreak, dhakaDay, type Streak, shiftDay } from '../domain/streak.ts';

const rewards = createRewardsRepository();
const buddies = createBuddyRepository();
/** How far back an uncredited counted day still earns its daily tokens. */
const CREDIT_WINDOW_DAYS = 7;

export type GoalStreak = Streak & {
  goalId: string | null;
  tokens: number;
  shieldsAvailable: number;
};

async function readSetting(key: typeof RETENTION_SETTINGS.dailyTokens): Promise<number> {
  const r = await settings().get(key);
  return r.ok ? r.value.value : (key.defaultValue ?? 0);
}

export const dailyTokenAmount = () => readSetting(RETENTION_SETTINGS.dailyTokens);
export const battleEntryTokens = () => readSetting(RETENTION_SETTINGS.battleEntryTokens);
export const shieldTopN = () => readSetting(RETENTION_SETTINGS.shieldTopN);
export const videoBadgeSeconds = () => readSetting(RETENTION_SETTINGS.videoBadgeSeconds);
/** The buddy-day rounding rule; anything unexpected falls back to half_up. */
export async function buddyRounding(): Promise<BuddyRounding> {
  const r = await settings().get(RETENTION_SETTINGS.buddyRounding);
  return r.ok && isBuddyRounding(r.value.value) ? r.value.value : 'half_up';
}

/** The counted days of the Student's current Goal (null without a Goal). */
export async function goalDays(userId: string) {
  const goal = await getCurrentGoal(userId);
  if (!goal.ok) return null;
  const selectedAt = new Date(goal.value.selectedAt);
  // Paid enrolments and free trials both count: a trial Student is studying this Goal too.
  const [enrolments, trials] = await Promise.all([
    listActiveEnrolments(userId),
    listTrialsOf(userId),
  ]);
  const courseIds = [...new Set([...enrolments, ...trials].map((e) => e.courseId))];
  const courses = await Promise.all(courseIds.map((id) => getPublishedCourse(id)));
  const goalCourseIds = courses.flatMap((c) =>
    c.ok && c.value.goal.goalId === goal.value.goalId ? [c.value.courseId] : [],
  );
  // Only the last 400 days matter for "best" and the current run; older history is not read.
  const horizon = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const since = selectedAt > horizon ? selectedAt : horizon;
  const days = await activityDays(getDb(), userId, goalCourseIds, goal.value.goalId, since);
  return { goalId: goal.value.goalId, days, sinceDay: dhakaDay(selectedAt) };
}

/** Reads the streak and settles it: records new shield uses and credits uncredited days. */
export async function syncStreak(userId: string, now = new Date()): Promise<GoalStreak> {
  const today = dhakaDay(now);
  const counted = await goalDays(userId);
  const daily = await dailyTokenAmount();
  const from = shiftDay(today, -(CREDIT_WINDOW_DAYS - 1));
  // Buddy days in the credit window: the pair counted that day and both of us studied (US5.13).
  const bonus = daily > 0 ? buddyBonus(daily, await buddyRounding()) : 0;
  const buddyDays = new Set<string>();
  if (bonus > 0 && counted) {
    const pairs = await buddies.pairsOf(getDb(), userId, { activeAfterDay: shiftDay(from, -1) });
    for (const pair of pairs) {
      const theirs = new Set((await goalDays(pair.buddyId))?.days ?? []);
      for (const day of counted.days)
        if (day >= from && theirs.has(day) && isPairActiveOn(pair, day)) buddyDays.add(day);
    }
  }
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    // Lock the Student's account first: concurrent reads settle one after the other.
    await rewards.lockAccount(exec, userId);
    const shields = await rewards.shieldsOf(exec, userId);
    const streak = computeStreak(counted?.days ?? [], today, counted?.sinceDay ?? today, {
      usedDays: shields.flatMap((s) => (s.usedForDay ? [s.usedForDay] : [])),
      available: shields
        .filter((s) => !s.usedForDay)
        .map((s) => ({ shieldId: s.shieldId, earnedDay: dhakaDay(s.earnedAt) })),
    });
    const used = counted ? await rewards.recordShieldUses(exec, userId, streak.newUses, now) : 0;
    if (daily > 0 && counted) {
      const credited = await rewards.creditedDays(exec, userId, from);
      for (const day of [...new Set(counted.days)].sort())
        if (day >= from && day <= today && !credited.has(day))
          await rewards.change(exec, { userId, delta: daily, reason: 'daily', ref: day, at: now });
      // The buddy top-up: once per day (a repeat is ignored by the ledger's unique key).
      for (const day of [...buddyDays].sort())
        await rewards.change(exec, {
          userId,
          delta: bonus,
          reason: 'buddy_bonus',
          ref: day,
          at: now,
        });
    }
    const { newUses: _ignored, ...view } = streak;
    return {
      ...view,
      goalId: counted?.goalId ?? null,
      tokens: await rewards.balance(exec, userId),
      shieldsAvailable: shields.filter((s) => !s.usedForDay).length - used,
    };
  });
}

export async function getGoalStreak(actor: Actor): Promise<Result<GoalStreak, never>> {
  return ok(await syncStreak(actor.userId));
}

export type MyRewards = {
  streak: GoalStreak;
  dailyTokens: number;
  battleEntryTokens: number;
  shieldTopN: number;
  shields: Array<{ earnedAt: string; usedForDay: string | null }>;
  history: Array<{ delta: number; reason: TokenReason; ref: string; at: string; balance: number }>;
};

/** Me → Streak (S8): streak, shields with the days they forgave, and the token history. */
export async function getMyRewards(actor: Actor): Promise<Result<MyRewards, never>> {
  const streak = await syncStreak(actor.userId);
  const db = getDb();
  const [shields, entries, daily, entry, topN] = await Promise.all([
    rewards.shieldsOf(db, actor.userId),
    rewards.recentEntries(db, actor.userId, 30),
    dailyTokenAmount(),
    battleEntryTokens(),
    shieldTopN(),
  ]);
  return ok({
    streak,
    dailyTokens: daily,
    battleEntryTokens: entry,
    shieldTopN: topN,
    shields: shields
      .map((s) => ({ earnedAt: s.earnedAt.toISOString(), usedForDay: s.usedForDay }))
      .reverse(),
    history: entries.map((e) => ({
      delta: e.delta,
      reason: e.reason,
      ref: e.ref,
      at: e.createdAt.toISOString(),
      balance: e.balanceAfter,
    })),
  });
}

// ----------------------------------------------------------------- for other features

/** Debits tokens once per (reason, ref) inside the caller's transaction; refused when short. */
export function spendTokens(
  exec: Executor,
  input: { userId: string; amount: number; reason: TokenReason; ref: string; at: Date },
): Promise<TokenChange> {
  return rewards.change(exec, {
    userId: input.userId,
    delta: -input.amount,
    reason: input.reason,
    ref: input.ref,
    at: input.at,
  });
}

/** Gives back a debit made earlier for `ref` (if any), at most once. */
export async function refundTokens(
  exec: Executor,
  input: { userId: string; spentAs: TokenReason; refundAs: TokenReason; ref: string; at: Date },
): Promise<TokenChange | null> {
  await rewards.lockAccount(exec, input.userId);
  const spent = await rewards.entryOf(exec, input.userId, input.spentAs, input.ref);
  if (!spent || spent.delta >= 0) return null;
  return rewards.change(exec, {
    userId: input.userId,
    delta: -spent.delta,
    reason: input.refundAs,
    ref: input.ref,
    at: input.at,
  });
}

/** Locks the Student's token account for the caller's transaction and returns its balance. */
export function lockTokenAccount(exec: Executor, userId: string): Promise<number> {
  return rewards.lockAccount(exec, userId);
}

export function tokenBalance(userId: string): Promise<number> {
  return rewards.balance(getDb(), userId);
}

/**
 * Hands one streak-shield to each winner of a live quiz (idempotent per quiz and Student). A winner
 * an Admin flagged for collusion is not eligible while the flag is open (US5.15, US8.11).
 */
export async function awardQuizShields(
  exec: Executor,
  quizId: string,
  userIds: readonly string[],
  at: Date,
): Promise<number> {
  const ineligible = await shieldIneligible(exec, userIds);
  return rewards.awardShields(
    exec,
    userIds.filter((id) => !ineligible.has(id)),
    'live_quiz',
    quizId,
    at,
  );
}

/** Live-class attendance counts as the day's qualifying activity for that course. */
export function recordLiveActivity(
  exec: Executor,
  userId: string,
  courseId: string,
  at: Date,
): Promise<void> {
  return rewards.recordActivity(exec, { userId, courseId, kind: 'live', day: dhakaDay(at), at });
}
