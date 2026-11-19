// [LT] Step 26: the contract 5 takedown (UC20; BR12.5; NFR6.218, NFR6.219), called in-process as U11
// TrustOps will call it, inside its own transaction. After hideContent every U2 write path on the
// hidden course, section or lesson is refused underTakedown for instructors and Admins alike; only
// restoreContent with the same notice brings it back. Each change is audited and emits
// catalog.ContentVisibilityChanged. Student read paths (S3, S4, getLessonPlacement) arrive in Bolt 4,
// which extends this file's assertions to them.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hideContent, restoreContent } from '#src/features/catalog/index.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

let s: ServerFnHarness;
let goalId: string;

type View = {
  course: { courseId: string; status: string; version: number };
  sections: Array<{ sectionId: string; ownershipVersion: number; workingVersion: number | null }>;
};
type SectionEdit = {
  editVersion: number;
  isUnderTakedown: boolean;
  working: { version: number } | null;
  lessons: Array<{ lessonId: string; version: number; isUnderTakedown: boolean }>;
};

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

beforeAll(async () => {
  s = await createServerFnHarness();
  const segment = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segment.segmentId)),
  ).goalId;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'LT price bounds',
      }),
    );
  }
});
afterAll(async () => {
  await s?.close();
});

const view = async (courseId: string, caller: Caller) =>
  value<View>(await s.call('getCourseForEditing', caller.request, { courseId }));
const edit = async (courseId: string, sectionId: string, caller: Caller) =>
  value<SectionEdit>(await s.call('getSectionForEditing', caller.request, { courseId, sectionId }));

const takedown = (
  fn: typeof hideContent,
  type: 'course' | 'section' | 'lesson',
  id: string,
  takedownNoticeId: string,
) => withTransaction(getDb(), (tx) => fn(tx, { contentRef: { type, id }, takedownNoticeId }));

/** A published course with two Lead-owned sections, each with one text lesson. */
async function published() {
  const lead = await s.newInstructor();
  const { courseId } = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: [buildTitle(), buildTitle()],
    }),
  );
  for (const [name, extra] of [
    ['setCoursePrice', { price: '500' }],
    ['setAccessDuration', { months: 12 }],
    ['setCourseDescription', { descriptionBn: 'বিবরণ', descriptionEn: '' }],
  ] as const) {
    const v = await view(courseId, lead);
    value(
      await s.call(name, lead.request, { courseId, expectedVersion: v.course.version, ...extra }),
    );
  }
  const sectionIds = (await view(courseId, lead)).sections.map((x) => x.sectionId);
  const lessonIds: string[] = [];
  for (const sectionId of sectionIds) {
    const e = await edit(courseId, sectionId, lead);
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', lead.request, {
        courseId,
        sectionId,
        expectedVersion: e.editVersion,
        kind: 'text',
        ...buildTitle(),
      }),
    );
    lessonIds.push(lessonId);
    const l = (await edit(courseId, sectionId, lead)).lessons[0] as { version: number };
    value(
      await s.call('saveTextLessonBody', lead.request, {
        courseId,
        sectionId,
        lessonId,
        expectedVersion: l.version,
        language: 'bn',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'পাঠ' }] }],
        },
      }),
    );
    const w = await edit(courseId, sectionId, lead);
    value(
      await s.call('selfApproveSection', lead.request, {
        courseId,
        sectionId,
        expectedVersion: w.working?.version,
      }),
    );
  }
  const r = value<{
    courseVersion: number;
    sections: Array<{ sectionId: string; workingVersion: number }>;
  }>(await s.call('getPublishReadiness', lead.request, { courseId }));
  value(
    await s.call('publishCourse', lead.request, {
      courseId,
      expectedVersion: r.courseVersion,
      sectionVersions: r.sections.map((x) => ({
        sectionId: x.sectionId,
        expectedVersion: x.workingVersion,
      })),
    }),
  );
  return { lead, courseId, sectionIds, lessonIds };
}

const UNDER_TAKEDOWN = {
  ok: false,
  error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.underTakedown' },
};

/** Every U2 write a staff member could try on the course or a section, with current tokens. */
async function writeAttempts(courseId: string, sectionId: string, lead: Caller) {
  const v = await view(courseId, lead);
  const e = await edit(courseId, sectionId, lead);
  const lesson = e.lessons[0] as { lessonId: string; version: number };
  const base = { courseId, sectionId };
  return {
    setCoursePrice: { courseId, expectedVersion: v.course.version, price: '600' },
    setCourseDescription: {
      courseId,
      expectedVersion: v.course.version,
      descriptionBn: 'x',
      descriptionEn: '',
    },
    addSection: { courseId, expectedVersion: v.course.version, ...buildTitle() },
    retireCourse: { courseId, expectedVersion: v.course.version },
    publishCourse: { courseId, expectedVersion: v.course.version, sectionVersions: [] },
    editSectionTitle: { ...base, expectedVersion: e.editVersion, ...buildTitle() },
    addLesson: { ...base, expectedVersion: e.editVersion, kind: 'text', ...buildTitle() },
    editLesson: {
      ...base,
      lessonId: lesson.lessonId,
      expectedVersion: lesson.version,
      ...buildTitle(),
    },
    assignSection: {
      ...base,
      assigneeId: lead.userId,
      expectedOwnershipVersion: v.sections.find((x) => x.sectionId === sectionId)?.ownershipVersion,
    },
  } as Record<string, Record<string, unknown>>;
}

describe('course takedown', () => {
  it('hides a published course, refuses every write for the Lead and an Admin, and restores with the same notice only', async () => {
    const { lead, courseId, sectionIds } = await published();
    const notice = randomUUID();
    expect(await takedown(hideContent, 'course', courseId, notice)).toEqual({
      ok: true,
      value: undefined,
    });
    expect((await view(courseId, lead)).course.status).toBe('hidden');
    const attempts = await writeAttempts(courseId, sectionIds[0] as string, lead);
    for (const [name, input] of Object.entries(attempts)) {
      for (const caller of [lead, s.admin]) {
        const result = await s.call(name, caller.request, input);
        expect({ name, result }).toMatchObject({ name, result: UNDER_TAKEDOWN });
      }
    }
    expect((await edit(courseId, sectionIds[0] as string, lead)).isUnderTakedown).toBe(true);
    // Idempotent repeat; another notice is refused.
    expect((await takedown(hideContent, 'course', courseId, notice)).ok).toBe(true);
    expect(await takedown(hideContent, 'course', courseId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(await takedown(restoreContent, 'course', courseId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect((await takedown(restoreContent, 'course', courseId, notice)).ok).toBe(true);
    expect((await view(courseId, lead)).course.status).toBe('published');
    // Writes work again after the restore.
    const v = await view(courseId, lead);
    value(
      await s.call('setCourseDescription', lead.request, {
        courseId,
        expectedVersion: v.course.version,
        descriptionBn: 'নতুন',
        descriptionEn: '',
      }),
    );
  });

  it('audits each change once and emits ContentVisibilityChanged with IDs only', async () => {
    const { courseId } = await published();
    const notice = randomUUID();
    await takedown(hideContent, 'course', courseId, notice);
    await takedown(hideContent, 'course', courseId, notice);
    await takedown(restoreContent, 'course', courseId, notice);
    const audit = await s.t.pool.query(
      `SELECT action FROM audit_log_entry WHERE subject_id = $1 AND action LIKE 'catalog.content.%' ORDER BY occurred_at`,
      [courseId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'catalog.content.hidden',
      'catalog.content.restored',
    ]);
    const events = await s.t.pool.query(
      `SELECT payload FROM outbox_event WHERE event_type = 'catalog.ContentVisibilityChanged' AND aggregate_key = $1 ORDER BY recorded_at`,
      [courseId],
    );
    expect(events.rows.map((r) => r.payload.action)).toEqual(['hide', 'restore']);
    expect(events.rows[0]?.payload).toMatchObject({
      courseId,
      contentRef: { type: 'course', id: courseId },
      takedownNoticeId: notice,
    });
  });

  it('a draft course cannot be hidden, and an unknown reference is NOT_FOUND', async () => {
    const lead = await s.newInstructor();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      }),
    );
    expect(await takedown(hideContent, 'course', courseId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    for (const type of ['course', 'section', 'lesson'] as const) {
      expect(await takedown(hideContent, type, randomUUID(), randomUUID())).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(
      await withTransaction(getDb(), (tx) =>
        hideContent(tx, { contentRef: { type: 'course', id: 'nope' }, takedownNoticeId: 'nope' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('a hidden retired course restores to retired', async () => {
    const { lead, courseId } = await published();
    value(
      await s.call('retireCourse', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
      }),
    );
    const notice = randomUUID();
    value(await takedown(hideContent, 'course', courseId, notice));
    value(await takedown(restoreContent, 'course', courseId, notice));
    expect((await view(courseId, lead)).course.status).toBe('retired');
  });
});

describe('section and lesson takedown', () => {
  it('a hidden section refuses its writes; the other section stays editable; a publish including it is refused', async () => {
    const { lead, courseId, sectionIds } = await published();
    const [hidden, other] = sectionIds as [string, string];
    const notice = randomUUID();
    value(await takedown(hideContent, 'section', hidden, notice));
    const attempts = await writeAttempts(courseId, hidden, lead);
    for (const name of ['editSectionTitle', 'addLesson', 'editLesson', 'assignSection']) {
      expect({ name, result: await s.call(name, lead.request, attempts[name]) }).toMatchObject({
        name,
        result: UNDER_TAKEDOWN,
      });
    }
    const otherEdit = await edit(courseId, other, lead);
    value(
      await s.call('editSectionTitle', lead.request, {
        courseId,
        sectionId: other,
        expectedVersion: otherEdit.editVersion,
        ...buildTitle(),
      }),
    );
    value(await takedown(restoreContent, 'section', hidden, notice));
    expect((await edit(courseId, hidden, lead)).isUnderTakedown).toBe(false);
  });

  it('a hidden lesson refuses its edit and blocks the publish of its section', async () => {
    const { lead, courseId, sectionIds, lessonIds } = await published();
    const sectionId = sectionIds[0] as string;
    const lessonId = lessonIds[0] as string;
    // A working copy with an approved change exists before the takedown.
    const e = await edit(courseId, sectionId, lead);
    value(
      await s.call('editSectionTitle', lead.request, {
        courseId,
        sectionId,
        expectedVersion: e.editVersion,
        ...buildTitle(),
      }),
    );
    const w = await edit(courseId, sectionId, lead);
    value(
      await s.call('selfApproveSection', lead.request, {
        courseId,
        sectionId,
        expectedVersion: w.working?.version,
      }),
    );
    const notice = randomUUID();
    value(await takedown(hideContent, 'lesson', lessonId, notice));
    const after = await edit(courseId, sectionId, lead);
    expect(after.lessons[0]?.isUnderTakedown).toBe(true);
    const r = value<{
      courseVersion: number;
      sections: Array<{ sectionId: string; workingVersion: number | null }>;
      refusalKey: string | null;
    }>(await s.call('getPublishReadiness', lead.request, { courseId }));
    expect(r.refusalKey).toBe('errors.catalog.underTakedown');
    expect(
      await s.call('publishCourse', lead.request, {
        courseId,
        expectedVersion: r.courseVersion,
        sectionVersions: r.sections
          .filter((x) => x.workingVersion !== null)
          .map((x) => ({ sectionId: x.sectionId, expectedVersion: x.workingVersion })),
      }),
    ).toMatchObject(UNDER_TAKEDOWN);
    expect((await takedown(restoreContent, 'lesson', lessonId, randomUUID())).ok).toBe(false);
    value(await takedown(restoreContent, 'lesson', lessonId, notice));
  });

  it('never-published sections and lessons cannot be hidden', async () => {
    const lead = await s.newInstructor();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      }),
    );
    const sectionId = (await view(courseId, lead)).sections[0]?.sectionId as string;
    const e = await edit(courseId, sectionId, lead);
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', lead.request, {
        courseId,
        sectionId,
        expectedVersion: e.editVersion,
        kind: 'quiz',
        ...buildTitle(),
      }),
    );
    expect((await takedown(hideContent, 'section', sectionId, randomUUID())).ok).toBe(false);
    expect((await takedown(hideContent, 'lesson', lessonId, randomUUID())).ok).toBe(false);
  });
});
