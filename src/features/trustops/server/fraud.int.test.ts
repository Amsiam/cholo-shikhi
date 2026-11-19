// [LT] US4.8/US4.9, US5.15, US8.10/US8.11 as review queues only (no detector): an Admin flags an
// account by hand with a reason; the hold applies while the flag is open (Vault items held, no
// live-quiz shields, referral quarantine); clearing lifts it, banning SUSPENDS the account (it
// cannot sign in or call signed-in functions) and reinstating lifts the suspension. Missing
// reasons, double flags, decided flags, Finance and Students are refused, and every step is
// audit-logged. An empty queue lists nothing.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { accountSuspension, auditLogEntry, userAccount } from '#src/server/schema/index.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { value } from '../../catalog/test-fixtures/publish-helper.ts';
import { isReferralQuarantined, shieldIneligible, vaultHeldUpTo } from './fraud-holds.server.ts';

let s: ServerFnHarness;

beforeAll(async () => {
  s = await createServerFnHarness();
}, 120_000);
afterAll(async () => {
  await s?.close();
});

type Queue = {
  open: Array<{ flagId: string; userId: string; kind: string }>;
  lastReviewAt: string | null;
};

describe('fraud review queues', () => {
  it('starts empty, then flags a Vault gamer (items held) and clears them (hold lifted)', async () => {
    const empty = value<Queue>(
      await s.call('listFraudQueue', s.admin.request, { kind: 'vault_gaming' }),
    );
    expect(empty.open).toEqual([]);
    const st = await s.newStudent();
    expect(
      await s.call('flagFraudAccount', s.admin.request, { kind: 'vault_gaming', user: st.userId }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.reason' } });
    const { flagId } = value<{ flagId: string }>(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'vault_gaming',
        user: st.userId,
        reason: 'Ten answers under a second, all option A.',
      }),
    );
    expect(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'vault_gaming',
        user: st.userId,
        reason: 'Flagging the same account twice.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.alreadyFlagged' } });
    expect(await vaultHeldUpTo(st.userId)).toBeInstanceOf(Date);
    const queue = value<Queue>(await s.call('listFraudQueue', s.admin.request, {}));
    expect(queue.open.map((f) => f.flagId)).toContain(flagId);
    expect(queue.lastReviewAt).not.toBeNull();

    value(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'clear',
        reason: 'Reviewed the session: an honest fast reader.',
      }),
    );
    expect(await vaultHeldUpTo(st.userId)).toBeNull();
    expect(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'ban',
        reason: 'A decided flag cannot be decided again.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.decided' } });
    const actions = (
      await getDb().select().from(auditLogEntry).where(eq(auditLogEntry.subjectId, flagId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['trustops.fraud.flagged', 'trustops.fraud.cleared']),
    );
  });

  it('holds shields for a collusion flag and quarantines referrals', async () => {
    const [a, b] = [await s.newStudent(), await s.newStudent()];
    value(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'quiz_collusion',
        user: a.userId,
        reason: 'Answers and timings match account B exactly.',
      }),
    );
    value(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'referral_fraud',
        user: b.userId,
        reason: 'Refers account A and shares its phone.',
      }),
    );
    const ineligible = await shieldIneligible(getDb(), [a.userId, b.userId]);
    expect([...ineligible]).toEqual([a.userId]);
    expect(await isReferralQuarantined(b.userId)).toBe(true);
    expect(await isReferralQuarantined(a.userId)).toBe(false);
  });

  it('bans by suspending (no sign-in, no signed-in calls); reinstating lets the account back in', async () => {
    const st = await s.h.verifiedStudent();
    const request = st.browser.request('/');
    expect((await s.call('getShellState', request, {})).ok).toBe(true);
    const { flagId } = value<{ flagId: string }>(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'referral_fraud',
        user: st.userId,
        reason: 'A ring of five accounts referring each other.',
      }),
    );
    const finance = await s.newFinance();
    expect(
      (
        await s.call('decideFraudFlag', finance.request, {
          flagId,
          action: 'ban',
          reason: 'Finance trying to ban an account.',
        })
      ).ok,
    ).toBe(false);
    expect((await s.call('listFraudQueue', request, {})).ok).toBe(false);
    // Reinstating an open (not banned) flag is refused.
    expect(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'reinstate',
        reason: 'Nothing has been banned here yet.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.decided' } });
    value(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'ban',
        reason: 'Confirmed referral ring after review.',
      }),
    );
    // The banned account's session no longer works for signed-in reads, and it cannot sign in.
    expect((await s.call('listMyNotifications', request, { page: 1, pageSize: 5 })).ok).toBe(false);
    const refused = await s.h.signIn(s.h.browser(), st.person.email, st.person.password);
    expect(refused.status).toBe(403);
    expect(refused.response.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(
      false,
    );
    // A suspension, not a closure: the account itself stays active.
    const [account] = await getDb().select().from(userAccount).where(eq(userAccount.id, st.userId));
    expect(account?.status).toBe('active');
    const banned = value<{ banned: Array<{ flagId: string }> }>(
      await s.call('listFraudQueue', s.admin.request, {}),
    );
    expect(banned.banned.map((f) => f.flagId)).toContain(flagId);

    // Finance cannot reinstate; a short reason is refused.
    expect(
      (
        await s.call('decideFraudFlag', finance.request, {
          flagId,
          action: 'reinstate',
          reason: 'Finance trying to reinstate.',
        })
      ).ok,
    ).toBe(false);
    expect(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'reinstate',
        reason: 'ok',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.reason' } });
    value(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'reinstate',
        reason: 'Appeal upheld: the referrals were a real study group.',
      }),
    );
    const browser = s.h.browser();
    expect((await s.h.signIn(browser, st.person.email, st.person.password)).status).toBe(200);
    expect(
      (await s.call('listMyNotifications', browser.request('/'), { page: 1, pageSize: 5 })).ok,
    ).toBe(true);
    const [suspension] = await getDb()
      .select()
      .from(accountSuspension)
      .where(eq(accountSuspension.userId, st.userId));
    expect(suspension).toMatchObject({
      source: `fraud_flag:${flagId}`,
      suspendedBy: s.admin.userId,
      reinstatedBy: s.admin.userId,
      reinstateReason: 'Appeal upheld: the referrals were a real study group.',
    });
    // A reinstated flag is final.
    expect(
      await s.call('decideFraudFlag', s.admin.request, {
        flagId,
        action: 'ban',
        reason: 'Trying to ban the reinstated flag again.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.decided' } });
    const actions = (
      await getDb().select().from(auditLogEntry).where(eq(auditLogEntry.subjectId, st.userId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['identity.account.suspended', 'identity.account.reinstated']),
    );
  });

  it('refuses an unknown account', async () => {
    expect(
      await s.call('flagFraudAccount', s.admin.request, {
        kind: 'vault_gaming',
        user: 'nobody@example.test',
        reason: 'Nobody has this address at all.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.fraud.noUser' } });
  });
});
