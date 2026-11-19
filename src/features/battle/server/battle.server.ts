// Quiz battles (U7): quick matches, friend rooms (join code) and staff-hosted battles. Matching stays
// inside the Student's battle band (FR-RTN-5). Every player gets the same questions and time and
// answers at their own pace; answers stay hidden from everyone until the battle is over. A quick
// match costs streak-tokens (an Admin setting, 0 = free), taken atomically on entry and given back
// in full if no opponent is found within 90 seconds or the Student leaves before it starts (US5.8).
// Friend rooms and staff-hosted battles are free. Lifecycle moves forward lazily on every read.
import {
  bankQuestionsByIds,
  battleQuestionPool,
  recordBankAnswer,
  type StudentQuestion,
  topicFamilyOf,
  topicNamesOf,
  toStudentQuestion,
} from '#src/features/assessment/index.ts';
import { getActiveGoal, getCurrentGoal, getSegment } from '#src/features/goals/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getIdentity } from '#src/features/identity-access/index.ts';
import {
  activeVaultBankQuestionIds,
  battleEntryTokens,
  lockTokenAccount,
  recordBankMistake,
  refundTokens,
  spendTokens,
  tokenBalance,
} from '#src/features/learning/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Executor } from '#src/server/db.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { dhakaLocalToUtc, maskName } from '../../assessment/domain/exam.ts';
import {
  type BattleRow,
  createBattleRepository,
  type PlayerRow,
} from '../data/battle.repository.ts';
import {
  type BattleClock,
  type BattleStatus,
  canJoin,
  chooseQuestions,
  DEFAULT_QUESTIONS,
  durationSecondsFor,
  effectiveStatus,
  MAX_PLAYERS,
  makeJoinCode,
  normaliseJoinCode,
  QUICK_WAIT_MS,
  rankStandings,
} from '../domain/battle.ts';
import {
  BattleAnswerInput,
  BattleRef,
  CreateRoomInput,
  JoinByCodeInput,
  QuickMatchInput,
  ScheduleBattleInput,
} from './battle.schema.ts';

const repo = createBattleRepository();
type BattleError = AppError<'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE' | 'VALIDATION_FAILED'>;
const withKey = <C extends BattleError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const ANSWER_GRACE_MS = 15_000;

/** The Student's current goal and its battle band. */
async function tierOf(userId: string) {
  const goal = await getCurrentGoal(userId);
  if (!goal.ok) return null;
  const segment = await getSegment(goal.value.segmentId);
  if (!segment.ok) return null;
  return { goalId: goal.value.goalId, band: segment.value.battleBand };
}

const clockOf = (b: BattleRow, playerCount: number): BattleClock => ({
  mode: b.mode,
  status: b.status,
  createdAt: b.createdAt,
  startsAt: b.startsAt,
  endsAt: b.endsAt,
  playerCount,
});

function correctOf(answers: Record<string, number>, key: Map<string, number>): number {
  return Object.entries(answers).filter(([id, chosen]) => key.get(id) === chosen).length;
}

async function keyOf(questionIds: readonly string[]): Promise<Map<string, number>> {
  return new Map(
    (await bankQuestionsByIds(questionIds)).map((q) => [q.questionId, q.correctIndex]),
  );
}

/** Draws the battle's questions: the players' vaults first when asked for, then the bank. */
async function drawQuestions(b: BattleRow, playerIds: readonly string[]): Promise<string[]> {
  const pool = await battleQuestionPool(b.goalId, b.topicId);
  const vault =
    b.source === 'vault'
      ? await activeVaultBankQuestionIds(
          playerIds,
          b.topicId ? await topicFamilyOf(b.topicId) : null,
        )
      : [];
  return chooseQuestions(vault, pool, b.questionCount, Math.random);
}

/** Gives a quick-match entry fee back (no-op when nothing was paid, or it was already returned). */
async function refundEntry(exec: Executor, battleId: string, userId: string, now: Date) {
  await refundTokens(exec, {
    userId,
    spentAs: 'battle_entry',
    refundAs: 'battle_refund',
    ref: battleId,
    at: now,
  });
}

/** Moves a battle's stored status forward to what the clock says (locked, inside a transaction). */
async function advance(exec: Executor, battleId: string, now: Date): Promise<BattleRow | null> {
  const b = await repo.forUpdate(exec, battleId);
  if (!b) return null;
  const players = await repo.players(exec, battleId);
  let status: BattleStatus = effectiveStatus(clockOf(b, players.length), now);
  // Everyone finished early: the battle is over.
  if (status === 'running' && players.length > 0 && players.every((p) => p.finishedAt))
    status = 'finished';
  if (status === b.status) return b;
  const patch: Partial<BattleRow> = { status };
  // No opponent in time: every waiting player gets their entry back.
  if (status === 'cancelled' && b.mode === 'quick')
    for (const p of players) await refundEntry(exec, battleId, p.userId, now);
  if (status === 'finished') {
    const key = await keyOf(b.questionIds);
    for (const p of players)
      if (!p.finishedAt)
        await repo.updatePlayer(exec, battleId, p.userId, {
          finishedAt: b.endsAt && b.endsAt < now ? b.endsAt : now,
          correctCount: correctOf(p.answers, key),
        });
  }
  await repo.update(exec, battleId, patch);
  return { ...b, ...patch };
}

async function startNow(exec: Executor, b: BattleRow, playerIds: readonly string[], now: Date) {
  const questionIds = b.questionIds.length > 0 ? b.questionIds : await drawQuestions(b, playerIds);
  const endsAt = new Date(now.getTime() + b.durationSeconds * 1000);
  await repo.update(exec, b.battleId, { status: 'running', startsAt: now, endsAt, questionIds });
}

// ================================================================= Students

export type BattleSummary = {
  battleId: string;
  mode: BattleRow['mode'];
  status: BattleStatus;
  titleBn: string | null;
  titleEn: string | null;
  topicBn: string | null;
  topicEn: string | null;
  questionCount: number;
  durationSeconds: number;
  startsAt: string | null;
  endsAt: string | null;
  players: number;
  isMine: boolean;
};

export type BattleHome = {
  hasGoal: boolean;
  band: string | null;
  /** A battle the Student is in that has not ended (to resume). */
  current: BattleSummary | null;
  /** The Student's streak-token balance and what a quick match costs. */
  tokens: number;
  entryTokens: number;
  hosted: BattleSummary[];
  recent: Array<BattleSummary & { myRank: number | null }>;
};

async function summaries(
  rows: readonly BattleRow[],
  userId: string,
  now: Date,
): Promise<BattleSummary[]> {
  const db = getDb();
  const counts = await repo.playerCounts(
    db,
    rows.map((r) => r.battleId),
  );
  const topics = await topicNamesOf([
    ...new Set(rows.flatMap((r) => (r.topicId ? [r.topicId] : []))),
  ]);
  return rows.map((b) => {
    const n = counts.get(b.battleId) ?? 0;
    return {
      battleId: b.battleId,
      mode: b.mode,
      status: effectiveStatus(clockOf(b, n), now),
      titleBn: b.titleBn,
      titleEn: b.titleEn,
      topicBn: b.topicId ? (topics[b.topicId]?.nameBn ?? null) : null,
      topicEn: b.topicId ? (topics[b.topicId]?.nameEn ?? null) : null,
      questionCount: b.questionCount,
      durationSeconds: b.durationSeconds,
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      players: n,
      isMine: b.hostId === userId,
    };
  });
}

export async function battleHome(actor: Actor): Promise<Result<BattleHome, never>> {
  const tier = await tierOf(actor.userId);
  const db = getDb();
  const now = new Date();
  // Settle quick matches that ran out of time, so their entry fees come back before showing the balance.
  for (const b of await repo.battlesOf(db, actor.userId, 20))
    if (b.status === 'waiting' && b.mode === 'quick')
      await withTransaction(db, async (tx) => advance(unwrapTx(tx), b.battleId, now));
  const mine = await repo.battlesOf(db, actor.userId, 20);
  const mineSummaries = await summaries(mine, actor.userId, now);
  const current =
    mineSummaries.find((s) => s.status === 'waiting' || s.status === 'running') ?? null;
  const recent = await Promise.all(
    mineSummaries
      .filter((s) => s.status === 'finished')
      .slice(0, 10)
      .map(async (s) => {
        const players = await repo.players(db, s.battleId);
        const ranked = rankStandings(
          players.map((p) => ({
            userId: p.userId,
            correct: p.correctCount ?? 0,
            tookMs: tookMsOf(p, mine.find((b) => b.battleId === s.battleId) as BattleRow),
            finished: p.finishedAt !== null,
          })),
        );
        return { ...s, myRank: ranked.find((r) => r.userId === actor.userId)?.rank ?? null };
      }),
  );
  const hosted = tier
    ? await summaries(await repo.openHosted(db, tier.band), actor.userId, now)
    : [];
  const [tokens, entryTokens] = await Promise.all([
    tokenBalance(actor.userId),
    battleEntryTokens(),
  ]);
  return ok({
    hasGoal: tier !== null,
    band: tier?.band ?? null,
    current,
    hosted,
    recent,
    tokens,
    entryTokens,
  });
}

function tookMsOf(p: PlayerRow, b: BattleRow): number {
  if (!p.finishedAt || !b.startsAt) return Number.MAX_SAFE_INTEGER;
  return p.finishedAt.getTime() - Math.max(b.startsAt.getTime(), p.joinedAt.getTime());
}

/** Quick match: takes a free seat in a waiting match of the same band and settings, or opens one. */
export async function quickMatch(
  actor: Actor,
  raw: QuickMatchInput,
): Promise<Result<{ battleId: string }, BattleError>> {
  const input = QuickMatchInput.parse(raw);
  const tier = await tierOf(actor.userId);
  if (!tier) return err(withKey('INVALID_STATE', 'errors.battle.noGoal'));
  const topicId = input.topicId ?? null;
  if ((await battleQuestionPool(tier.goalId, topicId)).length === 0)
    return err(withKey('INVALID_STATE', 'errors.battle.noQuestions'));
  const now = new Date();
  const entry = await battleEntryTokens();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    // The token account lock serialises a Student's requests: two tabs pay once (AC5.8.4).
    const balance = await lockTokenAccount(exec, actor.userId);
    for (const mine of await repo.battlesOf(exec, actor.userId, 5)) {
      const players = await repo.players(exec, mine.battleId);
      const status = effectiveStatus(clockOf(mine, players.length), now);
      if (mine.mode === 'quick' && (status === 'waiting' || status === 'running'))
        return ok({ battleId: mine.battleId });
    }
    if (balance < entry) return err(withKey('INVALID_STATE', 'errors.battle.notEnoughTokens'));
    const pay = async (battleId: string) => {
      if (entry > 0)
        await spendTokens(exec, {
          userId: actor.userId,
          amount: entry,
          reason: 'battle_entry',
          ref: battleId,
          at: now,
        });
    };
    const seat = await repo.claimQuickSeat(exec, {
      band: tier.band,
      topicId,
      source: input.source,
      userId: actor.userId,
      since: new Date(now.getTime() - QUICK_WAIT_MS),
    });
    if (seat) {
      await repo.addPlayer(exec, seat.battleId, actor.userId);
      await pay(seat.battleId);
      const players = await repo.players(exec, seat.battleId);
      if (players.length >= seat.maxPlayers)
        await startNow(
          exec,
          seat,
          players.map((p) => p.userId),
          now,
        );
      return ok({ battleId: seat.battleId });
    }
    const created = await repo.insert(exec, {
      mode: 'quick',
      band: tier.band,
      goalId: tier.goalId,
      hostId: actor.userId,
      topicId,
      source: input.source,
      questionCount: DEFAULT_QUESTIONS,
      durationSeconds: durationSecondsFor(DEFAULT_QUESTIONS),
      maxPlayers: MAX_PLAYERS.quick,
    });
    await repo.addPlayer(exec, created.battleId, actor.userId);
    await pay(created.battleId);
    return ok({ battleId: created.battleId });
  });
}

/** A friend room: a join code to share; the host starts it once a friend is in. */
export async function createRoom(
  actor: Actor,
  raw: CreateRoomInput,
): Promise<Result<{ battleId: string; code: string }, BattleError>> {
  const input = CreateRoomInput.parse(raw);
  const tier = await tierOf(actor.userId);
  if (!tier) return err(withKey('INVALID_STATE', 'errors.battle.noGoal'));
  const topicId = input.topicId ?? null;
  if ((await battleQuestionPool(tier.goalId, topicId)).length === 0)
    return err(withKey('INVALID_STATE', 'errors.battle.noQuestions'));
  for (let tries = 0; tries < 5; tries += 1) {
    const code = makeJoinCode(Math.random);
    if (await repo.byOpenCode(getDb(), code)) continue;
    const b = await withTransaction(getDb(), async (tx) => {
      const exec = unwrapTx(tx);
      const created = await repo.insert(exec, {
        mode: 'friend',
        band: tier.band,
        goalId: tier.goalId,
        hostId: actor.userId,
        code,
        topicId,
        source: input.source,
        questionCount: input.questionCount,
        durationSeconds: durationSecondsFor(input.questionCount),
        maxPlayers: MAX_PLAYERS.friend,
      });
      await repo.addPlayer(exec, created.battleId, actor.userId);
      return created;
    });
    return ok({ battleId: b.battleId, code });
  }
  return err(withKey('INVALID_STATE', 'errors.battle.tryAgain'));
}

async function joinBattle(
  actor: Actor,
  battleId: string,
): Promise<Result<{ battleId: string }, BattleError>> {
  const tier = await tierOf(actor.userId);
  if (!tier) return err(withKey('INVALID_STATE', 'errors.battle.noGoal'));
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const b = await advance(exec, battleId, now);
    if (!b || b.mode === 'quick') return err(withKey('NOT_FOUND', 'errors.battle.codeNotFound'));
    if (b.band !== tier.band) return err(withKey('FORBIDDEN', 'errors.battle.otherBand'));
    const players = await repo.players(exec, battleId);
    if (players.some((p) => p.userId === actor.userId)) return ok({ battleId });
    if (!canJoin(clockOf(b, players.length), b.maxPlayers, now))
      return err(withKey('INVALID_STATE', 'errors.battle.notOpen'));
    await repo.addPlayer(exec, battleId, actor.userId);
    return ok({ battleId });
  });
}

export async function joinByCode(
  actor: Actor,
  raw: JoinByCodeInput,
): Promise<Result<{ battleId: string }, BattleError>> {
  const input = JoinByCodeInput.parse(raw);
  const b = await repo.byOpenCode(getDb(), normaliseJoinCode(input.code));
  if (!b) return err(withKey('NOT_FOUND', 'errors.battle.codeNotFound'));
  return joinBattle(actor, b.battleId);
}

export async function joinHosted(
  actor: Actor,
  raw: BattleRef,
): Promise<Result<{ battleId: string }, BattleError>> {
  const input = BattleRef.parse(raw);
  const b = await repo.byId(getDb(), input.battleId);
  if (b?.mode !== 'hosted') return err(appError('NOT_FOUND'));
  return joinBattle(actor, b.battleId);
}

/** The host of a friend room starts it once at least two players are in. */
export async function startRoom(
  actor: Actor,
  raw: BattleRef,
): Promise<Result<{ battleId: string }, BattleError>> {
  const input = BattleRef.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const b = await advance(exec, input.battleId, now);
    if (b?.mode !== 'friend') return err(appError('NOT_FOUND'));
    if (b.hostId !== actor.userId) return err(withKey('FORBIDDEN', 'errors.battle.notHost'));
    if (b.status !== 'waiting') return err(withKey('INVALID_STATE', 'errors.battle.notOpen'));
    const players = await repo.players(exec, b.battleId);
    if (players.length < 2) return err(withKey('INVALID_STATE', 'errors.battle.needTwo'));
    await startNow(
      exec,
      b,
      players.map((p) => p.userId),
      now,
    );
    return ok({ battleId: b.battleId });
  });
}

/** Leaves a battle that has not started (a host leaving a friend room closes it). */
export async function leaveBattle(
  actor: Actor,
  raw: BattleRef,
): Promise<Result<{ left: true }, BattleError>> {
  const input = BattleRef.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const b = await advance(exec, input.battleId, now);
    if (!b || !(await repo.player(exec, b.battleId, actor.userId)))
      return err(appError('NOT_FOUND'));
    if (b.status !== 'waiting') return err(withKey('INVALID_STATE', 'errors.battle.notOpen'));
    await repo.removePlayer(exec, b.battleId, actor.userId);
    if (b.mode === 'quick') await refundEntry(exec, b.battleId, actor.userId, now);
    const rest = await repo.players(exec, b.battleId);
    if (b.mode !== 'hosted' && (b.hostId === actor.userId || rest.length === 0))
      await repo.update(exec, b.battleId, { status: 'cancelled' });
    return ok({ left: true as const });
  });
}

export type BattleView = {
  battleId: string;
  mode: BattleRow['mode'];
  status: BattleStatus;
  titleBn: string | null;
  titleEn: string | null;
  topicBn: string | null;
  topicEn: string | null;
  code: string | null;
  isHost: boolean;
  questionCount: number;
  durationSeconds: number;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
  serverNow: string;
  quickWaitEndsAt: string | null;
  players: Array<{
    name: string;
    isMe: boolean;
    answered: number;
    finished: boolean;
    correct: number | null;
    rank: number | null;
  }>;
  /** While running and the caller has not finished: the questions, without answers. */
  questions: StudentQuestion[];
  myAnswers: Record<string, number>;
  myFinished: boolean;
  /** After the battle: every question with the caller's answer and the right one. */
  review: Array<{
    questionId: string;
    promptBn: string;
    promptEn: string;
    optionsBn: string[];
    optionsEn: string[];
    chosenIndex: number | null;
    correctIndex: number;
    explanationBn: string | null;
    explanationEn: string | null;
  }>;
};

/** Records a finished battle's answers once: measured difficulty and the caller's Mistake Vault. */
async function settle(b: BattleRow, me: PlayerRow, goalId: string | null): Promise<void> {
  if (me.settledAt || b.status !== 'finished') return;
  const qs = await bankQuestionsByIds(Object.keys(me.answers));
  const now = new Date();
  for (const q of qs) {
    const chosen = me.answers[q.questionId] as number;
    const isCorrect = chosen === q.correctIndex;
    await recordBankAnswer({
      userId: me.userId,
      questionId: q.questionId,
      chosenIndex: chosen,
      isCorrect,
    });
    if (!isCorrect)
      await recordBankMistake(getDb(), {
        userId: me.userId,
        questionId: q.questionId,
        topicId: q.topicId,
        difficulty: q.effectiveDifficulty,
        goalId,
        chosenIndex: chosen,
        at: now,
      });
  }
  await repo.updatePlayer(getDb(), b.battleId, me.userId, { settledAt: now });
}

export async function getBattle(
  actor: Actor,
  raw: BattleRef,
): Promise<Result<BattleView, AppError<'NOT_FOUND'>>> {
  const input = BattleRef.parse(raw);
  const now = new Date();
  const b = await withTransaction(getDb(), async (tx) =>
    advance(unwrapTx(tx), input.battleId, now),
  );
  if (!b) return err(appError('NOT_FOUND'));
  const db = getDb();
  const players = await repo.players(db, b.battleId);
  const me = players.find((p) => p.userId === actor.userId);
  // Hosted battles of the caller's band are visible before joining; others only to their players.
  if (!me) {
    const tier = await tierOf(actor.userId);
    if (b.mode !== 'hosted' || !tier || tier.band !== b.band) return err(appError('NOT_FOUND'));
  }
  if (me && b.status === 'finished') await settle(b, me, b.goalId);

  const isOver = b.status === 'finished';
  const names = await getIdentity().displayNamesOf(players.map((p) => p.userId));
  const ranked = isOver
    ? rankStandings(
        players.map((p) => ({
          userId: p.userId,
          correct: p.correctCount ?? 0,
          tookMs: tookMsOf(p, b),
          finished: p.finishedAt !== null,
        })),
      )
    : [];
  const rankOf = new Map(ranked.map((r) => [r.userId, r.rank]));
  const order = isOver ? ranked.map((r) => r.userId) : players.map((p) => p.userId);
  const byUser = new Map(players.map((p) => [p.userId, p]));
  const topics = b.topicId ? await topicNamesOf([b.topicId]) : {};
  const questions =
    b.status === 'running' && me && !me.finishedAt
      ? (await bankQuestionsByIds(b.questionIds))
          .sort((x, y) => b.questionIds.indexOf(x.questionId) - b.questionIds.indexOf(y.questionId))
          .map(toStudentQuestion)
      : [];
  const review =
    isOver && me
      ? (await bankQuestionsByIds(b.questionIds))
          .sort((x, y) => b.questionIds.indexOf(x.questionId) - b.questionIds.indexOf(y.questionId))
          .map((q) => ({
            questionId: q.questionId,
            promptBn: q.promptBn,
            promptEn: q.promptEn,
            optionsBn: q.optionsBn,
            optionsEn: q.optionsEn,
            chosenIndex: me.answers[q.questionId] ?? null,
            correctIndex: q.correctIndex,
            explanationBn: q.explanationBn,
            explanationEn: q.explanationEn,
          }))
      : [];
  return ok({
    battleId: b.battleId,
    mode: b.mode,
    status: b.status,
    titleBn: b.titleBn,
    titleEn: b.titleEn,
    topicBn: b.topicId ? (topics[b.topicId]?.nameBn ?? null) : null,
    topicEn: b.topicId ? (topics[b.topicId]?.nameEn ?? null) : null,
    code: me && b.mode === 'friend' && b.status === 'waiting' ? b.code : null,
    isHost: b.hostId === actor.userId,
    questionCount: b.questionCount,
    durationSeconds: b.durationSeconds,
    createdAt: b.createdAt.toISOString(),
    startsAt: b.startsAt?.toISOString() ?? null,
    endsAt: b.endsAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    quickWaitEndsAt:
      b.mode === 'quick' && b.status === 'waiting'
        ? new Date(b.createdAt.getTime() + QUICK_WAIT_MS).toISOString()
        : null,
    players: order.map((userId) => {
      const p = byUser.get(userId) as PlayerRow;
      const name = names[userId] ?? '';
      return {
        // Friends know each other; everyone else is shown as "Rahim U.".
        name: userId === actor.userId || b.mode === 'friend' ? name : maskName(name),
        isMe: userId === actor.userId,
        answered: Object.keys(p.answers).length,
        finished: p.finishedAt !== null,
        correct: isOver ? (p.correctCount ?? 0) : null,
        rank: rankOf.get(userId) ?? null,
      };
    }),
    questions,
    myAnswers: me && (b.status === 'running' || isOver) ? me.answers : {},
    myFinished: me?.finishedAt !== null && me?.finishedAt !== undefined,
    review,
  });
}

export async function answerBattle(
  actor: Actor,
  raw: BattleAnswerInput,
): Promise<Result<{ saved: true }, BattleError>> {
  const input = BattleAnswerInput.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const b = await repo.byId(exec, input.battleId);
    const me = b ? await repo.playerForUpdate(exec, b.battleId, actor.userId) : null;
    if (!b || !me) return err(appError('NOT_FOUND'));
    const isOpen =
      b.status === 'running' &&
      !me.finishedAt &&
      b.endsAt !== null &&
      now.getTime() <= b.endsAt.getTime() + ANSWER_GRACE_MS;
    if (!isOpen) return err(withKey('INVALID_STATE', 'errors.battle.closed'));
    if (!b.questionIds.includes(input.questionId)) return err(appError('NOT_FOUND'));
    await repo.updatePlayer(exec, b.battleId, actor.userId, {
      answers: { ...me.answers, [input.questionId]: input.chosenIndex },
    });
    return ok({ saved: true as const });
  });
}

/** The caller is done; when everyone is, the battle ends at once. */
export async function finishBattle(
  actor: Actor,
  raw: BattleRef,
): Promise<Result<{ finished: true }, BattleError>> {
  const input = BattleRef.parse(raw);
  const now = new Date();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    const b = await repo.forUpdate(exec, input.battleId);
    const me = b ? await repo.playerForUpdate(exec, b.battleId, actor.userId) : null;
    if (!b || !me) return err(appError('NOT_FOUND'));
    if (b.status === 'running' && !me.finishedAt) {
      const key = await keyOf(b.questionIds);
      await repo.updatePlayer(exec, b.battleId, actor.userId, {
        finishedAt: b.endsAt && b.endsAt < now ? b.endsAt : now,
        correctCount: correctOf(me.answers, key),
      });
    }
    await advance(exec, b.battleId, now);
    return ok({ finished: true as const });
  });
}

// ================================================================= staff

export async function scheduleBattle(
  actor: Actor,
  raw: ScheduleBattleInput,
): Promise<Result<{ battleId: string }, BattleError>> {
  const input = ScheduleBattleInput.parse(raw);
  const startsAt = dhakaLocalToUtc(input.startsAtLocal);
  if (!startsAt || startsAt.getTime() <= Date.now())
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { startsAtLocal: ['errors.exam.startInPast'] },
      }),
    );
  const goal = await getActiveGoal(input.goalId);
  if (!goal.ok) return err(appError('NOT_FOUND'));
  const segment = await getSegment(goal.value.segmentId);
  if (!segment.ok) return err(appError('NOT_FOUND'));
  const pool = await battleQuestionPool(input.goalId, input.topicId ?? null);
  const questionIds = chooseQuestions([], pool, input.questionCount, Math.random);
  if (questionIds.length < input.questionCount)
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: { questionCount: ['errors.exam.notEnough'] } }),
    );
  const durationSeconds = durationSecondsFor(input.questionCount);
  const b = await repo.insert(getDb(), {
    mode: 'hosted',
    band: segment.value.battleBand,
    goalId: input.goalId,
    hostId: actor.userId,
    titleBn: input.titleBn,
    titleEn: input.titleEn,
    topicId: input.topicId ?? null,
    source: 'bank',
    questionCount: input.questionCount,
    durationSeconds,
    maxPlayers: MAX_PLAYERS.hosted,
    questionIds,
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationSeconds * 1000),
  });
  return ok({ battleId: b.battleId });
}

export async function listHostedBattles(actor: Actor): Promise<Result<BattleSummary[], never>> {
  const isAdmin = actor.roles.includes('admin');
  const rows = await repo.hostedBy(getDb(), isAdmin ? null : actor.userId);
  return ok(await summaries(rows, actor.userId, new Date()));
}
