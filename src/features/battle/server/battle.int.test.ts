// [LT] Battles: quick matches pair two Students of one band only; friend rooms join by code and the
// host starts; hosted battles start on time. Same questions for everyone, no answers before the
// battle is over, ranked by right answers then time, and wrong answers reach the Mistake Vault.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { battle, tokenAccount } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';

type Caller = Awaited<ReturnType<ServerFnHarness['newStudent']>>;
let s: ServerFnHarness;
let goalId: string;
let otherGoalId: string;
let topicId: string;
const correctOf = new Map<string, number>();

type View = {
  battleId: string;
  status: string;
  code: string | null;
  questions: Array<Record<string, unknown> & { questionId: string }>;
  players: Array<{ isMe: boolean; finished: boolean; correct: number | null; rank: number | null }>;
  review: Array<{ correctIndex: number }>;
};

/** A Student of a goal holding `tokens` streak-tokens (a quick match costs 2 by default). */
async function student(goal: string, tokens = 10): Promise<Caller> {
  const c = await s.newStudent();
  value(await s.call('chooseGoal', c.request, { goalId: goal }));
  await getDb().insert(tokenAccount).values({ userId: c.userId, balance: tokens });
  return c;
}
const balanceOf = async (c: Caller) =>
  (await getDb().select().from(tokenAccount).where(eq(tokenAccount.userId, c.userId)))[0]
    ?.balance ?? 0;
const view = async (c: Caller, battleId: string) =>
  value<View>(await s.call('getMyBattle', c.request, { battleId }));

beforeAll(async () => {
  s = await createServerFnHarness();
  const goalIn = async () => {
    const { segmentId } = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    return value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
    ).goalId;
  };
  goalId = await goalIn();
  otherGoalId = await goalIn();
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'বিষয়',
      nameEn: 'Subject',
      goalIds: [goalId, otherGoalId],
    }),
  );
  topicId = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, {
      subjectId,
      nameBn: 'টপিক',
      nameEn: 'Topic',
    }),
  ).topicId;
  for (let i = 0; i < 12; i += 1) {
    const q = value<{ questionId: string }>(
      await s.call('saveBankQuestionDraft', s.admin.request, {
        topicId,
        difficulty: 'medium',
        promptBn: `প্রশ্ন ${i}`,
        promptEn: `Question ${i}`,
        optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
        optionsEn: ['A', 'B', 'C', 'D'],
        correctIndex: i % 4,
      }),
    );
    correctOf.set(q.questionId, i % 4);
  }
}, 180_000);
afterAll(async () => {
  await s?.close();
});

describe('quick match', () => {
  it('pairs two Students of one band; same questions; results only after both finish', async () => {
    const a = await student(goalId);
    const b = await student(goalId);
    const other = await student(otherGoalId);
    const { battleId } = value<{ battleId: string }>(
      await s.call('findQuickMatch', a.request, { topicId }),
    );
    expect((await view(a, battleId)).status).toBe('waiting');
    // Another band never takes the seat.
    const otherMatch = value<{ battleId: string }>(
      await s.call('findQuickMatch', other.request, { topicId }),
    );
    expect(otherMatch.battleId).not.toBe(battleId);
    // The same band does, and the battle starts.
    expect(
      value<{ battleId: string }>(await s.call('findQuickMatch', b.request, { topicId })).battleId,
    ).toBe(battleId);
    const va = await view(a, battleId);
    const vb = await view(b, battleId);
    expect(va.status).toBe('running');
    expect(va.questions).toHaveLength(10);
    expect(va.questions[0]).not.toHaveProperty('correctIndex');
    expect(va.questions.map((q) => q.questionId)).toEqual(vb.questions.map((q) => q.questionId));
    // An outsider cannot read it.
    expect(await s.call('getMyBattle', other.request, { battleId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });

    // A: all right. B: two right, one wrong.
    for (const q of va.questions)
      value(
        await s.call('answerBattleQuestion', a.request, {
          battleId,
          questionId: q.questionId,
          chosenIndex: correctOf.get(q.questionId),
        }),
      );
    value(await s.call('finishMyBattle', a.request, { battleId }));
    const midway = await view(a, battleId);
    expect(midway.status).toBe('running');
    expect(midway.review).toEqual([]);
    const [q1, q2, q3] = vb.questions.map((q) => q.questionId) as [string, string, string];
    for (const [questionId, chosenIndex] of [
      [q1, correctOf.get(q1)],
      [q2, correctOf.get(q2)],
      [q3, ((correctOf.get(q3) as number) + 1) % 4],
    ] as const)
      value(await s.call('answerBattleQuestion', b.request, { battleId, questionId, chosenIndex }));
    value(await s.call('finishMyBattle', b.request, { battleId }));

    const done = await view(b, battleId);
    expect(done.status).toBe('finished');
    expect(done.players.map((p) => [p.isMe, p.correct, p.rank])).toEqual([
      [false, 10, 1],
      [true, 2, 2],
    ]);
    expect(done.review).toHaveLength(10);
    // No answers after the end.
    expect(
      await s.call('answerBattleQuestion', b.request, { battleId, questionId: q1, chosenIndex: 0 }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.battle.closed' } });
    // B's wrong answer is in the vault.
    expect(value<{ active: number }>(await s.call('getMyVault', b.request, {})).active).toBe(1);
  });

  it('is called off when nobody joins within 90 seconds', async () => {
    const lonely = await student(goalId);
    const { battleId } = value<{ battleId: string }>(
      await s.call('findQuickMatch', lonely.request, { source: 'vault' }),
    );
    await getDb()
      .update(battle)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(battle.battleId, battleId));
    expect(await balanceOf(lonely)).toBe(8);
    expect((await view(lonely, battleId)).status).toBe('cancelled');
    // AC5.8.2: the entry comes back in full, once.
    expect(await balanceOf(lonely)).toBe(10);
    await view(lonely, battleId);
    expect(await balanceOf(lonely)).toBe(10);
  });
});

describe('quick match entry (streak-tokens)', () => {
  it('AC5.8.1: debits the configured entry once and shows the balance on the battle home', async () => {
    const a = await student(goalId);
    value(await s.call('findQuickMatch', a.request, { topicId }));
    expect(await balanceOf(a)).toBe(8);
    expect(
      value<{ tokens: number; entryTokens: number }>(
        await s.call('getMyBattleHome', a.request, {}),
      ),
    ).toMatchObject({ tokens: 8, entryTokens: 2 });
  });
  it('AC5.8.3: refuses a Student who holds too few tokens and changes nothing', async () => {
    const poor = await student(goalId, 1);
    expect(await s.call('findQuickMatch', poor.request, { topicId })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.battle.notEnoughTokens' },
    });
    expect(await balanceOf(poor)).toBe(1);
  });
  it('AC5.8.4: two tabs at once enter one match and pay once', async () => {
    const twin = await student(otherGoalId);
    const [x, y] = await Promise.all([
      s.call('findQuickMatch', twin.request, { source: 'vault' }),
      s.call('findQuickMatch', twin.request, { source: 'vault' }),
    ]);
    expect(value<{ battleId: string }>(x).battleId).toBe(value<{ battleId: string }>(y).battleId);
    expect(await balanceOf(twin)).toBe(8);
  });
  it('gives the entry back to a Student who leaves before the match starts', async () => {
    const quitter = await student(otherGoalId);
    // Close matches left waiting by earlier tests, so the quitter opens a match of their own.
    await getDb().update(battle).set({ status: 'cancelled' }).where(eq(battle.status, 'waiting'));
    const { battleId } = value<{ battleId: string }>(
      await s.call('findQuickMatch', quitter.request, { topicId }),
    );
    expect(await balanceOf(quitter)).toBe(8);
    value(await s.call('leaveMyBattle', quitter.request, { battleId }));
    expect(await balanceOf(quitter)).toBe(10);
  });
  it('keeps friend rooms free', async () => {
    const host = await student(goalId, 0);
    value(await s.call('createBattleRoom', host.request, { questionCount: 5 }));
    expect(await balanceOf(host)).toBe(0);
  });
});

describe('friend rooms', () => {
  it('join by code (any case); only the host starts, with at least two', async () => {
    const host = await student(goalId);
    const friend = await student(goalId);
    const stranger = await student(otherGoalId);
    const room = value<{ battleId: string; code: string }>(
      await s.call('createBattleRoom', host.request, { questionCount: 5 }),
    );
    expect(
      await s.call('startBattleRoom', host.request, { battleId: room.battleId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.battle.needTwo' } });
    expect(await s.call('joinBattleRoom', stranger.request, { code: room.code })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.battle.otherBand' },
    });
    value(await s.call('joinBattleRoom', friend.request, { code: room.code.toLowerCase() }));
    expect(
      await s.call('startBattleRoom', friend.request, { battleId: room.battleId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.battle.notHost' } });
    value(await s.call('startBattleRoom', host.request, { battleId: room.battleId }));
    const v = await view(friend, room.battleId);
    expect(v.status).toBe('running');
    expect(v.questions).toHaveLength(5);
    expect(await s.call('joinBattleRoom', stranger.request, { code: room.code })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('hosted battles', () => {
  it('staff schedule one; Students of the band join before it starts', async () => {
    const startsAt = new Date(Date.now() + 3600_000 + 6 * 3600_000).toISOString().slice(0, 16);
    const { battleId } = value<{ battleId: string }>(
      await s.call('scheduleHostedBattle', s.instructor.request, {
        goalId,
        titleBn: 'শুক্রবারের লড়াই',
        titleEn: 'Friday battle',
        topicId,
        questionCount: 5,
        startsAtLocal: startsAt,
      }),
    );
    const player = await student(goalId);
    const home = value<{ hosted: Array<{ battleId: string }> }>(
      await s.call('getMyBattleHome', player.request, {}),
    );
    expect(home.hosted.map((h) => h.battleId)).toContain(battleId);
    value(await s.call('joinHostedBattle', player.request, { battleId }));
    expect((await view(player, battleId)).status).toBe('waiting');
    await getDb()
      .update(battle)
      .set({ startsAt: new Date(Date.now() - 10_000), endsAt: new Date(Date.now() + 140_000) })
      .where(eq(battle.battleId, battleId));
    const running = await view(player, battleId);
    expect(running.status).toBe('running');
    expect(running.questions).toHaveLength(5);
    // Another band cannot join.
    const stranger = await student(otherGoalId);
    expect(await s.call('joinHostedBattle', stranger.request, { battleId })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.battle.otherBand' },
    });
    // Students cannot schedule.
    expect(
      await s.call('scheduleHostedBattle', player.request, {
        goalId,
        titleBn: 'ক',
        titleEn: 'x',
        questionCount: 5,
        startsAtLocal: startsAt,
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});
