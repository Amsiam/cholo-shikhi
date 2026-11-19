// [LT] Step 18: the additive contract 5 exports CR-4 lockAccessDuration and CR-7 assertCourseLead
// (in-process, from src/features/catalog/index.ts), on a per-file schema with real sessions:
// idempotency, a setAccessDuration racing the lock (ordered by the course row lock, BR5.7), and
// the check that neither export is reachable over HTTP (NFR6.201).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as catalog from '#src/features/catalog/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  allServerFns,
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTRACT5 = ['lockAccessDuration', 'assertCourseLead'] as const;

let s: ServerFnHarness;
let lead: Caller;
let co: Caller;
let goalId: string;

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

const actorOf = (caller: Caller, roles: Actor['roles'] = ['student', 'instructor']): Actor => ({
  userId: caller.userId,
  roles,
  locale: 'en',
  hasStepUp: true,
});

beforeAll(async () => {
  s = await createServerFnHarness();
  lead = s.instructor;
  co = await s.newInstructor();
  const segment = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segment.segmentId)),
  ).goalId;
});
afterAll(async () => {
  await s?.close();
});

async function courseWithDuration(months: number | null) {
  const created = value<{ courseId: string; version: number }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: [buildTitle()],
    }),
  );
  if (months === null) return created;
  const set = value<{ version: number }>(
    await s.call('setAccessDuration', lead.request, {
      courseId: created.courseId,
      expectedVersion: created.version,
      months,
    }),
  );
  return { courseId: created.courseId, version: set.version };
}

const lock = (courseId: string) =>
  withTransaction(getDb(), (tx) => catalog.lockAccessDuration(tx, courseId));

describe('CR-4 lockAccessDuration (BR5.6, BR5.7)', () => {
  it('locks once and answers the same duration and lock time on a second call', async () => {
    const course = await courseWithDuration(6);
    const first = await lock(course.courseId);
    expect(first).toMatchObject({ ok: true, value: { accessDurationMonths: 6 } });
    const second = await lock(course.courseId);
    expect(second).toEqual(first);
    const audit = await s.t.pool.query<{ action: string }>(
      `SELECT action FROM audit_log_entry WHERE subject_id = $1 AND action = 'catalog.course.durationLocked'`,
      [course.courseId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('answers NOT_FOUND for an unknown or malformed course and INVALID_STATE with no duration', async () => {
    expect(await lock('5b0f1a8e-3c1d-4b8e-9f2a-6c7d8e9f0a1b')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await lock('not-an-id')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const course = await courseWithDuration(null);
    expect(await lock(course.courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.durationNotSet' },
    });
  });

  it('rolls back with the caller: a lock inside a failed enrolment leaves the duration editable', async () => {
    const course = await courseWithDuration(4);
    await withTransaction(getDb(), async (tx) => {
      await catalog.lockAccessDuration(tx, course.courseId);
      throw new Error('enrolment failed');
    }).catch(() => undefined);
    expect(
      (
        await s.call('setAccessDuration', lead.request, {
          courseId: course.courseId,
          expectedVersion: course.version,
          months: 12,
        })
      ).ok,
    ).toBe(true);
  });

  it('orders a duration change racing the first enrolment by the row lock: the change is refused', async () => {
    const course = await courseWithDuration(6);
    let releaseLock: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      releaseLock = r;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const enrolment = withTransaction(getDb(), async (tx) => {
      const result = await catalog.lockAccessDuration(tx, course.courseId);
      locked();
      await held;
      return result;
    });
    await isLocked;
    const change = s.call('setAccessDuration', lead.request, {
      courseId: course.courseId,
      expectedVersion: course.version,
      months: 12,
    });
    // The change waits on the course row lock until the enrolment commits.
    await new Promise((r) => setTimeout(r, 100));
    releaseLock();
    expect((await enrolment).ok).toBe(true);
    expect(await change).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.durationLocked' },
    });
  });
});

describe('CR-7 assertCourseLead (BR6.9)', () => {
  it('passes the Lead and an Admin, refuses a Co-instructor with notLead and others with not-found', async () => {
    const course = await courseWithDuration(null);
    const view = value<{ sections: Array<{ sectionId: string; ownershipVersion: number }> }>(
      await s.call('getCourseForEditing', lead.request, { courseId: course.courseId }),
    );
    const [section] = view.sections;
    value(
      await s.call('assignSection', lead.request, {
        courseId: course.courseId,
        sectionId: section?.sectionId,
        assigneeId: co.userId,
        expectedOwnershipVersion: section?.ownershipVersion,
      }),
    );
    expect(await catalog.assertCourseLead(actorOf(lead), course.courseId)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      (await catalog.assertCourseLead(actorOf(s.admin, ['student', 'admin']), course.courseId)).ok,
    ).toBe(true);
    expect(await catalog.assertCourseLead(actorOf(co), course.courseId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
    const outsider = await s.newStudent();
    expect(await catalog.assertCourseLead(actorOf(outsider), course.courseId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await catalog.assertCourseLead(actorOf(lead), 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
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
    const fn = (catalog as Record<string, unknown>)[name];
    expect(typeof fn).toBe('function');
    expect(fn).not.toHaveProperty('serverFnAccess');
    expect(Object.values(allServerFns())).not.toContain(fn);
    expect(Object.keys(allServerFns())).not.toContain(name);
  });

  it('no route file imports the Catalog public surface', () => {
    const routes = walk(join(ROOT, 'src/routes')).filter((p) => /\.(ts|tsx)$/.test(p));
    for (const file of routes) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/features\/catalog\/index(\.ts)?['"]/);
    }
  });

  it('the generated route table has no route for a contract 5 function', () => {
    const table = readFileSync(join(ROOT, 'src/routeTree.gen.ts'), 'utf8');
    for (const name of CONTRACT5) expect(table).not.toMatch(new RegExp(`['"/]${name}['"/]`, 'i'));
    // The only Catalog HTTP route is the plan's image upload (Step 44, NFR6.212); no other path.
    const catalogPaths = new Set(table.match(/['"]\/api\/catalog[^'"]*['"]/g) ?? []);
    expect([...catalogPaths].map((p) => p.slice(1, -1))).toEqual(['/api/catalog/images']);
  });
});
