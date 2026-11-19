// [AT] Step 12: Given/When/Then acceptance tests for the create part of US3.0 and for US3.1, US3.2,
// US3.3, US3.4 and US3.5, written from stories.md and the rules.md error mapping before any
// implementation. They call the real server functions through their real builders on a per-file
// schema with real Better Auth sessions.
// Deferred (recorded in traceability.json): AC3.3.3 completes in u3-commerce Code Generation (CR-4;
// the U2 lock function is exercised here), and the grade-final half of AC3.5.3 completes in
// u4-learning (CR-7). AC3.1.3's student S4 read arrives with Bolt 4; here a draft answers
// not-found to an unrelated instructor and is never shown to a Student.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as catalogModule from '#src/features/catalog/index.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

type Contract5 = {
  lockAccessDuration(
    tx: TxHandle,
    courseId: string,
  ): Promise<{ ok: boolean; value?: { accessDurationMonths: number; lockedAt: string } }>;
};

/** Contract 5 additions (CR-4), looked up at call time so a missing export fails its test only. */
function contract5(): Contract5 {
  const api = catalogModule as unknown as Partial<Contract5>;
  if (typeof api.lockAccessDuration !== 'function') {
    throw new Error('lockAccessDuration is not exported from src/features/catalog/index.ts');
  }
  return api as Contract5;
}

const schemaModules = import.meta.glob('/src/features/catalog/server/catalog.schema.ts');
async function sharedSchema(): Promise<{
  CreateCourseInput: { safeParse(v: unknown): { success: boolean } };
}> {
  const load = schemaModules['/src/features/catalog/server/catalog.schema.ts'];
  if (!load) throw new Error('src/features/catalog/server/catalog.schema.ts does not exist');
  return (await load()) as never;
}

let s: ServerFnHarness;
let lead: Caller;
let tasnim: Caller;
let stranger: Caller;
let goalId: string;
let inactiveGoalId: string;

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

type SectionView = {
  sectionId: string;
  position: number;
  titleBn: string;
  titleEn: string;
  ownerId: string | null;
  ownershipVersion: number | null;
  workingVersion: number | null;
  workingReviewState: string | null;
  structureState: string;
  canEdit: boolean;
};
type CourseView = {
  course: {
    courseId: string;
    status: string;
    leadInstructorId: string | null;
    goalId: string;
    listPricePoisha: number | null;
    accessDurationMonths: number | null;
    durationLockedAt: string | null;
    version: number;
  };
  role: 'lead' | 'co_instructor' | 'admin';
  canManageCourse: boolean;
  sections: SectionView[];
};

beforeAll(async () => {
  s = await createServerFnHarness();
  lead = s.instructor;
  tasnim = await s.newInstructor();
  stranger = await s.newInstructor();
  const segment = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segment.segmentId)),
  ).goalId;
  inactiveGoalId = value<{ goalId: string }>(
    await s.call(
      'saveGoal',
      s.admin.request,
      buildGoalInput(segment.segmentId, { status: 'inactive' }),
    ),
  ).goalId;
});
afterAll(async () => {
  await s?.close();
});

// NFR6.216 allows 10 course creations per instructor per Dhaka day. This file creates more than
// that, so a fresh Lead takes over between tests well before the limit (the limit itself is
// exercised in catalog.rate-limit.int.test.ts).
let coursesByLead = 0;
beforeEach(async () => {
  if (coursesByLead >= 6) {
    lead = await s.newInstructor();
    coursesByLead = 0;
  }
});

async function createCourse(sectionCount = 2, caller: Caller = lead) {
  const sections = Array.from({ length: sectionCount }, () => buildTitle());
  if (caller === lead) coursesByLead += 1;
  return value<{ courseId: string; version: number }>(
    await s.call('createCourse', caller.request, { goalId, ...buildTitle(), sections }),
  );
}

async function view(courseId: string, caller: Caller = lead): Promise<CourseView> {
  return value<CourseView>(await s.call('getCourseForEditing', caller.request, { courseId }));
}

async function auditRows(subjectId: string) {
  const { rows } = await s.t.pool.query<{ action: string; before: unknown; after: unknown }>(
    'SELECT action, before, after FROM audit_log_entry WHERE subject_id = $1 ORDER BY occurred_at',
    [subjectId],
  );
  return rows;
}

let boundsSet = false;
async function ensurePriceBounds() {
  if (boundsSet) return;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'acceptance test bounds',
      }),
    );
  }
  boundsSet = true;
}

describe('US3.1 Create a course draft', () => {
  it('AC3.1.1 Given I am an Instructor, When I create a course with both titles, a Goal and 4 sections, Then a draft exists with me as its only Lead', async () => {
    const created = await createCourse(4);
    const v = await view(created.courseId);
    expect(v.course).toMatchObject({ status: 'draft', leadInstructorId: lead.userId, goalId });
    expect(v.role).toBe('lead');
    expect(v.sections).toHaveLength(4);
    expect(v.sections.map((x) => x.position)).toEqual([1, 2, 3, 4]);
    // BR6.4: every section is owned by the Lead by default, with a draft working copy.
    for (const section of v.sections) {
      expect(section).toMatchObject({ ownerId: lead.userId, workingReviewState: 'draft' });
    }
    expect((await auditRows(created.courseId)).map((r) => r.action)).toContain(
      'catalog.course.created',
    );
  });

  it('AC3.1.2 Given the Goal is empty, When I save, Then validation refuses it with the same Zod schema on the form and the server', async () => {
    const input = { goalId: '', ...buildTitle(), sections: [] };
    const before = await s.t.pool.query('SELECT count(*)::int AS n FROM course');
    const refused = await s.call('createCourse', lead.request, input);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { goalId: expect.any(Array) } },
    });
    expect((await sharedSchema()).CreateCourseInput.safeParse(input).success).toBe(false);
    // An inactive Goal is refused on the same field (BR1.9, BR4.2).
    expect(
      await s.call('createCourse', lead.request, { goalId: inactiveGoalId, ...buildTitle() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { goalId: expect.any(Array) } },
    });
    const after = await s.t.pool.query('SELECT count(*)::int AS n FROM course');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('AC3.1.3 Given a draft course, When someone outside it asks for it, Then they get not-found and a Student is refused', async () => {
    const created = await createCourse(1);
    expect(
      await s.call('getCourseForEditing', stranger.request, { courseId: created.courseId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' },
    });
    const student = await s.newStudent();
    const refused = await s.call('getCourseForEditing', student.request, {
      courseId: created.courseId,
    });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(created.courseId);
  });
});

describe('US3.0 Course lifecycle (create part)', () => {
  it('AC3.0.1 (create) Given an Admin, When they create a course without a Lead, Then the draft has no owner until a Lead is set', async () => {
    const created = value<{ courseId: string }>(
      await s.call('createCourse', s.admin.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      }),
    );
    const v = await view(created.courseId, s.admin);
    expect(v.course.leadInstructorId).toBeNull();
    expect(v.role).toBe('admin');
    expect(v.sections[0]?.ownerId).toBeNull();
  });

  it('AC3.0.1 (create) Given an Admin, When they name a Lead without the Instructor role, Then the Lead field is refused', async () => {
    const student = await s.newStudent();
    expect(
      await s.call('createCourse', s.admin.request, {
        goalId,
        ...buildTitle(),
        leadInstructorId: student.userId,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { leadInstructorId: expect.any(Array) } },
    });
    const withLead = value<{ courseId: string }>(
      await s.call('createCourse', s.admin.request, {
        goalId,
        ...buildTitle(),
        leadInstructorId: lead.userId,
      }),
    );
    expect((await view(withLead.courseId)).course.leadInstructorId).toBe(lead.userId);
  });

  it('UC24 Given a draft course, When the Lead adds, reorders and removes sections, Then positions stay 1..n and a stale version is refused', async () => {
    const created = await createCourse(2);
    const added = value<{ sectionId: string; version: number }>(
      await s.call('addSection', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        ...buildTitle(),
      }),
    );
    let v = await view(created.courseId);
    expect(v.sections.at(-1)).toMatchObject({ sectionId: added.sectionId, position: 3 });
    const reversed = [...v.sections].reverse().map((x) => x.sectionId);
    value(
      await s.call('reorderSections', lead.request, {
        courseId: created.courseId,
        expectedVersion: v.course.version,
        sectionIds: reversed,
      }),
    );
    v = await view(created.courseId);
    expect(v.sections.map((x) => x.sectionId)).toEqual(reversed);
    // A stale Course.version is refused and nothing changes (BR12.1).
    expect(
      await s.call('removeSection', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        sectionId: reversed[0],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
    // A never-published section is removed at once and the rest renumber (BR8.12 case A).
    value(
      await s.call('removeSection', lead.request, {
        courseId: created.courseId,
        expectedVersion: v.course.version,
        sectionId: reversed[0],
      }),
    );
    v = await view(created.courseId);
    expect(v.sections.map((x) => x.sectionId)).toEqual(reversed.slice(1));
    expect(v.sections.map((x) => x.position)).toEqual([1, 2]);
  });
});

describe('US3.2 Set the course price', () => {
  it('UC8 E2 Given the price bounds are not set, When the Lead saves a price, Then it is refused with SETTING_NOT_SET', async () => {
    const created = await createCourse(1);
    expect(
      await s.call('setCoursePrice', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        price: '1499.50',
      }),
    ).toMatchObject({ ok: false, error: { code: 'SETTING_NOT_SET' } });
  });

  it.each([
    ['1499.50', 'latin'],
    ['১৪৯৯.৫০', 'bangla'],
  ])(
    'AC3.2.1 Given a draft course, When I enter %s (%s digits), Then it is stored as 149950 poisha',
    async (price) => {
      await ensurePriceBounds();
      const created = await createCourse(1);
      const saved = value<{ listPricePoisha: number }>(
        await s.call('setCoursePrice', lead.request, {
          courseId: created.courseId,
          expectedVersion: created.version,
          price,
        }),
      );
      expect(saved.listPricePoisha).toBe(149950);
      expect((await view(created.courseId)).course.listPricePoisha).toBe(149950);
    },
  );

  it.each(['-5', '1.234', '10.', '1,499', '৳10', '1e3', '99999999.99'])(
    'AC3.2.2 Given the price %s, When I save, Then validation refuses it and the price is unchanged',
    async (price) => {
      await ensurePriceBounds();
      const created = await createCourse(1);
      expect(
        await s.call('setCoursePrice', lead.request, {
          courseId: created.courseId,
          expectedVersion: created.version,
          price,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', fieldErrors: { price: expect.any(Array) } },
      });
      expect((await view(created.courseId)).course.listPricePoisha).toBeNull();
    },
  );

  it('AC3.2.3 Given a priced course, When the price changes, Then the change is audit-logged with the old and new poisha', async () => {
    await ensurePriceBounds();
    const created = await createCourse(1);
    const first = value<{ version: number }>(
      await s.call('setCoursePrice', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        price: '1000',
      }),
    );
    value(
      await s.call('setCoursePrice', lead.request, {
        courseId: created.courseId,
        expectedVersion: first.version,
        price: '1200.25',
      }),
    );
    const changes = (await auditRows(created.courseId)).filter(
      (r) => r.action === 'catalog.course.priceChanged',
    );
    expect(changes.at(-1)).toMatchObject({
      before: expect.objectContaining({ listPricePoisha: 100000 }),
      after: expect.objectContaining({ listPricePoisha: 120025 }),
    });
  });
});

describe('US3.3 Set the access duration', () => {
  it('AC3.3.1 Given a course with no enrolments, When I choose 6 months, Then it is saved', async () => {
    const created = await createCourse(1);
    value(
      await s.call('setAccessDuration', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        months: 6,
      }),
    );
    expect((await view(created.courseId)).course.accessDurationMonths).toBe(6);
  });

  it.each([5, 0, 24, 6.5])(
    'AC3.3.2 Given %s months is sent to the server function, When it validates, Then it is refused',
    async (months) => {
      const created = await createCourse(1);
      expect(
        await s.call('setAccessDuration', lead.request, {
          courseId: created.courseId,
          expectedVersion: created.version,
          months,
        }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    },
  );

  it('AC3.3.3 (U2 half, CR-4) Given the duration was locked by the first enrolment, When I change it, Then it is refused with durationLocked', async () => {
    const created = await createCourse(1);
    const set = value<{ version: number }>(
      await s.call('setAccessDuration', lead.request, {
        courseId: created.courseId,
        expectedVersion: created.version,
        months: 4,
      }),
    );
    const locked = await withTransaction(getDb(), (tx) =>
      contract5().lockAccessDuration(tx, created.courseId),
    );
    expect(locked).toMatchObject({ ok: true, value: { accessDurationMonths: 4 } });
    expect(
      await s.call('setAccessDuration', lead.request, {
        courseId: created.courseId,
        expectedVersion: set.version,
        months: 12,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.durationLocked' },
    });
    expect((await view(created.courseId)).course.durationLockedAt).not.toBeNull();
  });
});

async function assignTo(courseId: string, sectionId: string, assignee: Caller, by = lead) {
  const v = await view(courseId, by);
  const section = v.sections.find((x) => x.sectionId === sectionId);
  return s.call('assignSection', by.request, {
    courseId,
    sectionId,
    assigneeId: assignee.userId,
    expectedOwnershipVersion: section?.ownershipVersion,
  });
}

describe('US3.4 Assign Co-instructors to sections', () => {
  it('AC3.4.1 Given my draft course, When I assign Tasnim to a section, Then she sees the course with only that section editable and the change is recorded', async () => {
    const created = await createCourse(2);
    const [english, bangla] = (await view(created.courseId)).sections;
    value(await assignTo(created.courseId, english?.sectionId as string, tasnim));
    const hers = await view(created.courseId, tasnim);
    expect(hers.role).toBe('co_instructor');
    expect(hers.sections.find((x) => x.sectionId === english?.sectionId)?.canEdit).toBe(true);
    expect(hers.sections.find((x) => x.sectionId === bangla?.sectionId)?.canEdit).toBe(false);
    const periods = await s.t.pool.query<{ instructor_id: string; valid_to: Date | null }>(
      'SELECT instructor_id, valid_to FROM ownership_period WHERE section_id = $1 ORDER BY valid_from',
      [english?.sectionId],
    );
    expect(periods.rows.map((r) => r.instructor_id)).toEqual([lead.userId, tasnim.userId]);
    expect(periods.rows[0]?.valid_to).toBeInstanceOf(Date);
    expect(periods.rows[1]?.valid_to).toBeNull();
    const notices = await s.t.pool.query(
      `SELECT payload FROM outbox_event WHERE aggregate_key = $1
         AND payload->>'templateKey' = 'notify.catalog.sectionAssigned'`,
      [tasnim.userId],
    );
    expect(notices.rows).toHaveLength(1);
    // IDs only: no title travels in the notification (BR12.4).
    expect(JSON.stringify(notices.rows[0])).not.toContain(english?.titleEn as string);
  });

  it('AC3.4.2 Given I am a Co-instructor, When I try to assign sections, Then it is refused with notLead', async () => {
    const created = await createCourse(2);
    const [mine, other] = (await view(created.courseId)).sections;
    value(await assignTo(created.courseId, mine?.sectionId as string, tasnim));
    const refused = await assignTo(created.courseId, other?.sectionId as string, tasnim, tasnim);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
  });

  it('AC3.4.3 Given a section is reassigned mid-cycle, When its history is read, Then each earlier owner and their time span are kept', async () => {
    const created = await createCourse(1);
    const [section] = (await view(created.courseId)).sections;
    const sectionId = section?.sectionId as string;
    value(await assignTo(created.courseId, sectionId, tasnim));
    value(await assignTo(created.courseId, sectionId, stranger));
    const { rows } = await s.t.pool.query<{
      instructor_id: string;
      valid_from: Date;
      valid_to: Date | null;
      reason: string;
    }>(
      'SELECT instructor_id, valid_from, valid_to, reason FROM ownership_period WHERE section_id = $1 ORDER BY valid_from',
      [sectionId],
    );
    expect(rows.map((r) => r.instructor_id)).toEqual([lead.userId, tasnim.userId, stranger.userId]);
    expect(rows.map((r) => r.reason)).toEqual(['default_lead', 'assigned', 'reassigned']);
    // Contiguous: each period ends exactly where the next begins.
    expect(rows[0]?.valid_to?.getTime()).toBe(rows[1]?.valid_from.getTime());
    expect(rows[1]?.valid_to?.getTime()).toBe(rows[2]?.valid_from.getTime());
    expect(rows[2]?.valid_to).toBeNull();
  });
});

describe('US3.5 Co-instructors edit only their own sections', () => {
  it('AC3.5.1 Given I own a section, When I edit it, Then the change saves into the draft working copy', async () => {
    const created = await createCourse(2);
    const [english] = (await view(created.courseId)).sections;
    value(await assignTo(created.courseId, english?.sectionId as string, tasnim));
    const before = (await view(created.courseId, tasnim)).sections[0] as SectionView;
    const titles = buildTitle();
    value(
      await s.call('editSectionTitle', tasnim.request, {
        courseId: created.courseId,
        sectionId: before.sectionId,
        expectedVersion: before.workingVersion,
        ...titles,
      }),
    );
    const after = (await view(created.courseId, tasnim)).sections[0] as SectionView;
    expect(after).toMatchObject({ ...titles, workingReviewState: 'draft' });
    expect(after.workingVersion).toBe((before.workingVersion as number) + 1);
  });

  it("AC3.5.2 Given I don't own a section, When I call its edit function directly, Then it is refused with notSectionOwner and nothing changes", async () => {
    const created = await createCourse(2);
    const [english, bangla] = (await view(created.courseId)).sections;
    value(await assignTo(created.courseId, english?.sectionId as string, tasnim));
    const refused = await s.call('editSectionTitle', tasnim.request, {
      courseId: created.courseId,
      sectionId: bangla?.sectionId,
      expectedVersion: bangla?.workingVersion,
      ...buildTitle(),
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' },
    });
    const unchanged = (await view(created.courseId)).sections.find(
      (x) => x.sectionId === bangla?.sectionId,
    );
    expect(unchanged).toMatchObject({ titleEn: bangla?.titleEn, workingVersion: 1 });
  });

  it('AC3.5.3 (U2 half) Given I am a Co-instructor, When I look for or call Lead-only actions, Then they are not offered and the server refuses them with notLead', async () => {
    await ensurePriceBounds();
    const created = await createCourse(2);
    const [mine, other] = (await view(created.courseId)).sections;
    value(await assignTo(created.courseId, mine?.sectionId as string, tasnim));
    const hers = await view(created.courseId, tasnim);
    expect(hers.canManageCourse).toBe(false);
    const version = hers.course.version;
    const calls: Array<[string, Record<string, unknown>]> = [
      ['setCoursePrice', { price: '1000' }],
      ['setAccessDuration', { months: 6 }],
      ['addSection', buildTitle()],
      ['reorderSections', { sectionIds: [other?.sectionId, mine?.sectionId] }],
      ['removeSection', { sectionId: other?.sectionId }],
    ];
    for (const [name, data] of calls) {
      expect(
        await s.call(name, tasnim.request, {
          courseId: created.courseId,
          expectedVersion: version,
          ...data,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
      });
    }
  });
});
