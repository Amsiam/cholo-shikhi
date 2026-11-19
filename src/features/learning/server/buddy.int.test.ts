// [LT] Study buddies (US5.12–US5.14): invite by code within one Goal-segment, one pair at a time,
// the 1.2× day when both study, and ending a pair from tomorrow.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { buddyPair, tokenEntry, vaultAnswer, vaultItem } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';

type Caller = Awaited<ReturnType<ServerFnHarness['newStudent']>>;
type Buddy = {
  hasGoal: boolean;
  pair: {
    buddyName: string;
    endsDay: string | null;
    today: { me: boolean; buddy: boolean };
  } | null;
  ended: { buddyName: string } | null;
  invite: { code: string } | null;
  dailyTokens: number;
  buddyDayTokens: number;
};
let s: ServerFnHarness;
let goalId: string;
let otherSegmentGoalId: string;

async function student(goal: string): Promise<Caller> {
  const c = await s.newStudent();
  value(await s.call('chooseGoal', c.request, { goalId: goal }));
  return c;
}
const myBuddy = async (c: Caller) => value<Buddy>(await s.call('getMyStudyBuddy', c.request, {}));
const invite = async (c: Caller) =>
  value<{ code: string }>(await s.call('createMyBuddyInvite', c.request, {})).code;

/** A Mistake Vault practice answer today for the Student's goal: a qualifying activity. */
async function studyToday(c: Caller, goal: string) {
  const questionId = randomUUID();
  const now = new Date();
  await getDb().insert(vaultItem).values({
    userId: c.userId,
    questionId,
    source: 'bank',
    topicId: randomUUID(),
    difficulty: 'medium',
    goalId: goal,
    lastWrongChoice: 1,
    firstWrongAt: now,
    lastWrongAt: now,
  });
  await getDb()
    .insert(vaultAnswer)
    .values({ userId: c.userId, questionId, chosenIndex: 0, isCorrect: true, answeredAt: now });
}
const entries = (c: Caller) =>
  getDb().select().from(tokenEntry).where(eq(tokenEntry.userId, c.userId));

beforeAll(async () => {
  s = await createServerFnHarness();
  const segment = async () =>
    value<{ segmentId: string }>(await s.call('saveSegment', s.admin.request, buildSegmentInput()))
      .segmentId;
  const goalIn = async (segmentId: string) =>
    value<{ goalId: string }>(
      await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
    ).goalId;
  const seg = await segment();
  goalId = await goalIn(seg);
  otherSegmentGoalId = await goalIn(await segment());
}, 180_000);
afterAll(async () => {
  await s?.close();
});

describe('study buddies', () => {
  it('AC5.12.1/5.12.2: a friend in the same segment accepts a code; another segment is refused', async () => {
    const a = await student(goalId);
    const b = await student(goalId);
    const far = await student(otherSegmentGoalId);
    const code = await invite(a);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    // The same open code comes back.
    expect(await invite(a)).toBe(code);
    expect(await s.call('previewStudyBuddyInvite', a.request, { code })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.ownCode' },
    });
    expect(await s.call('acceptStudyBuddyInvite', far.request, { code })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.otherSegment' },
    });
    expect(
      value<{ inviterName: string }>(
        await s.call('previewStudyBuddyInvite', b.request, { code: code.toLowerCase() }),
      ).inviterName,
    ).not.toBe('');
    value(await s.call('acceptStudyBuddyInvite', b.request, { code }));
    expect((await myBuddy(a)).pair).toMatchObject({ endsDay: null });
    expect((await myBuddy(b)).pair).toMatchObject({ endsDay: null });
    // The code is used up.
    expect(await s.call('acceptStudyBuddyInvite', far.request, { code })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.codeNotFound' },
    });

    // AC5.12.3: one pair at a time.
    expect(await s.call('createMyBuddyInvite', a.request, {})).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.alreadyPaired' },
    });
    const c = await student(goalId);
    const cCode = await invite(c);
    expect(await s.call('acceptStudyBuddyInvite', a.request, { code: cCode })).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.alreadyPaired' },
    });
  });

  it('AC5.13.1/5.13.2: both study today: each gets 1.2 × B; only one: just B', async () => {
    const a = await student(goalId);
    const b = await student(goalId);
    value(await s.call('acceptStudyBuddyInvite', b.request, { code: await invite(a) }));
    expect(await myBuddy(a)).toMatchObject({ dailyTokens: 5, buddyDayTokens: 6 });

    await studyToday(a, goalId);
    const alone = value<{ streak: { tokens: number } }>(
      await s.call('getMyStreakRewards', a.request, {}),
    );
    expect(alone.streak.tokens).toBe(5);

    await studyToday(b, goalId);
    expect((await myBuddy(a)).pair?.today).toEqual({ me: true, buddy: true });
    for (const c of [a, b]) {
      const r = value<{ streak: { tokens: number } }>(
        await s.call('getMyStreakRewards', c.request, {}),
      );
      expect(r.streak.tokens).toBe(6);
    }
    // Reading again never pays twice.
    value(await s.call('getMyStreakRewards', a.request, {}));
    expect((await entries(a)).map((e) => [e.reason, e.delta]).sort()).toEqual([
      ['buddy_bonus', 1],
      ['daily', 5],
    ]);
  });

  it('AC5.14.1/5.14.2: ending counts today, stops tomorrow; the former buddy sees it ended', async () => {
    const a = await student(goalId);
    const b = await student(goalId);
    value(await s.call('acceptStudyBuddyInvite', b.request, { code: await invite(a) }));
    const { endsDay } = value<{ endsDay: string }>(await s.call('endMyStudyBuddy', b.request, {}));
    // Still counting today, for both.
    expect((await myBuddy(a)).pair?.endsDay).toBe(endsDay);
    expect(await s.call('createMyBuddyInvite', a.request, {})).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.alreadyPaired' },
    });
    // Tomorrow: move the pair a day back in time instead of waiting.
    const [pair] = await getDb().select().from(buddyPair).where(eq(buddyPair.endsDay, endsDay));
    const back = (d: string) => {
      const x = new Date(`${d}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() - 1);
      return x.toISOString().slice(0, 10);
    };
    await getDb()
      .update(buddyPair)
      .set({ startsDay: back(pair?.startsDay as string), endsDay: back(endsDay) })
      .where(eq(buddyPair.pairId, pair?.pairId as string));
    const after = await myBuddy(a);
    expect(after.pair).toBeNull();
    expect(after.ended).not.toBeNull();
    // And A may pair up again.
    expect(await invite(a)).toMatch(/^[A-Z2-9]{6}$/);
  });
});
