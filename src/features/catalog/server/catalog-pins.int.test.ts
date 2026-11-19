// [LT] Step 33: Admin pins (UC22, BR11.11, BR12.1, NFR6.219) through the real server functions on a
// real PostgreSQL schema, with the NFR6.202 negatives: anonymous, wrong role (Student, Lead, Finance),
// an Admin without step-up, and the domain refusals (rank bounds, stale token, takedown).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hideContent } from '#src/features/catalog/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let p: ReturnType<typeof createPublishHelper>;
let goalId: string;

beforeAll(async () => {
  s = await createServerFnHarness();
  p = createPublishHelper(s);
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  }
});
afterAll(async () => {
  await s?.close();
});

const version = async (courseId: string) => (await p.view(courseId, s.admin)).course.version;
const pin = async (request: Request, course: PublishedCourse, pinRank: number, v?: number) =>
  s.call('setPinRank', request, {
    target: { type: 'course', id: course.courseId },
    pinRank,
    expectedVersion: v ?? (await version(course.courseId)),
  });
const auditActions = async (courseId: string) =>
  (
    await s.t.pool.query<{ action: string; after: unknown }>(
      `SELECT action, after FROM audit_log_entry WHERE subject_id = $1 AND action LIKE 'catalog.course.%pinned' ORDER BY occurred_at, audit_entry_id`,
      [courseId],
    )
  ).rows;

describe('setPinRank / clearPinRank (BR11.11)', () => {
  it('an Admin pins and unpins a course, each change audited and versioned', async () => {
    const course = await p.published(goalId);
    const pinned = value<{ pinRank: number; version: number }>(
      await pin(s.admin.request, course, 3),
    );
    expect(pinned.pinRank).toBe(3);
    const cleared = value<{ pinRank: null; version: number }>(
      await s.call('clearPinRank', s.admin.request, {
        target: { type: 'course', id: course.courseId },
        expectedVersion: pinned.version,
      }),
    );
    expect(cleared).toMatchObject({ pinRank: null, version: pinned.version + 1 });
    expect((await auditActions(course.courseId)).map((r) => r.action)).toEqual([
      'catalog.course.pinned',
      'catalog.course.unpinned',
    ]);
  });

  it('refuses a stale version token with CONFLICT staleVersion and changes nothing', async () => {
    const course = await p.published(goalId);
    const current = await version(course.courseId);
    expect(await pin(s.admin.request, course, 1, current - 1)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
    expect(await version(course.courseId)).toBe(current);
    expect(await auditActions(course.courseId)).toEqual([]);
  });

  it.each([0, -1, 1001, 1.5])('refuses pin rank %s at the shared schema', async (rank) => {
    const course = await p.published(goalId);
    expect(await pin(s.admin.request, course, rank)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('refuses a hidden course with INVALID_STATE underTakedown (NFR6.219)', async () => {
    const course = await p.published(goalId);
    value(
      await withTransaction(getDb(), (tx) =>
        hideContent(tx, {
          contentRef: { type: 'course', id: course.courseId },
          takedownNoticeId: randomUUID(),
        }),
      ),
    );
    expect(await pin(s.admin.request, course, 1)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.underTakedown' },
    });
  });

  it('answers NOT_FOUND for an unknown course', async () => {
    expect(
      await s.call('setPinRank', s.admin.request, {
        target: { type: 'course', id: randomUUID() },
        pinRank: 1,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('refuses an anonymous caller with UNAUTHENTICATED', async () => {
    const course = await p.published(goalId);
    expect(await pin(s.anonymous(), course, 1)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('refuses the wrong role: a Student, the course Lead and Finance get FORBIDDEN', async () => {
    const course = await p.published(goalId);
    const student = await s.newStudent();
    const finance = await s.newFinance();
    for (const caller of [student, course.lead, finance]) {
      expect(await pin(caller.request, course, 1)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    expect(await auditActions(course.courseId)).toEqual([]);
  });

  it('refuses an Admin without step-up (wrong user state)', async () => {
    const course = await p.published(goalId);
    expect(await pin(s.adminWithoutStepUp.request, course, 1)).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
    expect(
      await s.call('clearPinRank', s.adminPendingTwoStep.request, {
        target: { type: 'course', id: course.courseId },
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('a pinned course lists first for students of its Goal', async () => {
    const course = await p.published(goalId);
    value(await pin(s.admin.request, course, 1));
    const student = await s.newStudent();
    value(await s.call('chooseGoal', student.request, { goalId }));
    const page = value<{ items: Array<{ courseId: string; isPinned: boolean }> }>(
      await s.call('listCatalog', student.request, { tab: 'courses' }),
    );
    expect(page.items[0]).toEqual(
      expect.objectContaining({ courseId: course.courseId, isPinned: true }),
    );
  });
});
