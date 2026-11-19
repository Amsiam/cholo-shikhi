// [LT] US7.13: Finance opens an ambiguous attribution case for a section (two instructors claim
// it); the queue lists it and A1 flags it; resolving confirms one claimant with a reason and is
// audit-logged with the actor and the reason; wrong owners, missing reasons, a second resolution,
// non-instructor claimants and Students/Instructors are refused. An empty queue lists nothing.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';
import { openAttributionFlags } from './attribution.server.ts';

let s: ServerFnHarness;
let course: PublishedCourse;

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
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  course = await p.published(goalId, { sections: 2, withCo: true });
}, 180_000);
afterAll(async () => {
  await s?.close();
});

type Queue = { open: Array<{ caseId: string; claimants: unknown[] }>; resolved: unknown[] };

describe('attribution queue', () => {
  it('starts empty, then opens, flags and resolves a case with a logged override', async () => {
    const finance = await s.newFinance();
    const empty = value<Queue>(await s.call('listAttributionCases', finance.request, {}));
    expect(empty.open).toEqual([]);

    const target = value<{
      sections: Array<{ sectionId: string }>;
      instructors: Array<{ instructorId: string }>;
    }>(
      await s.call('getAttributionCourse', finance.request, {
        course: `https://example.test/courses/${course.courseId}`,
      }),
    );
    const claimants = target.instructors.map((i) => i.instructorId);
    expect(claimants).toHaveLength(2);
    const sectionId = target.sections[0]?.sectionId as string;

    // A claimant who does not teach the course is refused.
    const outsider = await s.newInstructor();
    expect(
      await s.call('openAttributionCase', finance.request, {
        courseId: course.courseId,
        sectionId,
        claimantIds: [claimants[0], outsider.userId],
        description: 'Both say they recorded this section.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.attribution.claimants' } });

    const { caseId } = value<{ caseId: string }>(
      await s.call('openAttributionCase', finance.request, {
        courseId: course.courseId,
        sectionId,
        claimantIds: claimants,
        description: 'Both instructors claim to be Lead for this section.',
      }),
    );
    const queue = value<Queue>(await s.call('listAttributionCases', finance.request, {}));
    expect(queue.open.map((c) => c.caseId)).toContain(caseId);
    const flags = await openAttributionFlags();
    expect(flags.openCases).toBeGreaterThanOrEqual(1);
    for (const id of claimants) expect(flags.instructorIds.has(id as string)).toBe(true);

    expect(
      await s.call('resolveAttributionCase', finance.request, {
        caseId,
        ownerId: outsider.userId,
        reason: 'Outsider is not a claimant at all.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.attribution.notClaimant' } });
    expect(
      await s.call('resolveAttributionCase', finance.request, { caseId, ownerId: claimants[0] }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.attribution.reason' } });

    const reason = 'Upload history shows the Lead authored this section.';
    value(
      await s.call('resolveAttributionCase', finance.request, {
        caseId,
        ownerId: claimants[0],
        reason,
      }),
    );
    expect(
      await s.call('resolveAttributionCase', finance.request, {
        caseId,
        ownerId: claimants[1],
        reason: 'Trying to resolve the same case twice.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.attribution.resolved' } });

    const [entry] = await getDb()
      .select()
      .from(auditLogEntry)
      .where(eq(auditLogEntry.action, 'payouts.attribution.override'));
    expect(entry).toMatchObject({ actorId: finance.userId, subjectId: caseId, reason });
    expect((await openAttributionFlags()).instructorIds.has(claimants[0] as string)).toBe(false);
  });

  it('refuses Students and Instructors', async () => {
    const st = await s.newStudent();
    expect((await s.call('listAttributionCases', st.request, {})).ok).toBe(false);
    expect((await s.call('listAttributionCases', course.lead.request, {})).ok).toBe(false);
    expect((await s.call('listAttributionCases', s.admin.request, {})).ok).toBe(true);
  });
});
