// [LT] Step 9: the Goals contract 5 reads, called the way U3, U5, U6, U7 and Marketing will call them
// (in-process, from src/features/goals/index.ts), and the route-table check that none of them is
// reachable over HTTP (NFR6.201, BR13.5, BR13.6).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import {
  allServerFns,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';
import * as goals from './index.ts';
import { SegmentView, StudentGoal } from './index.ts';

const CONTRACT5 = ['getCurrentGoal', 'getSegment', 'listGoalsInSegments'] as const;
const ROOT = resolve(import.meta.dirname, '../../..');

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

describe('getSegment (BR13.5)', () => {
  it('returns the current type and battle band in the contract shape', async () => {
    const created = value<{ segmentId: string }>(
      await s.call(
        'saveSegment',
        s.admin.request,
        buildSegmentInput({ segmentType: 'job_aspirant', battleBand: 'bcs_9' }),
      ),
    );
    const result = await goals.getSegment(created.segmentId);
    expect(result).toEqual({
      ok: true,
      value: { segmentId: created.segmentId, segmentType: 'job_aspirant', battleBand: 'bcs_9' },
    });
    expect(SegmentView.safeParse(result.ok && result.value).success).toBe(true);
  });

  it('answers NOT_FOUND for a deleted segment', async () => {
    const created = value<{ segmentId: string; version: number }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    value(
      await s.call('deleteSegment', s.admin.request, {
        segmentId: created.segmentId,
        expectedVersion: 1,
      }),
    );
    expect(await goals.getSegment(created.segmentId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('listGoalsInSegments (BR13.6)', () => {
  it('returns every Goal of any status, ascending, without duplicates; unknown and empty input add nothing', async () => {
    const seg = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    const ids: string[] = [];
    for (const status of ['active', 'inactive', 'active'] as const) {
      ids.push(
        value<{ goalId: string }>(
          await s.call('saveGoal', s.admin.request, buildGoalInput(seg.segmentId, { status })),
        ).goalId,
      );
    }
    const retired = ids[2] as string;
    value(await s.call('retireGoal', s.admin.request, { goalId: retired, expectedVersion: 1 }));
    expect(
      await goals.listGoalsInSegments([seg.segmentId, seg.segmentId, crypto.randomUUID()]),
    ).toEqual([...ids].sort());
    expect(await goals.listGoalsInSegments([])).toEqual([]);
  });
});

describe('getCurrentGoal (contract 5)', () => {
  it('returns the StudentGoal shape, and NOT_FOUND before any choice', async () => {
    const seg = value<{ segmentId: string }>(
      await s.call('saveSegment', s.admin.request, buildSegmentInput()),
    );
    const g = value<{ goalId: string }>(
      await s.call(
        'saveGoal',
        s.admin.request,
        buildGoalInput(seg.segmentId, { status: 'active' }),
      ),
    );
    const student = await s.newStudent();
    expect(await goals.getCurrentGoal(student.userId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    value(await s.call('chooseGoal', student.request, { goalId: g.goalId }));
    const result = await goals.getCurrentGoal(student.userId);
    expect(result).toMatchObject({
      ok: true,
      value: { userId: student.userId, goalId: g.goalId, segmentId: seg.segmentId },
    });
    // Exactly the contract fields: no names leak to other units.
    expect(StudentGoal.strict().safeParse(result.ok && result.value).success).toBe(true);
  });
});

describe('contract 5 functions are never reachable over HTTP (NFR6.201)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it.each(CONTRACT5)('%s is a plain in-process function, not a server function', (name) => {
    const fn = (goals as Record<string, unknown>)[name];
    expect(typeof fn).toBe('function');
    expect(fn).not.toHaveProperty('serverFnAccess');
    expect(fn).not.toHaveProperty('url');
    // The server function of the same name (S12's own-Goal read) is a different function.
    expect(Object.values(allServerFns())).not.toContain(fn);
  });

  it('no route file imports the Goals public surface', () => {
    const routes = walk(join(ROOT, 'src/routes')).filter((p) => /\.(ts|tsx)$/.test(p));
    for (const file of routes) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/features\/goals\/index(\.ts)?['"]/);
    }
  });

  it('the generated route table has no route for a contract 5 function', () => {
    const table = readFileSync(join(ROOT, 'src/routeTree.gen.ts'), 'utf8');
    for (const name of CONTRACT5) expect(table).not.toMatch(new RegExp(`['"/]${name}['"/]`, 'i'));
    expect(table).not.toMatch(/['"]\/api\/goals/);
  });
});
