// [AT] Step 4: Given/When/Then acceptance tests for US1.16, US1.15, US1.9 and US1.10, written from
// stories.md and the rules.md error mapping before any implementation. They call the real server
// functions through their real builders on a per-file schema with real Better Auth sessions.
// The streak values of AC1.9.2 / AC1.10.1 are produced and verified by U6 from goals.GoalChanged
// (functional-spec assumption 12); here the selection and the event are asserted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as goalsModule from '#src/features/goals/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

type SegmentView = { segmentId: string; segmentType: string; battleBand: string };
type Contract5 = {
  getSegment(segmentId: string): Promise<{ ok: boolean; value?: SegmentView }>;
  getCurrentGoal(userId: string): Promise<{ ok: boolean; value?: { goalId: string } }>;
};
type GuardModule = {
  requireCurrentGoal(
    load: () => Promise<ServerFnResultLike>,
  ): Promise<{ goalId: string; segmentId: string }>;
};

/** Contract 5 functions, looked up at call time so a missing export fails its test only. */
function contract5(): Contract5 {
  const api = goalsModule as unknown as Partial<Contract5>;
  if (typeof api.getSegment !== 'function' || typeof api.getCurrentGoal !== 'function') {
    throw new Error('contract 5 Goals functions are not exported from src/features/goals/index.ts');
  }
  return api as Contract5;
}

const guardModules = import.meta.glob('/src/features/goals/ui/require-current-goal.ts');
async function guard(): Promise<GuardModule> {
  const load = guardModules['/src/features/goals/ui/require-current-goal.ts'];
  if (!load) throw new Error('src/features/goals/ui/require-current-goal.ts does not exist');
  return (await load()) as GuardModule;
}

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

async function createSegment(overrides: Record<string, unknown> = {}) {
  const input = { ...buildSegmentInput(), ...overrides };
  return value<{ segmentId: string; version: number }>(
    await s.call('saveSegment', s.admin.request, input),
  );
}

async function createGoal(segmentId: string, overrides: Record<string, unknown> = {}) {
  const input = { ...buildGoalInput(segmentId), ...overrides };
  return value<{ goalId: string; version: number }>(
    await s.call('saveGoal', s.admin.request, input),
  );
}

async function auditRows(subjectId: string) {
  const { rows } = await s.t.pool.query<{ action: string; before: unknown; after: unknown }>(
    'SELECT action, before, after FROM audit_log_entry WHERE subject_id = $1 ORDER BY occurred_at',
    [subjectId],
  );
  return rows;
}

async function goalChangedEvents(userId: string) {
  const { rows } = await s.t.pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM outbox_event WHERE event_type = 'goals.GoalChanged' AND aggregate_key = $1
     ORDER BY recorded_at`,
    [userId],
  );
  return rows.map((r) => r.payload);
}

async function activeGoalIds(student: Caller): Promise<string[]> {
  const listed = value<{ segments: Array<{ goals: Array<{ goalId: string }> }> }>(
    await s.call('listActiveGoals', student.request),
  );
  return listed.segments.flatMap((segment) => segment.goals.map((g) => g.goalId));
}

describe('US1.16 Manage Goal segments', () => {
  it('AC1.16.1 Given the segment list, When I create "HSC" of type academic, Then Goals can be assigned to it and its type is academic', async () => {
    const hsc = await createSegment({
      nameEn: 'HSC 1',
      nameBn: 'এইচএসসি ১',
      segmentType: 'academic',
    });
    const goal = await createGoal(hsc.segmentId);
    expect(goal.goalId).toBeTruthy();
    const listed = value<{ rows: Array<{ segmentId: string; segmentType: string }> }>(
      await s.call('listSegments', s.admin.request, { page: 1, pageSize: 50 }),
    );
    expect(listed.rows).toContainEqual(
      expect.objectContaining({ segmentId: hsc.segmentId, segmentType: 'academic' }),
    );
    // The one-course rule (US2.16) reads the segment type through contract 5.
    expect(await contract5().getSegment(hsc.segmentId)).toEqual({
      ok: true,
      value: expect.objectContaining({ segmentId: hsc.segmentId, segmentType: 'academic' }),
    });
    expect((await auditRows(hsc.segmentId)).map((r) => r.action)).toContain(
      'goals.segment.created',
    );
  });

  it('AC1.16.2 Given a segment with active Goals, When I try to delete it, Then it is refused with the number of linked Goals', async () => {
    const segment = await createSegment();
    await createGoal(segment.segmentId);
    await createGoal(segment.segmentId);
    const refused = await s.call('deleteSegment', s.admin.request, {
      segmentId: segment.segmentId,
      expectedVersion: segment.version,
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.goals.segmentHasGoals' },
    });
    const listed = value<{ rows: Array<{ segmentId: string; goalCount: number }> }>(
      await s.call('listSegments', s.admin.request, { page: 1, pageSize: 50 }),
    );
    expect(listed.rows).toContainEqual(
      expect.objectContaining({ segmentId: segment.segmentId, goalCount: 2 }),
    );
  });

  it('AC1.16.3 Given a segment with existing selections, When I change its type, Then it applies to new reads only and is audit-logged', async () => {
    const segment = await createSegment({ segmentType: 'academic' });
    const goal = await createGoal(segment.segmentId);
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: goal.goalId }));
    const before = await s.t.pool.query('SELECT * FROM student_goal_selection WHERE user_id = $1', [
      student.userId,
    ]);
    const changed = await s.call('saveSegment', s.admin.request, {
      ...buildSegmentInput(),
      segmentId: segment.segmentId,
      expectedVersion: segment.version,
      segmentType: 'job_aspirant',
    });
    expect(changed.ok).toBe(true);
    expect(await contract5().getSegment(segment.segmentId)).toMatchObject({
      ok: true,
      value: { segmentType: 'job_aspirant' },
    });
    const typeChange = (await auditRows(segment.segmentId)).find(
      (r) => r.action === 'goals.segment.typeChanged',
    );
    expect(typeChange).toMatchObject({
      before: expect.objectContaining({ segmentType: 'academic' }),
      after: expect.objectContaining({ segmentType: 'job_aspirant' }),
    });
    // No stored history is rewritten (BR1.6).
    const after = await s.t.pool.query('SELECT * FROM student_goal_selection WHERE user_id = $1', [
      student.userId,
    ]);
    expect(after.rows).toEqual(before.rows);
  });
});

describe('US1.15 Manage Goals', () => {
  it('AC1.15.1 Given a segment exists, When I create an active Goal with both names, Then it appears in S1 and the change is audit-logged', async () => {
    const segment = await createSegment();
    const goal = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    expect(await activeGoalIds(student)).toContain(goal.goalId);
    expect((await auditRows(goal.goalId)).map((r) => r.action)).toEqual(['goals.goal.created']);
  });

  it.each(['nameBn', 'nameEn'])(
    'AC1.15.2 Given the %s is empty, When I save, Then a field error is shown and nothing is saved',
    async (field) => {
      const segment = await createSegment();
      const before = await s.t.pool.query('SELECT count(*)::int AS n FROM goal');
      const refused = await s.call('saveGoal', s.admin.request, {
        ...buildGoalInput(segment.segmentId),
        [field]: '   ',
      });
      expect(refused).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', fieldErrors: { [field]: expect.any(Array) } },
      });
      const after = await s.t.pool.query('SELECT count(*)::int AS n FROM goal');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    },
  );

  it('AC1.15.3 Given a Goal that students already follow, When I retire it, Then it leaves S1 for new choices and existing students keep it', async () => {
    const segment = await createSegment();
    const goal = await createGoal(segment.segmentId, { status: 'active' });
    const follower = await s.newStudent();
    value(await s.call('chooseGoal', follower.request, { goalId: goal.goalId }));
    const retired = await s.call('retireGoal', s.admin.request, {
      goalId: goal.goalId,
      expectedVersion: goal.version,
    });
    expect(retired.ok).toBe(true);
    const newcomer = await s.newStudent();
    expect(await activeGoalIds(newcomer)).not.toContain(goal.goalId);
    expect(await s.call('chooseGoal', newcomer.request, { goalId: goal.goalId })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(
      value<{ goalId: string }>(await s.call('getCurrentGoal', follower.request)),
    ).toMatchObject({
      goalId: goal.goalId,
    });
  });
});

describe('US1.9 Choose my Goal on first sign-in', () => {
  it('AC1.9.1 Given a newly verified Student with no Goal, When I sign in, Then S1 lists the active Goals grouped by segment before any other screen', async () => {
    const first = await createSegment({ sortOrder: 0 });
    const second = await createSegment({ sortOrder: 1 });
    const g1 = await createGoal(first.segmentId, { status: 'active', sortOrder: 1 });
    const g0 = await createGoal(first.segmentId, { status: 'active', sortOrder: 0 });
    const hidden = await createGoal(second.segmentId, { status: 'inactive' });
    const student = await s.newStudent();
    expect(await s.call('getCurrentGoal', student.request)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const listed = value<{
      segments: Array<{ segmentId: string; goals: Array<{ goalId: string }> }>;
    }>(await s.call('listActiveGoals', student.request));
    const group = listed.segments.find((x) => x.segmentId === first.segmentId);
    expect(group?.goals.map((g) => g.goalId)).toEqual([g0.goalId, g1.goalId]);
    // A segment with no active Goal is not shown.
    expect(listed.segments.some((x) => x.segmentId === second.segmentId)).toBe(false);
    expect(listed.segments.flatMap((x) => x.goals).map((g) => g.goalId)).not.toContain(
      hidden.goalId,
    );
  });

  it('AC1.9.2 Given I pick a Goal and confirm, When S2 loads, Then it is scoped to that Goal (GoalChanged published for the streak)', async () => {
    const segment = await createSegment();
    const goal = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    expect(
      value(await s.call('chooseGoal', student.request, { goalId: goal.goalId })),
    ).toMatchObject({ goalId: goal.goalId, isChanged: true });
    expect(value(await s.call('getCurrentGoal', student.request))).toMatchObject({
      goalId: goal.goalId,
      segmentId: segment.segmentId,
    });
    expect(await contract5().getCurrentGoal(student.userId)).toMatchObject({
      ok: true,
      value: { goalId: goal.goalId },
    });
    expect(await goalChangedEvents(student.userId)).toEqual([
      expect.objectContaining({
        userId: student.userId,
        previousGoalId: null,
        newGoalId: goal.goalId,
        newSegmentId: segment.segmentId,
      }),
    ]);
  });

  it('AC1.9.3 Given I have no Goal, When I open the catalog URL directly, Then I am redirected to S1', async () => {
    const student = await s.newStudent();
    const { requireCurrentGoal } = await guard();
    const thrown = await requireCurrentGoal(() => s.call('getCurrentGoal', student.request)).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toMatchObject({ options: { to: '/goals' } });
  });
});

describe('US1.10 Change my Goal', () => {
  it('AC1.10.1 Given my Goal is BCS, When I choose Bank and confirm the warning, Then my Goal becomes Bank and BCS is kept in history', async () => {
    const segment = await createSegment({ segmentType: 'job_aspirant' });
    const bcs = await createGoal(segment.segmentId, { status: 'active' });
    const bank = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: bcs.goalId }));
    const changed = await s.call('changeGoal', student.request, {
      goalId: bank.goalId,
      acknowledgedStreakReset: true,
    });
    expect(value(changed)).toMatchObject({ goalId: bank.goalId, isChanged: true });
    expect(value(await s.call('getCurrentGoal', student.request))).toMatchObject({
      goalId: bank.goalId,
    });
    const history = await s.t.pool.query<{ goal_id: string; end_reason: string | null }>(
      'SELECT goal_id, end_reason FROM student_goal_selection WHERE user_id = $1 ORDER BY selected_at',
      [student.userId],
    );
    expect(history.rows).toEqual([
      { goal_id: bcs.goalId, end_reason: 'changed' },
      { goal_id: bank.goalId, end_reason: null },
    ]);
    expect((await goalChangedEvents(student.userId)).at(-1)).toMatchObject({
      previousGoalId: bcs.goalId,
      newGoalId: bank.goalId,
    });
  });

  it('AC1.10.1 (BR2.6) a change without the streak acknowledgement is refused and nothing changes', async () => {
    const segment = await createSegment();
    const a = await createGoal(segment.segmentId, { status: 'active' });
    const b = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: a.goalId }));
    expect(
      await s.call('changeGoal', student.request, {
        goalId: b.goalId,
        acknowledgedStreakReset: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(value(await s.call('getCurrentGoal', student.request))).toMatchObject({
      goalId: a.goalId,
    });
  });

  it('AC1.10.3 Given I own items under BCS, When I switch to Bank, Then nothing outside the Goal selection and the outbox is written', async () => {
    const segment = await createSegment();
    const bcs = await createGoal(segment.segmentId, { status: 'active' });
    const bank = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: bcs.goalId }));
    const counts = async () => {
      const { rows } = await s.t.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
           AND table_name NOT IN ('student_goal_selection', 'outbox_event', 'outbox_delivery')`,
        [s.t.schemaName],
      );
      const result: Record<string, number> = {};
      for (const { table_name } of rows) {
        const c = await s.t.pool.query(`SELECT count(*)::int AS n FROM "${table_name}"`);
        result[table_name] = c.rows[0].n;
      }
      return result;
    };
    const before = await counts();
    value(
      await s.call('changeGoal', student.request, {
        goalId: bank.goalId,
        acknowledgedStreakReset: true,
      }),
    );
    expect(await counts()).toEqual(before);
  });

  it('BR2.8 re-selecting the current Goal is a no-op: no new selection and no event', async () => {
    const segment = await createSegment();
    const goal = await createGoal(segment.segmentId, { status: 'active' });
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId: goal.goalId }));
    const same = await s.call('changeGoal', student.request, {
      goalId: goal.goalId,
      acknowledgedStreakReset: true,
    });
    expect(value(same)).toMatchObject({ goalId: goal.goalId, isChanged: false });
    expect(await goalChangedEvents(student.userId)).toHaveLength(1);
    const { rows } = await s.t.pool.query(
      'SELECT count(*)::int AS n FROM student_goal_selection WHERE user_id = $1',
      [student.userId],
    );
    expect(rows[0].n).toBe(1);
  });
});
