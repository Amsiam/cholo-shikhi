// [LT] US9.7: an Admin logs a takedown against a published lesson, honours it with a reason (the
// lesson is hidden from Students, audited), and reverses it with a justification (restored);
// missing reasons, wrong transitions and non-Admins are refused.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPublishedCourse } from '#src/features/catalog/index.ts';
import { getDb } from '#src/server/db.ts';
import { auditLogEntry } from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

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
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'LT price bounds',
      }),
    );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  const { goalId } = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  );
  course = await p.published(goalId, { sections: 2 });
}, 180_000);
afterAll(async () => {
  await s?.close();
});

const lessonsOf = async () => {
  const c = await getPublishedCourse(course.courseId);
  return c.ok ? c.value.outline.flatMap((x) => x.lessons.map((l) => l.lessonId)) : [];
};

describe('copyright takedowns', () => {
  it('honours with a reason (hidden), then reverses with a justification (restored)', async () => {
    const targets = value<{ sections: Array<{ lessons: Array<{ lessonId: string }> }> }>(
      await s.call('getTakedownTargets', s.admin.request, {
        course: `https://example.test/courses/${course.courseId}`,
      }),
    );
    const lessonId = targets.sections[0]?.lessons[0]?.lessonId as string;
    const { noticeId } = value<{ noticeId: string }>(
      await s.call('logTakedownNotice', s.admin.request, {
        courseId: course.courseId,
        contentType: 'lesson',
        contentId: lessonId,
        claimant: 'Rights Holder Ltd',
        claimantContact: 'legal@rights.example.test',
        claim: 'Chapter 3 of our published textbook, copied verbatim.',
        evidence: 'https://rights.example.test/book/ch3',
      }),
    );
    // AC9.7.3: no reason, no decision.
    expect(
      await s.call('decideTakedownNotice', s.admin.request, { noticeId, action: 'honour' }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.takedown.reason' } });
    expect(
      await s.call('decideTakedownNotice', s.admin.request, {
        noticeId,
        action: 'reverse',
        reason: 'Not yet honoured, so nothing to reverse.',
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.takedown.transition' } });

    value(
      await s.call('decideTakedownNotice', s.admin.request, {
        noticeId,
        action: 'honour',
        reason: 'Claim matches the textbook page by page.',
      }),
    );
    expect(await lessonsOf()).not.toContain(lessonId);
    value(
      await s.call('decideTakedownNotice', s.admin.request, {
        noticeId,
        action: 'reverse',
        reason: 'Instructor showed a licence from the publisher.',
      }),
    );
    expect(await lessonsOf()).toContain(lessonId);
    const actions = (
      await getDb().select().from(auditLogEntry).where(eq(auditLogEntry.subjectId, noticeId))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'trustops.takedown.logged',
        'trustops.takedown.honoured',
        'trustops.takedown.reversed',
      ]),
    );
  });

  it('refuses instructors and students', async () => {
    expect((await s.call('listTakedownNotices', course.lead.request, {})).ok).toBe(false);
    const student = await s.newStudent();
    expect((await s.call('listTakedownNotices', student.request, {})).ok).toBe(false);
  });
});
