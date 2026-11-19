// [LT] Every server function that no other integration test calls as an allowed user, called here
// as one. Each must answer with a Result (ok, or a handled domain error) and never throw or return
// INTERNAL_ERROR. Where a fixture is cheap the call does its real job; where it is not, an unknown
// ID must come back as a handled "not found". The four two-step sign-in functions act on the browser
// session cookie and are covered by the identity integration tests and the e2e route crawl.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ACTIVE_GOALS_TYPE } from '#src/features/goals/domain/goals-notifications.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';

let s: ServerFnHarness;
let student: Awaited<ReturnType<ServerFnHarness['newStudent']>>;
let instructor: Awaited<ReturnType<ServerFnHarness['newInstructor']>>;
let segmentId: string;
const UNKNOWN = '00000000-0000-4000-8000-00000000f00d';

type Answer = { ok: boolean; value?: unknown; error?: { code?: string; i18nKey?: string } };

/** Calls a server function and checks it answered without breaking. */
async function run(name: string, request: Request, data: unknown = {}): Promise<Answer> {
  const answer = (await s.call(name, request, data)) as Answer;
  expect(answer, `${name} answered with a Result`).toHaveProperty('ok');
  if (!answer.ok) expect(answer.error?.code, `${name} broke`).not.toBe('INTERNAL_ERROR');
  return answer;
}
const ok = async (name: string, request: Request, data: unknown = {}) => {
  const answer = await run(name, request, data);
  expect(answer, `${name} succeeded: ${JSON.stringify(answer.error)}`).toMatchObject({ ok: true });
  return answer.value;
};

beforeAll(async () => {
  s = await createServerFnHarness();
  student = await s.newStudent();
  instructor = await s.newInstructor();
  segmentId = (
    (await s.call('saveSegment', s.admin.request, buildSegmentInput())) as {
      value: { segmentId: string };
    }
  ).value.segmentId;
}, 120_000);
afterAll(async () => {
  await s?.close();
});

describe('read functions answer for an allowed caller', () => {
  it('student reads', async () => {
    for (const name of [
      'getMyEntitlements',
      'getMyLiveClasses',
      'getMyProductOrders',
      'getMyProfileDetails',
      'getMyResults',
      'getMyUnreadCount',
      'listPublicGoals',
    ])
      await ok(name, student.request);
  });
  it('staff reads', async () => {
    for (const name of ['listExamsForStaff', 'listStaffLiveClasses', 'listMyHostedBattles'])
      await ok(name, instructor.request);
    for (const name of [
      'getQuestionTaxonomy',
      'getRewardSettings',
      'listFlags',
      'listSettingDefinitions',
      'listDeadLetters',
    ])
      await ok(name, s.admin.request);
    await ok('listAuditLog', s.admin.request, { page: 1, pageSize: 5 });
  });
  it('the dev mailbox answers', async () => {
    await run('getDevMailbox', student.request);
  });
});

describe('write functions do their job', () => {
  it('notifications: set a preference and mark everything read', async () => {
    // Payment notifications cannot be switched off; an account one can.
    expect(
      await run('setNotificationPreference', student.request, {
        typeKey: 'notify.switch.approved',
        channel: 'email',
        isEnabled: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOTIFICATION_LOCKED' } });
    await ok('setNotificationPreference', student.request, {
      typeKey: NO_ACTIVE_GOALS_TYPE,
      channel: 'email',
      isEnabled: false,
    });
    await ok('markMyNotificationsRead', student.request);
    expect(await ok('getMyUnreadCount', student.request)).toMatchObject({});
  });

  it('language: switch to English and back', async () => {
    await ok('setLanguage', student.request, { locale: 'en' });
    await ok('setLanguage', student.request, { locale: 'bn' });
  });

  it('study buddy: create an invite, then cancel it', async () => {
    // A Student needs a current Goal before inviting a buddy.
    expect(await run('createMyBuddyInvite', student.request)).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.buddy.noGoal' },
    });
    const goal = (await ok('saveGoal', s.admin.request, buildGoalInput(segmentId))) as {
      goalId: string;
    };
    await ok('chooseGoal', student.request, { goalId: goal.goalId });
    await ok('createMyBuddyInvite', student.request);
    await ok('cancelMyBuddyInvite', student.request);
  });

  it('promo codes: switch one off and on again', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const created = (await ok('createPromoCode', s.admin.request, {
      code: `SMOKE${Math.floor(Math.random() * 1e6)}`,
      kind: 'percent',
      percentBps: 1000,
      segmentIds: [segmentId],
      startsOn: today,
      endsOn: later,
      maxUses: 10,
    })) as { promoCodeId: string };
    await ok('setPromoCodeActive', s.admin.request, {
      promoCodeId: created.promoCodeId,
      isActive: false,
    });
    await ok('setPromoCodeActive', s.admin.request, {
      promoCodeId: created.promoCodeId,
      isActive: true,
    });
  });

  it('trial course: clearing a course that is not a trial course is a no-op', async () => {
    await ok('clearSegmentTrialCourse', s.admin.request, { courseId: UNKNOWN });
  });
});

describe('unknown IDs come back as handled errors, never a crash', () => {
  it.each([
    ['cancelLiveClass', 'instructor', { liveClassId: UNKNOWN }],
    ['retireExamForStudents', 'instructor', { examId: UNKNOWN, expectedVersion: 1 }],
    ['getMyProductOrder', 'student', { orderId: UNKNOWN }],
    [
      'resolveDeadLetter',
      'admin',
      { outboxDeliveryId: UNKNOWN, action: 'discard', justification: 'Smoke test: unknown id.' },
    ],
  ] as const)('%s', async (name, who, data) => {
    const caller =
      who === 'admin' ? s.admin.request : who === 'student' ? student.request : instructor.request;
    expect(await run(name, caller, data)).toMatchObject({ ok: false });
  });
});
