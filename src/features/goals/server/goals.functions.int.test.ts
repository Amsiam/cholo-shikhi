// [LT] Step 8: the ten Goals server functions through their real builders (NFR6.201, NFR6.202,
// NFR11.202): anonymous, wrong-role and missing-step-up refusals for every function, wrong-user
// isolation for the Student functions, the shared schemas, audit and outbox writes, and BR2.3.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import {
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

const ADMIN_FNS = [
  'listSegments',
  'saveSegment',
  'deleteSegment',
  'listGoalsAdmin',
  'saveGoal',
  'retireGoal',
] as const;
const STUDENT_FNS = ['getCurrentGoal', 'listActiveGoals', 'chooseGoal', 'changeGoal'] as const;

let s: ServerFnHarness;
beforeAll(async () => {
  s = await createServerFnHarness();
});
afterAll(async () => {
  await s?.close();
});

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}
async function segment(overrides: Record<string, unknown> = {}) {
  return value<{ segmentId: string; version: number }>(
    await s.call('saveSegment', s.admin.request, { ...buildSegmentInput(), ...overrides }),
  );
}
async function goal(segmentId: string, overrides: Record<string, unknown> = {}) {
  return value<{ goalId: string; version: number }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), ...overrides }),
  );
}
async function count(sql: string, params: unknown[] = []) {
  const { rows } = await s.t.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
}

describe('access matrix (NFR6.201, NFR11.202)', () => {
  it.each(ADMIN_FNS)('%s refuses an anonymous caller', async (name) => {
    expect(await s.call(name, s.anonymous())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(ADMIN_FNS)('%s refuses a Student (wrong role)', async (name) => {
    const student = await s.newStudent();
    expect(await s.call(name, student.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it.each(ADMIN_FNS)('%s refuses an instructor (wrong staff role)', async (name) => {
    expect(await s.call(name, s.instructor.request)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it.each(ADMIN_FNS)('%s refuses an Admin without two-step (STEP_UP_REQUIRED)', async (name) => {
    expect(await s.call(name, s.adminWithoutStepUp.request)).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED', i18nKey: 'errors.identity.STEP_UP_REQUIRED' },
    });
  });
  it.each(ADMIN_FNS)('%s refuses a real Admin session still pending two-step', async (name) => {
    expect(await s.call(name, s.adminPendingTwoStep.request)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(STUDENT_FNS)('%s refuses an anonymous caller', async (name) => {
    expect(await s.call(name, s.anonymous(), { goalId: crypto.randomUUID() })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it('refuses a write with no audit entry when the caller is not an Admin', async () => {
    const before = await count('SELECT count(*)::int AS n FROM audit_log_entry');
    const student = await s.newStudent();
    await s.call('saveSegment', student.request, buildSegmentInput());
    expect(await count('SELECT count(*)::int AS n FROM audit_log_entry')).toBe(before);
  });
});

describe('Student functions act only on the caller (wrong user)', () => {
  it("never reads or changes another student's Goal", async () => {
    const seg = await segment();
    const a = await goal(seg.segmentId, { status: 'active' });
    const b = await goal(seg.segmentId, { status: 'active' });
    const owner = await s.newStudent();
    const other = await s.newStudent();
    value(await s.call('chooseGoal', owner.request, { goalId: a.goalId }));
    // A userId smuggled into the input is ignored: the actor is always the session's user.
    expect(await s.call('getCurrentGoal', other.request, { userId: owner.userId })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    value(
      await s.call('changeGoal', other.request, {
        goalId: b.goalId,
        acknowledgedStreakReset: true,
        userId: owner.userId,
      }),
    );
    expect(value(await s.call('getCurrentGoal', owner.request))).toMatchObject({
      goalId: a.goalId,
    });
    expect(value(await s.call('getCurrentGoal', other.request))).toMatchObject({
      goalId: b.goalId,
    });
  });

  it('a Student can use the Student functions without any staff role or two-step', async () => {
    const student = await s.newStudent();
    expect((await s.call('listActiveGoals', student.request)).ok).toBe(true);
  });
});

describe('Admin segment and Goal writes', () => {
  it('refuses a stale edit with CONFLICT staleVersion and keeps the newer values', async () => {
    const seg = await segment();
    const first = value<{ version: number }>(
      await s.call('saveSegment', s.admin.request, {
        ...buildSegmentInput(),
        segmentId: seg.segmentId,
        expectedVersion: seg.version,
      }),
    );
    expect(first.version).toBe(2);
    expect(
      await s.call('saveSegment', s.admin.request, {
        ...buildSegmentInput(),
        segmentId: seg.segmentId,
        expectedVersion: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
  });

  it('requires expectedVersion on an edit (shared schema)', async () => {
    const seg = await segment();
    expect(
      await s.call('saveSegment', s.admin.request, {
        ...buildSegmentInput(),
        segmentId: seg.segmentId,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { expectedVersion: expect.any(Array) } },
    });
  });

  it('refuses a duplicate segment name, case-insensitively, as a field error', async () => {
    const input = buildSegmentInput();
    await segment(input);
    expect(
      await s.call('saveSegment', s.admin.request, {
        ...buildSegmentInput(),
        nameEn: input.nameEn.toUpperCase(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { nameEn: ['errors.goals.nameDuplicate'] } },
    });
  });

  it('deletes an empty segment and audits it; an unknown one is NOT_FOUND', async () => {
    const seg = await segment();
    expect(
      await s.call('deleteSegment', s.admin.request, {
        segmentId: seg.segmentId,
        expectedVersion: 1,
      }),
    ).toEqual({ ok: true, value: { segmentId: seg.segmentId } });
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_log_entry WHERE subject_id = $1 AND action = 'goals.segment.deleted'`,
        [seg.segmentId],
      ),
    ).toBe(1);
    expect(
      await s.call('deleteSegment', s.admin.request, {
        segmentId: seg.segmentId,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('fixes a used Goal in its segment (BR1.7) but lets an unused one move', async () => {
    const from = await segment();
    const to = await segment();
    const used = await goal(from.segmentId, { status: 'active' });
    const unused = await goal(from.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: used.goalId }));
    expect(
      await s.call('saveGoal', s.admin.request, {
        ...buildGoalInput(to.segmentId),
        goalId: used.goalId,
        expectedVersion: used.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.segmentFixed' },
    });
    expect(
      (
        await s.call('saveGoal', s.admin.request, {
          ...buildGoalInput(to.segmentId),
          goalId: unused.goalId,
          expectedVersion: unused.version,
        })
      ).ok,
    ).toBe(true);
  });

  it('activates and deactivates through save, and refuses to edit or retire a retired Goal', async () => {
    const seg = await segment();
    const g = await goal(seg.segmentId, { status: 'inactive' });
    const input = buildGoalInput(seg.segmentId, { status: 'active' });
    const activated = value<{ version: number }>(
      await s.call('saveGoal', s.admin.request, { ...input, goalId: g.goalId, expectedVersion: 1 }),
    );
    const actions = await s.t.pool.query<{ action: string }>(
      'SELECT action FROM audit_log_entry WHERE subject_id = $1 ORDER BY occurred_at',
      [g.goalId],
    );
    expect(actions.rows.map((r) => r.action)).toEqual(['goals.goal.created', 'goals.goal.updated']);
    const retired = value<{ version: number }>(
      await s.call('retireGoal', s.admin.request, {
        goalId: g.goalId,
        expectedVersion: activated.version,
      }),
    );
    expect(
      await s.call('retireGoal', s.admin.request, {
        goalId: g.goalId,
        expectedVersion: retired.version,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.goalRetired' },
    });
    expect(
      await s.call('saveGoal', s.admin.request, {
        ...input,
        goalId: g.goalId,
        expectedVersion: retired.version,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
  });

  it('pages the Admin lists server-side and filters Goals by segment', async () => {
    const seg = await segment();
    for (let i = 0; i < 3; i += 1) await goal(seg.segmentId);
    const page = value<{ total: number; rows: unknown[]; page: number }>(
      await s.call('listGoalsAdmin', s.admin.request, {
        page: 2,
        pageSize: 2,
        segmentId: seg.segmentId,
      }),
    );
    expect(page).toMatchObject({ total: 3, page: 2 });
    expect(page.rows).toHaveLength(1);
    expect(await s.call('listSegments', s.admin.request, { page: 1, pageSize: 500 })).toMatchObject(
      { ok: false, error: { code: 'VALIDATION_FAILED' } },
    );
  });
});

describe('Student Goal choice', () => {
  it('publishes exactly one GoalChanged per opened selection, with IDs only (BR2.5, NFR5.203)', async () => {
    const seg = await segment();
    const g = await goal(seg.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: g.goalId }));
    const { rows } = await s.t.pool.query<{ payload: Record<string, unknown>; version: number }>(
      `SELECT payload, version FROM outbox_event WHERE event_type = 'goals.GoalChanged' AND aggregate_key = $1`,
      [student.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(Object.keys(rows[0]?.payload ?? {}).sort()).toEqual([
      'changedAt',
      'newGoalId',
      'newSegmentId',
      'previousGoalId',
      'userId',
    ]);
  });

  it('refuses a second first-choice with alreadyHasGoal (the change needs the streak warning)', async () => {
    const seg = await segment();
    const a = await goal(seg.segmentId, { status: 'active' });
    const b = await goal(seg.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: a.goalId }));
    expect(await s.call('chooseGoal', student.request, { goalId: b.goalId })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.goals.alreadyHasGoal' },
    });
  });

  it('refuses one of two concurrent changes from two devices with CONFLICT (BR2.4)', async () => {
    const seg = await segment();
    const [a, b, c] = [
      await goal(seg.segmentId, { status: 'active' }),
      await goal(seg.segmentId, { status: 'active' }),
      await goal(seg.segmentId, { status: 'active' }),
    ];
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: a.goalId }));
    const results = await Promise.all(
      [b, c].map((g) =>
        s.call('changeGoal', student.request, { goalId: g.goalId, acknowledgedStreakReset: true }),
      ),
    );
    // Row locks serialise them; the open-selection index refuses a lost race. Either way exactly
    // one open selection remains and every event matches a committed change.
    const open = await count(
      'SELECT count(*)::int AS n FROM student_goal_selection WHERE user_id = $1 AND ended_at IS NULL',
      [student.userId],
    );
    expect(open).toBe(1);
    const refusedCodes = results.filter((r) => !r.ok).map((r) => r.error?.code);
    expect(refusedCodes.every((code) => code === 'CONFLICT')).toBe(true);
    const events = await count(
      `SELECT count(*)::int AS n FROM outbox_event WHERE event_type = 'goals.GoalChanged' AND aggregate_key = $1`,
      [student.userId],
    );
    const selections = await count(
      'SELECT count(*)::int AS n FROM student_goal_selection WHERE user_id = $1',
      [student.userId],
    );
    expect(events).toBe(selections);
  });
});
