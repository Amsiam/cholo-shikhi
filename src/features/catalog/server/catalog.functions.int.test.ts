// [LT] Step 17: Catalog core server functions through their real builders, on a per-file schema
// with real Better Auth sessions. The full NFR6.202 negative matrix per function (anonymous,
// Student, Finance, Admin without step-up, another course's instructor, a Co-instructor on a Lead
// action, a former owner after reassignment), plus the behaviour the acceptance file does not
// cover: listMyCourses, removeCoInstructor, BR6.6 work-in-progress reset, removal of a live section
// and its cancellation, the last-section guard and the audit trail.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

let s: ServerFnHarness;
let lead: Caller;
let co: Caller;
let outsider: Caller;
let finance: Caller;
let goalId: string;

type Section = {
  sectionId: string;
  ownerId: string | null;
  ownershipVersion: number | null;
  workingVersion: number | null;
  workingVersionId: string | null;
  workingReviewState: string | null;
  structureState: string;
  position: number;
};
type View = { course: { courseId: string; version: number }; sections: Section[] };

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

beforeAll(async () => {
  s = await createServerFnHarness();
  lead = s.instructor;
  co = await s.newInstructor();
  outsider = await s.newInstructor();
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

// NFR6.216: rotate the Lead well before the 10-per-day course limit.
let coursesByLead = 0;
beforeEach(async () => {
  if (coursesByLead >= 6) {
    lead = await s.newInstructor();
    coursesByLead = 0;
  }
});

async function createCourse(sectionCount = 2) {
  coursesByLead += 1;
  return value<{ courseId: string; version: number }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: Array.from({ length: sectionCount }, () => buildTitle()),
    }),
  );
}

const view = async (courseId: string, caller: Caller = lead) =>
  value<View>(await s.call('getCourseForEditing', caller.request, { courseId }));

async function assign(courseId: string, sectionId: string, to: Caller) {
  const section = (await view(courseId)).sections.find((x) => x.sectionId === sectionId);
  return s.call('assignSection', lead.request, {
    courseId,
    sectionId,
    assigneeId: to.userId,
    expectedOwnershipVersion: section?.ownershipVersion,
  });
}

/** A course with two sections, the first owned by the Co-instructor; every input shape filled. */
async function fixture() {
  const course = await createCourse(2);
  const [first, second] = (await view(course.courseId)).sections as [Section, Section];
  value(await assign(course.courseId, first.sectionId, co));
  const v = await view(course.courseId);
  const mine = v.sections.find((x) => x.sectionId === first.sectionId) as Section;
  const inputs: Record<string, Record<string, unknown>> = {
    createCourse: { goalId, ...buildTitle() },
    listMyCourses: { page: 1, pageSize: 20 },
    getCourseForEditing: { courseId: course.courseId },
    setCoursePrice: { courseId: course.courseId, expectedVersion: v.course.version, price: '1000' },
    setAccessDuration: { courseId: course.courseId, expectedVersion: v.course.version, months: 6 },
    assignSection: {
      courseId: course.courseId,
      sectionId: second.sectionId,
      assigneeId: co.userId,
      expectedOwnershipVersion: second.ownershipVersion,
    },
    removeCoInstructor: {
      courseId: course.courseId,
      instructorId: co.userId,
      sections: [{ sectionId: mine.sectionId, expectedOwnershipVersion: mine.ownershipVersion }],
    },
    editSectionTitle: {
      courseId: course.courseId,
      sectionId: second.sectionId,
      expectedVersion: second.workingVersion,
      ...buildTitle(),
    },
    addSection: { courseId: course.courseId, expectedVersion: v.course.version, ...buildTitle() },
    reorderSections: {
      courseId: course.courseId,
      expectedVersion: v.course.version,
      sectionIds: [second.sectionId, first.sectionId],
    },
    removeSection: {
      courseId: course.courseId,
      expectedVersion: v.course.version,
      sectionId: second.sectionId,
    },
    cancelSectionRemoval: {
      courseId: course.courseId,
      expectedVersion: v.course.version,
      sectionId: second.sectionId,
    },
  };
  return { course, first: mine, second, inputs };
}

const ALL = [
  'createCourse',
  'listMyCourses',
  'getCourseForEditing',
  'setCoursePrice',
  'setAccessDuration',
  'assignSection',
  'removeCoInstructor',
  'editSectionTitle',
  'addSection',
  'reorderSections',
  'removeSection',
  'cancelSectionRemoval',
];
const COURSE_SCOPED = ALL.filter((n) => n !== 'createCourse' && n !== 'listMyCourses');
const LEAD_ONLY = [
  'setCoursePrice',
  'setAccessDuration',
  'assignSection',
  'removeCoInstructor',
  'addSection',
  'reorderSections',
  'removeSection',
  'cancelSectionRemoval',
];

describe('NFR6.202 negative matrix', () => {
  let inputs: Record<string, Record<string, unknown>>;
  beforeAll(async () => {
    inputs = (await fixture()).inputs;
  });

  it.each(ALL)('%s refuses an anonymous caller', async (name) => {
    expect(await s.call(name, s.anonymous(), inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it.each(ALL)('%s refuses a Student', async (name) => {
    const student = await s.newStudent();
    expect(await s.call(name, student.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it.each(ALL)('%s refuses Finance staff', async (name) => {
    expect(await s.call(name, finance.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it.each(ALL)('%s refuses an Admin without step-up', async (name) => {
    expect(await s.call(name, s.adminWithoutStepUp.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
  });

  it.each(COURSE_SCOPED)("%s answers not-found to another course's instructor", async (name) => {
    expect(await s.call(name, outsider.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' },
    });
  });

  it.each(LEAD_ONLY)('%s refuses a Co-instructor with notLead', async (name) => {
    expect(await s.call(name, co.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
  });
});

describe('former owner after reassignment', () => {
  it('a Co-instructor whose only section moved away loses the course (not-found)', async () => {
    const { course, first } = await fixture();
    value(await assign(course.courseId, first.sectionId, outsider));
    expect(
      await s.call('getCourseForEditing', co.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      await s.call('editSectionTitle', co.request, {
        courseId: course.courseId,
        sectionId: first.sectionId,
        expectedVersion: first.workingVersion,
        ...buildTitle(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('positive paths', () => {
  it('an Admin with step-up can act as the Lead (BR6.9)', async () => {
    const { inputs } = await fixture();
    expect((await s.call('setAccessDuration', s.admin.request, inputs.setAccessDuration)).ok).toBe(
      true,
    );
  });

  it('listMyCourses lists led and co-instructed courses with isLead', async () => {
    const { course } = await fixture();
    const rows = value<{ rows: Array<{ courseId: string; isLead: boolean }> }>(
      await s.call('listMyCourses', co.request, { page: 1, pageSize: 100 }),
    ).rows;
    expect(rows).toContainEqual(
      expect.objectContaining({ courseId: course.courseId, isLead: false }),
    );
    const mine = value<{ rows: Array<{ courseId: string; isLead: boolean }> }>(
      await s.call('listMyCourses', lead.request, { page: 1, pageSize: 100 }),
    ).rows;
    expect(mine).toContainEqual(
      expect.objectContaining({ courseId: course.courseId, isLead: true }),
    );
  });

  it('removeCoInstructor returns every section to the Lead (BR6.6)', async () => {
    const { course, inputs, first } = await fixture();
    expect(
      value(await s.call('removeCoInstructor', lead.request, inputs.removeCoInstructor)),
    ).toEqual({
      reassignedSectionIds: [first.sectionId],
    });
    const after = (await view(course.courseId)).sections.find(
      (x) => x.sectionId === first.sectionId,
    );
    expect(after?.ownerId).toBe(lead.userId);
    const { rows } = await s.t.pool.query<{ reason: string }>(
      'SELECT reason FROM ownership_period WHERE section_id = $1 ORDER BY valid_from, version',
      [first.sectionId],
    );
    expect(rows.map((r) => r.reason)).toEqual([
      'default_lead',
      'assigned',
      'co_instructor_removed',
    ]);
  });

  it('removeCoInstructor refuses a stale or incomplete section list', async () => {
    const { inputs, first } = await fixture();
    expect(
      await s.call('removeCoInstructor', lead.request, {
        ...inputs.removeCoInstructor,
        sections: [{ sectionId: first.sectionId, expectedOwnershipVersion: 1 }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('a stale ownership token is refused (Lead and Admin reassign the same section)', async () => {
    const { inputs } = await fixture();
    value(await s.call('assignSection', s.admin.request, inputs.assignSection));
    expect(await s.call('assignSection', lead.request, inputs.assignSection)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
  });

  it('reassigning a section whose copy is in review sends it back to draft (BR6.6)', async () => {
    const { course, first } = await fixture();
    await s.t.pool.query(
      `UPDATE section_version SET review_state = 'in_review' WHERE section_version_id = $1`,
      [first.workingVersionId],
    );
    value(await assign(course.courseId, first.sectionId, outsider));
    const { rows } = await s.t.pool.query<{ review_state: string }>(
      'SELECT review_state FROM section_version WHERE section_version_id = $1',
      [first.workingVersionId],
    );
    expect(rows[0]?.review_state).toBe('draft');
    const reviews = await s.t.pool.query<{ action: string }>(
      'SELECT action FROM section_review WHERE section_id = $1',
      [first.sectionId],
    );
    expect(reviews.rows.map((r) => r.action)).toEqual(['reset_by_reassignment']);
  });

  it('a copy in review is read-only to its owner', async () => {
    const { course, first } = await fixture();
    await s.t.pool.query(
      `UPDATE section_version SET review_state = 'in_review' WHERE section_version_id = $1`,
      [first.workingVersionId],
    );
    expect(
      await s.call('editSectionTitle', co.request, {
        courseId: course.courseId,
        sectionId: first.sectionId,
        expectedVersion: first.workingVersion,
        ...buildTitle(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.workingCopyReadOnly' },
    });
  });

  it('assigning to someone without the Instructor role is a field error (BR6.3)', async () => {
    const { inputs } = await fixture();
    const student = await s.newStudent();
    expect(
      await s.call('assignSection', lead.request, {
        ...inputs.assignSection,
        assigneeId: student.userId,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { assigneeId: expect.any(Array) } },
    });
  });
});

/** Makes a section live as a publish would (publishing itself arrives in Bolt 3). */
async function makeLive(courseId: string, section: Section) {
  await s.t.pool.query(
    `UPDATE section_version SET review_state = 'published', published_at = now()
     WHERE section_version_id = $1`,
    [section.workingVersionId],
  );
  await s.t.pool.query(
    `UPDATE section SET live_version_id = $2, working_version_id = NULL, first_published_at = now()
     WHERE section_id = $1`,
    [section.sectionId, section.workingVersionId],
  );
  await s.t.pool.query(
    `UPDATE course SET status = 'published', first_published_at = now() WHERE course_id = $1`,
    [courseId],
  );
}

describe('structure on a published course (BR8.11, BR8.12)', () => {
  it('a live section becomes removal_pending, can be cancelled, and the last active one is kept', async () => {
    const { course, first, second } = await fixture();
    await makeLive(course.courseId, first);
    await makeLive(course.courseId, second);
    let v = await view(course.courseId);
    const removed = value<{ structureState: string; version: number }>(
      await s.call('removeSection', lead.request, {
        courseId: course.courseId,
        expectedVersion: v.course.version,
        sectionId: second.sectionId,
      }),
    );
    expect(removed.structureState).toBe('removal_pending');
    expect(
      await s.call('removeSection', lead.request, {
        courseId: course.courseId,
        expectedVersion: removed.version,
        sectionId: first.sectionId,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.catalog.lastSection' } });
    value(
      await s.call('cancelSectionRemoval', lead.request, {
        courseId: course.courseId,
        expectedVersion: removed.version,
        sectionId: second.sectionId,
      }),
    );
    v = await view(course.courseId);
    expect(v.sections.map((x) => x.structureState)).toEqual(['active', 'active']);
  });

  it('a reorder on a published course is held as pendingPosition', async () => {
    const { course, first, second } = await fixture();
    await makeLive(course.courseId, first);
    const v = await view(course.courseId);
    value(
      await s.call('reorderSections', lead.request, {
        courseId: course.courseId,
        expectedVersion: v.course.version,
        sectionIds: [second.sectionId, first.sectionId],
      }),
    );
    const { rows } = await s.t.pool.query<{
      section_id: string;
      position: number;
      pending_position: number;
    }>(
      'SELECT section_id, position, pending_position FROM section WHERE course_id = $1 ORDER BY position',
      [course.courseId],
    );
    expect(rows).toEqual([
      { section_id: first.sectionId, position: 1, pending_position: 2 },
      { section_id: second.sectionId, position: 2, pending_position: 1 },
    ]);
  });

  it('the first edit of a live section copies it into a new working copy (BR8.1)', async () => {
    const { course, first } = await fixture();
    await makeLive(course.courseId, first);
    const titles = buildTitle();
    const edited = value<{ sectionVersionId: string; version: number }>(
      await s.call('editSectionTitle', co.request, {
        courseId: course.courseId,
        sectionId: first.sectionId,
        expectedVersion: 1,
        ...titles,
      }),
    );
    expect(edited.sectionVersionId).not.toBe(first.workingVersionId);
    const v = await view(course.courseId, co);
    expect(v.sections.find((x) => x.sectionId === first.sectionId)).toMatchObject({
      ...titles,
      workingReviewState: 'draft',
    });
  });

  it('a removed section discards its working copy and closes its ownership period', async () => {
    const { course, second } = await fixture();
    const v = await view(course.courseId);
    value(
      await s.call('removeSection', lead.request, {
        courseId: course.courseId,
        expectedVersion: v.course.version,
        sectionId: second.sectionId,
      }),
    );
    const state = await s.t.pool.query(
      'SELECT review_state FROM section_version WHERE section_id = $1',
      [second.sectionId],
    );
    expect(state.rows[0]?.review_state).toBe('discarded');
    const open = await s.t.pool.query(
      'SELECT count(*)::int AS n FROM ownership_period WHERE section_id = $1 AND valid_to IS NULL',
      [second.sectionId],
    );
    expect(open.rows[0]?.n).toBe(0);
    const actions = await s.t.pool.query<{ action: string }>(
      'SELECT action FROM audit_log_entry WHERE subject_id = $1',
      [second.sectionId],
    );
    expect(actions.rows.map((r) => r.action)).toContain('catalog.section.removed');
  });
});

// [AT] BR4.7 (R-02): only an Admin changes a course's Lead. The new Lead must hold the Instructor
// role; every live section the old Lead owned moves to the new Lead (the open period is closed and a
// lead_changed period opens at the same instant); a Co-instructor's sections stay theirs; the change
// is audit-logged. Committed failing before the implementation.
describe('changeLead (BR4.7, Admin only)', () => {
  const leadOf = async (courseId: string) =>
    (
      await s.t.pool.query<{ lead: string | null }>(
        'SELECT lead_instructor_id AS lead FROM course WHERE course_id = $1',
        [courseId],
      )
    ).rows[0]?.lead ?? null;
  const periods = async (sectionId: string) =>
    (
      await s.t.pool.query<{
        instructor: string;
        reason: string;
        validFrom: Date;
        validTo: Date | null;
      }>(
        `SELECT instructor_id AS instructor, reason, valid_from AS "validFrom", valid_to AS "validTo"
           FROM ownership_period WHERE section_id = $1 ORDER BY valid_from, valid_to NULLS LAST`,
        [sectionId],
      )
    ).rows;

  async function input(courseId: string, newLeadId: string) {
    return { courseId, newLeadId, expectedVersion: (await view(courseId)).course.version };
  }

  describe('negative matrix', () => {
    let data: { courseId: string; newLeadId: string; expectedVersion: number };
    beforeAll(async () => {
      const { course } = await fixture();
      data = await input(course.courseId, outsider.userId);
    });

    it('refuses an anonymous caller', async () => {
      expect(await s.call('changeLead', s.anonymous(), data)).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    });
    it('refuses the wrong role: the course Lead, a Co-instructor, Finance and a Student', async () => {
      const student = await s.newStudent();
      for (const caller of [lead, co, finance, student]) {
        expect(await s.call('changeLead', caller.request, data)).toMatchObject({
          ok: false,
          error: { code: 'FORBIDDEN' },
        });
      }
    });
    it("refuses the wrong user: another course's Lead naming themself", async () => {
      expect(
        await s.call('changeLead', outsider.request, { ...data, newLeadId: outsider.userId }),
      ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await leadOf(data.courseId)).toBe(lead.userId);
    });
    it('refuses an Admin without step-up', async () => {
      expect(await s.call('changeLead', s.adminWithoutStepUp.request, data)).toMatchObject({
        ok: false,
        error: { code: 'STEP_UP_REQUIRED' },
      });
    });
    it('refuses a malformed request through the shared schema', async () => {
      expect(
        await s.call('changeLead', s.admin.request, { ...data, newLeadId: 'not-an-id' }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    });
  });

  it('Given a new Lead without the Instructor role, When an Admin changes the Lead, Then VALIDATION_FAILED and nothing changes', async () => {
    const { course } = await fixture();
    const student = await s.newStudent();
    expect(
      await s.call('changeLead', s.admin.request, await input(course.courseId, student.userId)),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { newLeadId: ['errors.catalog.leadNotInstructor'] },
      },
    });
    expect(await leadOf(course.courseId)).toBe(lead.userId);
  });

  it("Given a course with a Co-instructor, When an Admin names a new Lead, Then the old Lead's sections move, the Co-instructor's stay, and it is audited", async () => {
    const { course, first, second } = await fixture();
    const oldLead = lead.userId;
    const result = value<{ courseId: string; version: number; movedSectionIds: string[] }>(
      await s.call('changeLead', s.admin.request, await input(course.courseId, outsider.userId)),
    );
    expect(result.movedSectionIds).toEqual([second.sectionId]);
    expect(await leadOf(course.courseId)).toBe(outsider.userId);
    const moved = await periods(second.sectionId);
    expect(moved).toHaveLength(2);
    expect(moved[0]).toMatchObject({ instructor: oldLead, reason: 'default_lead' });
    expect(moved[1]).toMatchObject({
      instructor: outsider.userId,
      reason: 'lead_changed',
      validTo: null,
    });
    expect(moved[0]?.validTo?.getTime()).toBe(moved[1]?.validFrom.getTime());
    const kept = await periods(first.sectionId);
    expect(kept.at(-1)).toMatchObject({ instructor: co.userId, validTo: null });
    const audit = await s.t.pool.query(
      `SELECT actor_id AS actor, before, after FROM audit_log_entry
        WHERE subject_id = $1 AND action = 'catalog.course.leadChanged'`,
      [course.courseId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor: s.admin.userId,
      before: { leadInstructorId: oldLead },
      after: { leadInstructorId: outsider.userId, movedSectionIds: [second.sectionId] },
    });
    // The new Lead now acts as Lead; the old one no longer reaches the course.
    expect(
      (await s.call('getCourseForEditing', outsider.request, { courseId: course.courseId })).ok,
    ).toBe(true);
    expect(
      await s.call('getCourseForEditing', lead.request, { courseId: course.courseId }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('Given a stale course version, When an Admin changes the Lead, Then CONFLICT staleVersion', async () => {
    const { course } = await fixture();
    const data = await input(course.courseId, outsider.userId);
    expect(
      await s.call('changeLead', s.admin.request, {
        ...data,
        expectedVersion: data.expectedVersion + 5,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
  });

  it('Given a course under takedown, When an Admin changes the Lead, Then INVALID_STATE underTakedown (NFR6.219)', async () => {
    const { course } = await fixture();
    await s.t.pool.query(
      `UPDATE course SET status = 'hidden', status_before_hidden = 'draft' WHERE course_id = $1`,
      [course.courseId],
    );
    expect(
      await s.call('changeLead', s.admin.request, await input(course.courseId, outsider.userId)),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.underTakedown' },
    });
  });

  it('Given an Admin-created course without a Lead, When an Admin sets one, Then the new Lead owns every section (BR4.1, BR6.4)', async () => {
    const created = value<{ courseId: string }>(
      await s.call('createCourse', s.admin.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle(), buildTitle()],
      }),
    );
    expect(await leadOf(created.courseId)).toBeNull();
    const version = value<View>(
      await s.call('getCourseForEditing', s.admin.request, { courseId: created.courseId }),
    ).course.version;
    value(
      await s.call('changeLead', s.admin.request, {
        courseId: created.courseId,
        newLeadId: outsider.userId,
        expectedVersion: version,
      }),
    );
    expect(await leadOf(created.courseId)).toBe(outsider.userId);
    const sections = value<View>(
      await s.call('getCourseForEditing', outsider.request, { courseId: created.courseId }),
    ).sections;
    expect(sections.map((x) => x.ownerId)).toEqual([outsider.userId, outsider.userId]);
  });
});
