// [LT] US2.17-US2.19: a Student asks to switch a paid course; a second request shows the first;
// an Admin approves with a full refund (old enrolment "switched", refund recorded) or denies with a
// reason; acting on a decided or expired request is refused as stale; expiry happens at 24 h.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { courseSwitchRequest, enrolment } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { expireDueSwitches } from './switch.server.ts';

let s: ServerFnHarness;
let a: PublishedCourse;
let b: PublishedCourse;
type Student = Awaited<ReturnType<ServerFnHarness['newStudent']>>;

beforeAll(async () => {
  s = await createServerFnHarness();
  const p = createPublishHelper(s);
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  a = await p.published(goalId, { sections: 1, months: 6 });
  b = await p.published(goalId, { sections: 1, months: 6 });
}, 180_000);
afterAll(async () => {
  await s?.close();
});

async function buyer(): Promise<{ st: Student; paid: number }> {
  const st = await s.newStudent();
  const c = value<{ paymentId: string; amountPoisha: number }>(
    await s.call('startCourseCheckout', st.request, { courseId: a.courseId }),
  );
  value(
    await s.call('settleMyFakePayment', st.request, { paymentId: c.paymentId, outcome: 'succeed' }),
  );
  return { st, paid: c.amountPoisha };
}
const ask = (st: Student) =>
  s.call('requestMyCourseSwitch', st.request, { fromCourseId: a.courseId, toCourseId: b.courseId });

describe('course switches', () => {
  it('requests once, approves with a full refund, and refuses a second decision as stale', async () => {
    const { st, paid } = await buyer();
    const options = value<{ from: Array<{ courseId: string }> }>(
      await s.call('getMySwitchOptions', st.request, { courseId: b.courseId }),
    );
    expect(options.from.map((c) => c.courseId)).toEqual([a.courseId]);
    const first = value<{
      request: { switchId: string; minutesLeft: number };
      isExisting: boolean;
    }>(await ask(st));
    expect(first.isExisting).toBe(false);
    expect(first.request.minutesLeft).toBe(24 * 60);
    const second = value<{ request: { switchId: string }; isExisting: boolean }>(await ask(st));
    expect(second).toMatchObject({
      isExisting: true,
      request: { switchId: first.request.switchId },
    });

    const queue = value<Array<{ switchId: string; paidPoisha: number }>>(
      await s.call('listSwitchRequests', s.admin.request, {}),
    );
    expect(queue.find((q) => q.switchId === first.request.switchId)?.paidPoisha).toBe(paid);

    expect(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: first.request.switchId,
        decision: 'approve',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.switch.policy' } });
    const decided = value<{ status: string; refundPoisha: number }>(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: first.request.switchId,
        decision: 'approve',
        policy: 'full',
      }),
    );
    expect(decided).toEqual({ status: 'approved', refundPoisha: paid });
    const [old] = await getDb().select().from(enrolment).where(eq(enrolment.userId, st.userId));
    expect(old?.status).toBe('switched');
    expect(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: first.request.switchId,
        decision: 'deny',
        reason: 'Too late now',
      }),
    ).toMatchObject({ ok: false, error: { code: 'STALE' } });
  });

  it('denies with a reason and keeps the enrolment', async () => {
    const { st } = await buyer();
    const { request } = value<{ request: { switchId: string } }>(await ask(st));
    expect(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: request.switchId,
        decision: 'deny',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.switch.reason' } });
    value(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: request.switchId,
        decision: 'deny',
        reason: 'Course already half done',
      }),
    );
    const [kept] = await getDb().select().from(enrolment).where(eq(enrolment.userId, st.userId));
    expect(kept?.status).toBe('active');
  });

  it('expires at 24 hours, not before, and an expired request is stale', async () => {
    const { st } = await buyer();
    const { request } = value<{ request: { switchId: string } }>(await ask(st));
    const [row] = await getDb()
      .select()
      .from(courseSwitchRequest)
      .where(eq(courseSwitchRequest.switchId, request.switchId));
    const deadline = row?.deadlineAt as Date;
    await expireDueSwitches(new Date(deadline.getTime() - 60_000));
    const still = await getDb()
      .select()
      .from(courseSwitchRequest)
      .where(eq(courseSwitchRequest.switchId, request.switchId));
    expect(still[0]?.status).toBe('pending');
    expect(await expireDueSwitches(deadline)).toBeGreaterThanOrEqual(1);
    expect(
      await s.call('decideSwitchRequest', s.admin.request, {
        switchId: request.switchId,
        decision: 'approve',
        policy: 'unused',
      }),
    ).toMatchObject({ ok: false, error: { code: 'STALE' } });
  });

  it('only Admins see the queue', async () => {
    const st = await s.newStudent();
    expect((await s.call('listSwitchRequests', st.request, {})).ok).toBe(false);
  });
});
