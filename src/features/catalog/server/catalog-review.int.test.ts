// [LT] Step 23: review transitions through the real builders on a per-file schema with real Better
// Auth sessions. The NFR6.202 negative matrix (Finance included), the review history (BR8.7), the
// races of functional-spec §7 (BR12.1, BR12.2: parallel decisions, reassignment during review), and
// the IDs-only notifications and audit entries (BR12.4).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLessonMedia } from '#src/features/catalog/index.ts';
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
let finance: Caller;

type SectionEdit = {
  editVersion: number;
  working: { version: number; reviewState: string } | null;
  lessons: Array<{ lessonId: string; version: number }>;
};

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
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

const edit = async (courseId: string, sectionId: string, caller: Caller) =>
  value<SectionEdit>(await s.call('getSectionForEditing', caller.request, { courseId, sectionId }));

/** A Lead, a Co-instructor owning section 1 with one complete text lesson, and section 2 (Lead's). */
async function fixture() {
  const lead = await s.newInstructor();
  const co = await s.newInstructor();
  const { courseId } = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: [buildTitle(), buildTitle()],
    }),
  );
  const v = value<{ sections: Array<{ sectionId: string; ownershipVersion: number }> }>(
    await s.call('getCourseForEditing', lead.request, { courseId }),
  );
  const [first, second] = v.sections as [
    { sectionId: string; ownershipVersion: number },
    { sectionId: string },
  ];
  value(
    await s.call('assignSection', lead.request, {
      courseId,
      sectionId: first.sectionId,
      assigneeId: co.userId,
      expectedOwnershipVersion: first.ownershipVersion,
    }),
  );
  for (const [owner, sectionId] of [
    [co, first.sectionId],
    [lead, second.sectionId],
  ] as const) {
    const e = await edit(courseId, sectionId, owner);
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', owner.request, {
        courseId,
        sectionId,
        expectedVersion: e.editVersion,
        kind: 'text',
        ...buildTitle(),
      }),
    );
    const l = (await edit(courseId, sectionId, owner)).lessons[0] as { version: number };
    value(
      await s.call('saveTextLessonBody', owner.request, {
        courseId,
        sectionId,
        lessonId,
        expectedVersion: l.version,
        language: 'en',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lesson' }] }],
        },
      }),
    );
  }
  return { lead, co, courseId, coSectionId: first.sectionId, leadSectionId: second.sectionId };
}

async function act(name: string, caller: Caller, courseId: string, sectionId: string, extra = {}) {
  const e = await edit(courseId, sectionId, caller);
  return s.call(name, caller.request, {
    courseId,
    sectionId,
    expectedVersion: e.working?.version,
    ...extra,
  });
}

async function history(sectionId: string) {
  const { rows } = await s.t.pool.query<{ action: string; from_state: string; to_state: string }>(
    'SELECT action, from_state, to_state FROM section_review WHERE section_id = $1 ORDER BY decided_at, section_review_id',
    [sectionId],
  );
  return rows.map((r) => `${r.action}:${r.from_state}>${r.to_state}`);
}

describe('NFR6.202 negative matrix (review)', () => {
  const ALL = [
    'submitSection',
    'approveSection',
    'returnSection',
    'selfApproveSection',
    'reopenSection',
  ];
  let inputs: Record<string, unknown>;
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
    const e = await edit(f.courseId, f.coSectionId, f.co);
    inputs = {
      courseId: f.courseId,
      sectionId: f.coSectionId,
      expectedVersion: e.working?.version,
      comment: 'x',
    };
  });

  it.each(ALL)('%s refuses an anonymous caller', async (name) => {
    expect(await s.call(name, s.anonymous(), inputs)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(ALL)('%s refuses a Student', async (name) => {
    const student = await s.newStudent();
    expect(await s.call(name, student.request, inputs)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it.each(ALL)('%s refuses Finance staff', async (name) => {
    expect(await s.call(name, finance.request, inputs)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it.each(ALL)('%s refuses an Admin without step-up', async (name) => {
    expect(await s.call(name, s.adminWithoutStepUp.request, inputs)).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
  });
  it.each(ALL)("%s answers not-found to another course's instructor", async (name) => {
    const outsider = await s.newInstructor();
    expect(await s.call(name, outsider.request, inputs)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
  it.each(['approveSection', 'returnSection', 'selfApproveSection'])(
    '%s refuses a Co-instructor with notLead',
    async (name) => {
      expect(await s.call(name, f.co.request, inputs)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
      });
    },
  );
  it.each(['submitSection', 'reopenSection'])(
    "%s refuses the Lead on a Co-instructor's section (notSectionOwner)",
    async (name) => {
      expect(await s.call(name, f.lead.request, inputs)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' },
      });
    },
  );
});

describe('the review chain (UC13, UC14)', () => {
  it('submit, approve, reopen, resubmit and return are each recorded once, in order (BR8.7)', async () => {
    const { lead, co, courseId, coSectionId } = await fixture();
    value(await act('submitSection', co, courseId, coSectionId));
    value(await act('approveSection', lead, courseId, coSectionId));
    value(await act('reopenSection', co, courseId, coSectionId));
    value(await act('submitSection', co, courseId, coSectionId));
    value(await act('returnSection', lead, courseId, coSectionId, { comment: 'আরও উদাহরণ দিন' }));
    expect(await history(coSectionId)).toEqual([
      'submitted:draft>in_review',
      'approved:in_review>approved',
      'reopened:approved>draft',
      'submitted:draft>in_review',
      'returned:in_review>draft',
    ]);
    // The audit references the review but never copies the comment (BR12.3).
    const { rows } = await s.t.pool.query(
      `SELECT action, after FROM audit_log_entry WHERE subject_id = $1 AND action LIKE 'catalog.section.%'`,
      [coSectionId],
    );
    expect(JSON.stringify(rows)).not.toContain('উদাহরণ');
    expect(rows.map((r) => r.action)).toContain('catalog.section.returned');
  });

  it('the Lead self-approves their own complete section; not a section someone else owns', async () => {
    const { lead, courseId, coSectionId, leadSectionId } = await fixture();
    value(await act('selfApproveSection', lead, courseId, leadSectionId));
    expect((await edit(courseId, leadSectionId, lead)).working?.reviewState).toBe('approved');
    expect(await history(leadSectionId)).toEqual(['self_approved:draft>approved']);
    expect(await act('selfApproveSection', lead, courseId, coSectionId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });

  it('an Admin may approve; an approve of a copy not in review is INVALID_STATE', async () => {
    const { co, courseId, coSectionId } = await fixture();
    expect(await act('approveSection', s.admin, courseId, coSectionId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.invalidTransition' },
    });
    value(await act('submitSection', co, courseId, coSectionId));
    value(await act('approveSection', s.admin, courseId, coSectionId));
  });

  it('a new video asset cannot bind to a copy in review (BR7.6)', async () => {
    const { co, courseId, coSectionId } = await fixture();
    const e = await edit(courseId, coSectionId, co);
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', co.request, {
        courseId,
        sectionId: coSectionId,
        expectedVersion: e.editVersion,
        kind: 'video',
        ...buildTitle(),
      }),
    );
    await withTransaction(getDb(), async (tx) => {
      await setLessonMedia(tx, { lessonId, videoAssetId: randomUUID(), mediaStatus: 'ready' });
    });
    value(await act('submitSection', co, courseId, coSectionId));
    await withTransaction(getDb(), async (tx) => {
      expect(
        await setLessonMedia(tx, { lessonId, videoAssetId: randomUUID(), mediaStatus: 'ready' }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    });
  });
});

describe('races (functional-spec §7)', () => {
  it('two decisions on the same token: exactly one commits, the other is stale', async () => {
    const { lead, co, courseId, coSectionId } = await fixture();
    value(await act('submitSection', co, courseId, coSectionId));
    const token = (await edit(courseId, coSectionId, lead)).working?.version;
    const input = { courseId, sectionId: coSectionId, expectedVersion: token };
    const results = await Promise.all([
      s.call('approveSection', lead.request, input),
      s.call('returnSection', s.admin.request, { ...input, comment: 'fix' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { code: 'CONFLICT' } });
    expect((await history(coSectionId)).length).toBe(2);
  });

  it('a reassignment during review resets the copy to draft, and the old approve token is stale', async () => {
    const { lead, co, courseId, coSectionId } = await fixture();
    value(await act('submitSection', co, courseId, coSectionId));
    const stale = (await edit(courseId, coSectionId, lead)).working?.version;
    const v = value<{ sections: Array<{ sectionId: string; ownershipVersion: number }> }>(
      await s.call('getCourseForEditing', lead.request, { courseId }),
    );
    const section = v.sections.find((x) => x.sectionId === coSectionId) as {
      ownershipVersion: number;
    };
    value(
      await s.call('assignSection', lead.request, {
        courseId,
        sectionId: coSectionId,
        assigneeId: lead.userId,
        expectedOwnershipVersion: section.ownershipVersion,
      }),
    );
    expect((await edit(courseId, coSectionId, lead)).working?.reviewState).toBe('draft');
    expect(
      await s.call('approveSection', lead.request, {
        courseId,
        sectionId: coSectionId,
        expectedVersion: stale,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    // The former owner can no longer submit (BR6.8).
    expect(
      await s.call('submitSection', co.request, {
        courseId,
        sectionId: coSectionId,
        expectedVersion: stale,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('an incomplete copy is refused at submit and nothing changes (BR7.3)', async () => {
    const { co, courseId, coSectionId } = await fixture();
    const e = await edit(courseId, coSectionId, co);
    value(
      await s.call('addLesson', co.request, {
        courseId,
        sectionId: coSectionId,
        expectedVersion: e.editVersion,
        kind: 'quiz',
        ...buildTitle(),
      }),
    );
    const before = await edit(courseId, coSectionId, co);
    expect(await act('submitSection', co, courseId, coSectionId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.incompleteLessons' },
    });
    const after = await edit(courseId, coSectionId, co);
    expect(after.working).toEqual(before.working);
    expect(await history(coSectionId)).toEqual([]);
  });
});
