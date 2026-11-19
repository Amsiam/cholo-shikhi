// [LT] Step 24: publish, republish, unpublish and retire through the real builders on a per-file
// schema with real Better Auth sessions: the NFR6.202 matrix (Finance included), BR12.2 (a section
// that changed after the dialog loaded refuses the whole publish), first-publish times that never
// move, the outbox event and audit entry inside the publish transaction, the SD-212 blocked-link
// refusal shape (contract 1, no new code), removal and re-ordering applied at publish, and the
// lifecycle refusals.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppError } from '#src/lib/errors.ts';
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

type CourseView = {
  course: { courseId: string; status: string; version: number; firstPublishedAt: string | null };
  sections: Array<{
    sectionId: string;
    ownershipVersion: number;
    position: number;
    structureState: string;
  }>;
};
type Readiness = {
  courseVersion: number;
  sections: Array<{ sectionId: string; workingVersion: number | null; willPublish: boolean }>;
  missingCaptionLessonIds: string[];
  blockedLinkLessonIds: string[];
  refusalKey: string | null;
};
type SectionEdit = {
  editVersion: number;
  working: { version: number } | null;
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

const view = async (courseId: string, caller: Caller) =>
  value<CourseView>(await s.call('getCourseForEditing', caller.request, { courseId }));
const edit = async (courseId: string, sectionId: string, caller: Caller) =>
  value<SectionEdit>(await s.call('getSectionForEditing', caller.request, { courseId, sectionId }));
const readiness = async (courseId: string, caller: Caller) =>
  value<Readiness>(await s.call('getPublishReadiness', caller.request, { courseId }));

const body = (...hrefs: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Lesson' },
        ...hrefs.map((href) => ({
          type: 'text',
          text: 'see',
          marks: [{ type: 'link', attrs: { href } }],
        })),
      ],
    },
  ],
});

async function textLesson(
  caller: Caller,
  courseId: string,
  sectionId: string,
  hrefs: string[] = [],
) {
  const e = await edit(courseId, sectionId, caller);
  const { lessonId } = value<{ lessonId: string }>(
    await s.call('addLesson', caller.request, {
      courseId,
      sectionId,
      expectedVersion: e.editVersion,
      kind: 'text',
      ...buildTitle(),
    }),
  );
  const l = (await edit(courseId, sectionId, caller)).lessons.find(
    (x) => x.lessonId === lessonId,
  ) as {
    version: number;
  };
  value(
    await s.call('saveTextLessonBody', caller.request, {
      courseId,
      sectionId,
      lessonId,
      expectedVersion: l.version,
      language: 'bn',
      body: body(...hrefs),
    }),
  );
  return lessonId;
}

async function selfApprove(lead: Caller, courseId: string, sectionId: string) {
  const e = await edit(courseId, sectionId, lead);
  value(
    await s.call('selfApproveSection', lead.request, {
      courseId,
      sectionId,
      expectedVersion: e.working?.version,
    }),
  );
}

/** A priced, timed, described draft with `n` Lead-owned sections, each holding one text lesson. */
async function ready(n = 1, options: { approve?: boolean; hrefs?: string[] } = {}) {
  const lead = await s.newInstructor();
  const { courseId } = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: Array.from({ length: n }, () => buildTitle()),
    }),
  );
  for (const [name, extra] of [
    ['setCoursePrice', { price: '999' }],
    ['setAccessDuration', { months: 4 }],
    ['setCourseDescription', { descriptionBn: '', descriptionEn: 'A course' }],
  ] as const) {
    const v = await view(courseId, lead);
    value(
      await s.call(name, lead.request, { courseId, expectedVersion: v.course.version, ...extra }),
    );
  }
  const sectionIds = (await view(courseId, lead)).sections.map((x) => x.sectionId);
  const lessonIds: string[] = [];
  for (const sectionId of sectionIds) {
    lessonIds.push(await textLesson(lead, courseId, sectionId, options.hrefs ?? []));
    if (options.approve !== false) await selfApprove(lead, courseId, sectionId);
  }
  return { lead, courseId, sectionIds, lessonIds };
}

async function publish(caller: Caller, courseId: string, acknowledge: string[] = []) {
  const r = await readiness(courseId, caller);
  return s.call('publishCourse', caller.request, {
    courseId,
    expectedVersion: r.courseVersion,
    sectionVersions: r.sections
      .filter((x) => x.workingVersion !== null)
      .map((x) => ({ sectionId: x.sectionId, expectedVersion: x.workingVersion })),
    acknowledgedMissingCaptions: acknowledge,
  });
}

const counts = async (courseId: string) => {
  const { rows } = await s.t.pool.query<{ outbox: number; audit: number }>(
    `SELECT (SELECT count(*)::int FROM outbox_event WHERE event_type = 'catalog.CoursePublished' AND aggregate_key = $1) AS outbox,
            (SELECT count(*)::int FROM audit_log_entry WHERE subject_id = $1 AND action LIKE 'catalog.course.%ublished') AS audit`,
    [courseId],
  );
  return rows[0] as { outbox: number; audit: number };
};

describe('NFR6.202 negative matrix (lifecycle)', () => {
  const ALL = [
    'getPublishReadiness',
    'publishCourse',
    'unpublishCourse',
    'retireCourse',
    'setCourseDescription',
  ];
  const LEAD_ONLY = ['publishCourse', 'unpublishCourse', 'retireCourse', 'setCourseDescription'];
  let inputs: Record<string, Record<string, unknown>>;
  let co: Caller;
  beforeAll(async () => {
    const f = await ready(2);
    co = await s.newInstructor();
    const second = (await view(f.courseId, f.lead)).sections[1] as CourseView['sections'][number];
    value(
      await s.call('assignSection', f.lead.request, {
        courseId: f.courseId,
        sectionId: second.sectionId,
        assigneeId: co.userId,
        expectedOwnershipVersion: second.ownershipVersion,
      }),
    );
    const version = (await view(f.courseId, f.lead)).course.version;
    const base = { courseId: f.courseId, expectedVersion: version };
    inputs = {
      getPublishReadiness: { courseId: f.courseId },
      publishCourse: { ...base, sectionVersions: [], acknowledgedMissingCaptions: [] },
      unpublishCourse: base,
      retireCourse: base,
      setCourseDescription: { ...base, descriptionBn: 'x', descriptionEn: '' },
    };
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
  it.each(ALL.filter((n) => n !== 'unpublishCourse'))(
    "%s answers not-found to another course's instructor",
    async (name) => {
      const outsider = await s.newInstructor();
      expect(await s.call(name, outsider.request, inputs[name])).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    },
  );
  it('unpublishCourse answers FEATURE_DISABLED to everyone while catalog.unpublish is off (CR-5 fallback), then applies the course checks once on', async () => {
    const outsider = await s.newInstructor();
    for (const caller of [outsider, co, s.admin]) {
      expect(await s.call('unpublishCourse', caller.request, inputs.unpublishCourse)).toMatchObject(
        {
          ok: false,
          error: { code: 'FEATURE_DISABLED' },
        },
      );
    }
    value(
      await s.call('saveFlag', s.admin.request, {
        flagKey: 'catalog.unpublish',
        description: 'LT: unpublish on',
        state: 'on',
      }),
    );
    expect(await s.call('unpublishCourse', outsider.request, inputs.unpublishCourse)).toMatchObject(
      {
        ok: false,
        error: { code: 'NOT_FOUND' },
      },
    );
    expect(await s.call('unpublishCourse', co.request, inputs.unpublishCourse)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
    // A draft cannot be unpublished (BR4.3).
    expect(await s.call('unpublishCourse', s.admin.request, inputs.unpublishCourse)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });
  it.each(LEAD_ONLY.filter((n) => n !== 'unpublishCourse'))(
    '%s refuses a Co-instructor with notLead',
    async (name) => {
      expect(await s.call(name, co.request, inputs[name])).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
      });
    },
  );
  it('a Co-instructor may read the publish readiness of their course', async () => {
    expect((await s.call('getPublishReadiness', co.request, inputs.getPublishReadiness)).ok).toBe(
      true,
    );
  });
});

describe('publish (UC15)', () => {
  it('BR12.2: a section that changed after the dialog loaded refuses the whole publish', async () => {
    const { lead, courseId, sectionIds } = await ready(2);
    const r = await readiness(courseId, lead);
    // The Lead reopens one approved section after the dialog loaded its token.
    const e = await edit(courseId, sectionIds[1] as string, lead);
    value(
      await s.call('reopenSection', lead.request, {
        courseId,
        sectionId: sectionIds[1],
        expectedVersion: e.working?.version,
      }),
    );
    const refused = await s.call('publishCourse', lead.request, {
      courseId,
      expectedVersion: r.courseVersion,
      sectionVersions: r.sections.map((x) => ({
        sectionId: x.sectionId,
        expectedVersion: x.workingVersion,
      })),
    });
    expect(refused.ok).toBe(false);
    const v = await view(courseId, lead);
    expect(v.course.status).toBe('draft');
    const { rows } = await s.t.pool.query(
      `SELECT count(*)::int AS n FROM section_review WHERE section_id = ANY($1) AND action = 'published'`,
      [sectionIds],
    );
    expect(rows[0].n).toBe(0);
    expect(await counts(courseId)).toEqual({ outbox: 0, audit: 0 });
  });

  it('writes the CoursePublished outbox event and the audit entry in the publish transaction (IDs only)', async () => {
    const { lead, courseId } = await ready();
    value(await publish(lead, courseId));
    expect(await counts(courseId)).toEqual({ outbox: 1, audit: 1 });
    const { rows } = await s.t.pool.query(
      `SELECT payload FROM outbox_event WHERE event_type = 'catalog.CoursePublished' AND aggregate_key = $1`,
      [courseId],
    );
    expect(rows[0]?.payload).toMatchObject({
      courseId,
      goalId,
      action: 'published',
      actorId: lead.userId,
    });
    expect(Object.keys(rows[0]?.payload).sort()).toEqual([
      'action',
      'actorId',
      'courseId',
      'goalId',
      'occurredAt',
    ]);
  });

  it('a republish supersedes the live version, keeps first-publish times, and leaves drafts out', async () => {
    const { lead, courseId, sectionIds, lessonIds } = await ready(2);
    value(await publish(lead, courseId));
    const first = await s.t.pool.query(
      `SELECT c.first_published_at AS course, l.first_published_at AS lesson
         FROM course c, lesson l WHERE c.course_id = $1 AND l.lesson_id = $2`,
      [courseId, lessonIds[0]],
    );
    // Section 1 gets an approved edit; section 2 a draft edit that stays out.
    for (const sectionId of sectionIds) {
      const e = await edit(courseId, sectionId, lead);
      const lesson = e.lessons[0] as { lessonId: string; version: number };
      value(
        await s.call('editLesson', lead.request, {
          courseId,
          sectionId,
          lessonId: lesson.lessonId,
          expectedVersion: lesson.version,
          ...buildTitle(),
        }),
      );
    }
    await selfApprove(lead, courseId, sectionIds[0] as string);
    const result = value<{ publishedSectionIds: string[]; leftOutSectionIds: string[] }>(
      await publish(lead, courseId),
    );
    expect(result).toMatchObject({
      publishedSectionIds: [sectionIds[0]],
      leftOutSectionIds: [sectionIds[1]],
    });
    const again = await s.t.pool.query(
      `SELECT c.first_published_at AS course, l.first_published_at AS lesson
         FROM course c, lesson l WHERE c.course_id = $1 AND l.lesson_id = $2`,
      [courseId, lessonIds[0]],
    );
    expect(again.rows[0]).toEqual(first.rows[0]);
    const { rows } = await s.t.pool.query(
      `SELECT review_state FROM section_version WHERE section_id = $1 ORDER BY version_number`,
      [sectionIds[0]],
    );
    expect(rows.map((r) => r.review_state)).toEqual(['superseded', 'published']);
    const outbox = await s.t.pool.query(
      `SELECT payload->>'action' AS action FROM outbox_event WHERE aggregate_key = $1 ORDER BY recorded_at`,
      [courseId],
    );
    expect(outbox.rows.map((r) => r.action)).toEqual(['published', 'republished']);
    // Nothing approved now: a republish is refused.
    expect(await publish(lead, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.nothingToPublish' },
    });
  });

  it('applies a pending removal and pending positions at publish (BR8.12, BR9.4)', async () => {
    const { lead, courseId, sectionIds, lessonIds } = await ready(3);
    value(await publish(lead, courseId));
    let v = await view(courseId, lead);
    value(
      await s.call('removeSection', lead.request, {
        courseId,
        expectedVersion: v.course.version,
        sectionId: sectionIds[0],
      }),
    );
    v = await view(courseId, lead);
    value(
      await s.call('reorderSections', lead.request, {
        courseId,
        expectedVersion: v.course.version,
        sectionIds: [sectionIds[2], sectionIds[0], sectionIds[1]],
      }),
    );
    value(await publish(lead, courseId));
    v = await view(courseId, lead);
    expect(v.sections.map((x) => [x.sectionId, x.position])).toEqual([
      [sectionIds[2], 1],
      [sectionIds[1], 2],
    ]);
    const { rows } = await s.t.pool.query(
      `SELECT s.structure_state, l.live_state, (SELECT count(*)::int FROM ownership_period o WHERE o.section_id = s.section_id AND o.valid_to IS NULL) AS open
         FROM section s JOIN lesson l ON l.section_id = s.section_id WHERE s.section_id = $1`,
      [sectionIds[0]],
    );
    expect(rows[0]).toMatchObject({ structure_state: 'removed', live_state: 'withdrawn', open: 0 });
    expect(lessonIds).toHaveLength(3);
  });

  it('an Admin direct publish is refused naming an incomplete section (BR9.3)', async () => {
    const { courseId, sectionIds, lead } = await ready(2, { approve: false });
    const e = await edit(courseId, sectionIds[1] as string, lead);
    value(
      await s.call('addLesson', lead.request, {
        courseId,
        sectionId: sectionIds[1],
        expectedVersion: e.editVersion,
        kind: 'video',
        ...buildTitle(),
      }),
    );
    expect(await publish(s.admin, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.publishPreconditions' },
    });
    const r = await readiness(courseId, s.admin);
    expect(r.refusalKey).toBe('errors.catalog.publishPreconditions');
  });
});

describe('SD-212 blocked links at publish', () => {
  it('refuses the whole publish as VALIDATION_FAILED keyed by section, lesson, language and link', async () => {
    const { lead, courseId, sectionIds, lessonIds } = await ready(1, {
      hrefs: ['https://ok.example.com/', 'https://x.spam.example/'],
    });
    await s.t.pool.query(
      `INSERT INTO blocked_domain (domain, created_by) VALUES ('spam.example', $1)`,
      [s.admin.userId],
    );
    try {
      const r = await readiness(courseId, lead);
      expect(r).toMatchObject({
        blockedLinkLessonIds: [lessonIds[0]],
        refusalKey: 'errors.catalog.blockedLink',
      });
      const refused = await publish(lead, courseId);
      expect(refused).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          i18nKey: 'errors.common.VALIDATION_FAILED',
          fieldErrors: {
            [`sections.${sectionIds[0]}.lessons.${lessonIds[0]}.bodyBn.links.1`]: [
              'errors.catalog.blockedLink',
            ],
          },
        },
      });
      // Contract 1: the refusal is an ordinary AppError; no new code is introduced.
      const typed: AppError<'VALIDATION_FAILED'> = refused.error as AppError<'VALIDATION_FAILED'>;
      expect(typed.code).toBe('VALIDATION_FAILED');
      expect((await view(courseId, lead)).course.status).toBe('draft');
      expect(await counts(courseId)).toEqual({ outbox: 0, audit: 0 });
    } finally {
      await s.t.pool.query(`DELETE FROM blocked_domain WHERE domain = 'spam.example'`);
    }
    value(await publish(lead, courseId));
  });
});

describe('unpublish and retire (UC16)', () => {
  it('a draft cannot be retired; a hidden course refuses with underTakedown', async () => {
    const { lead, courseId } = await ready();
    const version = (await view(courseId, lead)).course.version;
    expect(
      await s.call('retireCourse', lead.request, { courseId, expectedVersion: version }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.invalidTransition' },
    });
    value(await publish(lead, courseId));
    await s.t.pool.query(
      `UPDATE course SET status = 'hidden', status_before_hidden = 'published' WHERE course_id = $1`,
      [courseId],
    );
    const v = await view(courseId, lead);
    expect(
      await s.call('retireCourse', lead.request, { courseId, expectedVersion: v.course.version }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.underTakedown' },
    });
  });

  it('retire writes an audit entry and the retired lifecycle event', async () => {
    const { lead, courseId } = await ready();
    value(await publish(lead, courseId));
    const v = await view(courseId, lead);
    value(
      await s.call('retireCourse', s.admin.request, {
        courseId,
        expectedVersion: v.course.version,
      }),
    );
    const { rows } = await s.t.pool.query(
      `SELECT payload->>'action' AS action FROM outbox_event WHERE aggregate_key = $1 ORDER BY recorded_at`,
      [courseId],
    );
    expect(rows.map((r) => r.action)).toEqual(['published', 'retired']);
  });

  it('setCourseDescription refuses over 5,000 characters and stores empty as null', async () => {
    const { lead, courseId } = await ready();
    const v = await view(courseId, lead);
    expect(
      await s.call('setCourseDescription', lead.request, {
        courseId,
        expectedVersion: v.course.version,
        descriptionBn: 'ক'.repeat(5001),
        descriptionEn: '',
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { descriptionBn: ['errors.catalog.descriptionTooLong'] } },
    });
    value(
      await s.call('setCourseDescription', lead.request, {
        courseId,
        expectedVersion: v.course.version,
        descriptionBn: 'ক'.repeat(5000),
        descriptionEn: '   ',
      }),
    );
    const { rows } = await s.t.pool.query(
      'SELECT description_en FROM course WHERE course_id = $1',
      [courseId],
    );
    expect(rows[0]?.description_en).toBeNull();
  });
});

// [AT] BR9.6 / NFR6.217 (AC3.8.1): every committed publish, republish, unpublish and retire notifies
// the Admins in the same transaction, IDs and enums only (BR12.4); a refused publish notifies nobody.
describe('BR9.6 / NFR6.217: lifecycle changes notify the Admins', () => {
  /** NotificationRequested rows of notify.catalog.coursePublished for one course. */
  async function adminNotices(courseId: string) {
    const { rows } = await s.t.pool.query<{
      recipient: string;
      dedupe: string;
      action: string;
      params: Record<string, unknown>;
      channels: string[];
    }>(
      `SELECT payload->>'recipientUserId' AS recipient, payload->>'dedupeKey' AS dedupe,
              payload->'params'->>'action' AS action, payload->'params' AS params,
              payload->'channels' AS channels
         FROM outbox_event
        WHERE event_type = 'notifications.NotificationRequested'
          AND payload->>'templateKey' = 'notify.catalog.coursePublished'
          AND payload->'params'->>'courseId' = $1
        ORDER BY recorded_at, recipient`,
      [courseId],
    );
    return rows;
  }
  async function activeAdmins(): Promise<string[]> {
    const { rows } = await s.t.pool.query<{ user_id: string }>(
      `SELECT user_id FROM staff_role_assignment WHERE role = 'admin' AND revoked_at IS NULL`,
    );
    return rows.map((r) => r.user_id).sort();
  }

  it('Given a ready course, When its Lead publishes, Then every Admin gets one IDs-only notice', async () => {
    const { lead, courseId } = await ready();
    value(await publish(lead, courseId));
    const notices = await adminNotices(courseId);
    const admins = await activeAdmins();
    expect(admins.length).toBeGreaterThanOrEqual(1);
    expect(notices.map((n) => n.recipient).sort()).toEqual(admins);
    for (const notice of notices) {
      expect(notice.action).toBe('published');
      expect(Object.keys(notice.params).sort()).toEqual(['action', 'courseId']);
      expect(notice.channels).toEqual(['in_app']);
    }
    expect(new Set(notices.map((n) => n.dedupe)).size).toBe(notices.length);
  });

  it('Given a refused publish, When nothing commits, Then no Admin is notified', async () => {
    const { lead, courseId } = await ready(1, { approve: false });
    expect((await publish(lead, courseId)).ok).toBe(false);
    expect(await adminNotices(courseId)).toEqual([]);
  });

  it('Given a published course, When it is republished and retired, Then each change notifies the Admins with its action', async () => {
    const { lead, courseId, sectionIds } = await ready();
    value(await publish(lead, courseId));
    const sectionId = sectionIds[0] as string;
    const e = await edit(courseId, sectionId, lead);
    const lesson = e.lessons[0] as { lessonId: string; version: number };
    value(
      await s.call('editLesson', lead.request, {
        courseId,
        sectionId,
        lessonId: lesson.lessonId,
        expectedVersion: lesson.version,
        ...buildTitle(),
      }),
    );
    await selfApprove(lead, courseId, sectionId);
    value(await publish(lead, courseId));
    const v = await view(courseId, lead);
    value(
      await s.call('retireCourse', lead.request, { courseId, expectedVersion: v.course.version }),
    );
    const admins = await activeAdmins();
    const byAction = (action: string) =>
      (adminNotices(courseId) as Promise<Array<{ action: string; recipient: string }>>).then(
        (rows) =>
          rows
            .filter((r) => r.action === action)
            .map((r) => r.recipient)
            .sort(),
      );
    expect(await byAction('published')).toEqual(admins);
    expect(await byAction('republished')).toEqual(admins);
    expect(await byAction('retired')).toEqual(admins);
  });

  it('Given an Admin retires a course, Then the other Admins are notified but not the acting Admin', async () => {
    // A second Admin (a synthetic account given the role directly), so "the others" is not empty.
    const second = await s.newStudent();
    await s.t.pool.query(
      `INSERT INTO staff_role_assignment (user_id, role, assigned_by) VALUES ($1, 'admin', $2)`,
      [second.userId, s.admin.userId],
    );
    const { lead, courseId } = await ready();
    value(await publish(lead, courseId));
    const v = await view(courseId, lead);
    value(
      await s.call('retireCourse', s.admin.request, {
        courseId,
        expectedVersion: v.course.version,
      }),
    );
    const retired = (await adminNotices(courseId)).filter((n) => n.action === 'retired');
    expect(retired.map((n) => n.recipient)).not.toContain(s.admin.userId);
    expect(retired.map((n) => n.recipient)).toContain(second.userId);
    expect(retired.map((n) => n.recipient).sort()).toEqual(
      (await activeAdmins()).filter((id) => id !== s.admin.userId),
    );
  });
});
