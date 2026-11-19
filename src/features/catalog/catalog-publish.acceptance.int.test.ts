// [AT] Step 20: Given/When/Then acceptance tests for US3.17, US3.9, US3.10, US3.8 and the lifecycle
// part of US3.0, written from stories.md and the rules.md error mapping before any implementation.
// They call the real server functions through their real builders on a per-file schema with real
// Better Auth sessions; the U4 status pushes (contract 5, CR-8) are called in-process in their own
// transaction, as ContentDelivery and Assessment will call them.
// Deferred (recorded in traceability.json): AC3.8.4's end-to-end caption list needs U4 to push real
// caption data (u4-learning Code Generation); here the push is simulated through the CR-8 input.
// "Appears in S3 for its Goal" (AC3.0.1, AC3.8.1) is read through S3 in Bolt 4; here the course is
// published, first-published and listed as published. Enrolled-student access after unpublish
// (AC3.0.3) is applied by U3 and U4 through getProductTerms / getLessonPlacement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

type U4Ports = {
  setLessonMedia(
    tx: TxHandle,
    input: {
      lessonId: string;
      videoAssetId: string;
      mediaStatus: 'processing' | 'ready' | 'failed';
      captionLanguages?: Array<'bn' | 'en'>;
    },
  ): Promise<{ ok: boolean }>;
  setQuizContentStatus(
    tx: TxHandle,
    input: { lessonId: string; questionCount: number },
  ): Promise<{ ok: boolean }>;
};

/** Contract 5 U4 inputs (CR-8), looked up at call time so a missing export fails its test only. */
function u4(): U4Ports {
  const api = catalogModule as unknown as Partial<U4Ports>;
  if (typeof api.setLessonMedia !== 'function' || typeof api.setQuizContentStatus !== 'function') {
    throw new Error('setLessonMedia / setQuizContentStatus are not exported from catalog index.ts');
  }
  return api as U4Ports;
}

let s: ServerFnHarness;
let goalId: string;

type Lesson = {
  lessonId: string;
  kind: 'video' | 'text' | 'quiz';
  position: number;
  version: number;
  liveState: string;
  isComplete: boolean;
};
type SectionEdit = {
  editVersion: number;
  working: { version: number; reviewState: string } | null;
  lessons: Lesson[];
  lastReturnComment: string | null;
};
type CourseView = {
  course: { courseId: string; status: string; version: number; firstPublishedAt: string | null };
  sections: Array<{ sectionId: string; workingVersion: number | null; ownershipVersion: number }>;
};
type Readiness = {
  courseVersion: number;
  sections: Array<{ sectionId: string; workingVersion: number | null; willPublish: boolean }>;
  missingCaptionLessonIds: string[];
};

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

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
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'AT bounds' }),
    );
  }
});
afterAll(async () => {
  await s?.close();
});

const view = async (courseId: string, caller: Caller) =>
  value<CourseView>(await s.call('getCourseForEditing', caller.request, { courseId }));
const sectionEdit = async (courseId: string, sectionId: string, caller: Caller) =>
  value<SectionEdit>(await s.call('getSectionForEditing', caller.request, { courseId, sectionId }));

/** A Lead (fresh per fixture, so no rate limit is near) and a course with priced, timed sections. */
async function fixture(options: { sections?: number; withCo?: boolean } = {}) {
  const lead = await s.newInstructor();
  const co = await s.newInstructor();
  const created = value<{ courseId: string }>(
    await s.call('createCourse', lead.request, {
      goalId,
      ...buildTitle(),
      sections: Array.from({ length: options.sections ?? 1 }, () => buildTitle()),
    }),
  );
  const courseId = created.courseId;
  let v = await view(courseId, lead);
  value(
    await s.call('setCoursePrice', lead.request, {
      courseId,
      expectedVersion: v.course.version,
      price: '১৪৯৯',
    }),
  );
  v = await view(courseId, lead);
  value(
    await s.call('setAccessDuration', lead.request, {
      courseId,
      expectedVersion: v.course.version,
      months: 6,
    }),
  );
  v = await view(courseId, lead);
  value(
    await s.call('setCourseDescription', lead.request, {
      courseId,
      expectedVersion: v.course.version,
      descriptionBn: 'বিসিএস প্রস্তুতির কোর্স',
      descriptionEn: '',
    }),
  );
  const sectionIds = (await view(courseId, lead)).sections.map((x) => x.sectionId);
  if (options.withCo && sectionIds[0]) {
    const first = (await view(courseId, lead)).sections[0] as CourseView['sections'][number];
    value(
      await s.call('assignSection', lead.request, {
        courseId,
        sectionId: first.sectionId,
        assigneeId: co.userId,
        expectedOwnershipVersion: first.ownershipVersion,
      }),
    );
  }
  return { lead, co, courseId, sectionIds };
}

async function addLesson(
  caller: Caller,
  courseId: string,
  sectionId: string,
  kind: Lesson['kind'],
  title: { titleBn: string; titleEn: string } = buildTitle(),
) {
  const edit = await sectionEdit(courseId, sectionId, caller);
  return s.call('addLesson', caller.request, {
    courseId,
    sectionId,
    expectedVersion: edit.editVersion,
    kind,
    ...title,
  });
}

/** Adds a complete text lesson and returns its ID. */
async function addTextLesson(caller: Caller, courseId: string, sectionId: string) {
  const { lessonId } = value<{ lessonId: string }>(
    await addLesson(caller, courseId, sectionId, 'text'),
  );
  const lesson = (await sectionEdit(courseId, sectionId, caller)).lessons.find(
    (l) => l.lessonId === lessonId,
  ) as Lesson;
  value(
    await s.call('saveTextLessonBody', caller.request, {
      courseId,
      sectionId,
      lessonId,
      expectedVersion: lesson.version,
      language: 'bn',
      body: textDoc('সংখ্যা পদ্ধতির ভূমিকা'),
    }),
  );
  return lessonId;
}

async function transition(
  name: string,
  caller: Caller,
  courseId: string,
  sectionId: string,
  extra: Record<string, unknown> = {},
) {
  const edit = await sectionEdit(courseId, sectionId, caller);
  return s.call(name, caller.request, {
    courseId,
    sectionId,
    expectedVersion: edit.working?.version,
    ...extra,
  });
}

async function publish(caller: Caller, courseId: string, acknowledge: string[] = []) {
  const ready = value<Readiness>(await s.call('getPublishReadiness', caller.request, { courseId }));
  return s.call('publishCourse', caller.request, {
    courseId,
    expectedVersion: ready.courseVersion,
    sectionVersions: ready.sections
      .filter((x) => x.workingVersion !== null)
      .map((x) => ({ sectionId: x.sectionId, expectedVersion: x.workingVersion })),
    acknowledgedMissingCaptions: acknowledge,
  });
}

/** Lead-owned sections: one complete text lesson each, self-approved (BR8.6). */
async function readyToPublish(lead: Caller, courseId: string, sectionIds: string[]) {
  for (const sectionId of sectionIds) {
    await addTextLesson(lead, courseId, sectionId);
    value(await transition('selfApproveSection', lead, courseId, sectionId));
  }
}

async function outboxNotifications(templateKey: string) {
  const { rows } = await s.t.pool.query<{ payload: { recipientUserId: string } }>(
    `SELECT payload FROM outbox_event WHERE event_type = 'notifications.NotificationRequested'
       AND payload->>'templateKey' = $1`,
    [templateKey],
  );
  return rows.map((r) => r.payload);
}

describe('US3.17 Add and order lessons', () => {
  it('AC3.17.1 Given my section, When I add a text, a video and a quiz lesson and reorder them, Then they are saved in that order', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    const sectionId = sectionIds[0] as string;
    const ids: string[] = [];
    for (const kind of ['text', 'video', 'quiz'] as const) {
      ids.push(
        value<{ lessonId: string }>(await addLesson(lead, courseId, sectionId, kind)).lessonId,
      );
    }
    const order = [ids[2], ids[0], ids[1]] as string[];
    const edit = await sectionEdit(courseId, sectionId, lead);
    value(
      await s.call('reorderLessons', lead.request, {
        courseId,
        sectionId,
        expectedVersion: edit.editVersion,
        lessonIds: order,
      }),
    );
    const after = await sectionEdit(courseId, sectionId, lead);
    expect(after.lessons.map((l) => l.lessonId)).toEqual(order);
    expect(after.lessons.map((l) => l.position)).toEqual([1, 2, 3]);
    expect(after.lessons.map((l) => l.kind)).toEqual(['quiz', 'text', 'video']);
  });

  it('AC3.17.2 Given a lesson with no title in either language, When I save, Then it is refused', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    const sectionId = sectionIds[0] as string;
    const refused = await addLesson(lead, courseId, sectionId, 'text', {
      titleBn: '  ',
      titleEn: '',
    });
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { titleBn: ['errors.catalog.lessonTitleRequired'] },
      },
    });
    expect((await sectionEdit(courseId, sectionId, lead)).lessons).toHaveLength(0);
    // One language is enough (BR3.2).
    expect(
      (await addLesson(lead, courseId, sectionId, 'text', { titleBn: '', titleEn: 'Algebra' })).ok,
    ).toBe(true);
  });

  it('AC3.17.2 (BR3.4) Given a text body with an unsupported node or a non-https link, When I save, Then the field is refused and nothing is saved', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    const sectionId = sectionIds[0] as string;
    const { lessonId } = value<{ lessonId: string }>(
      await addLesson(lead, courseId, sectionId, 'text'),
    );
    const lesson = (await sectionEdit(courseId, sectionId, lead)).lessons[0] as Lesson;
    const base = { courseId, sectionId, lessonId, expectedVersion: lesson.version, language: 'en' };
    expect(
      await s.call('saveTextLessonBody', lead.request, {
        ...base,
        body: { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { bodyEn: expect.any(Array) } },
    });
    expect(
      await s.call('saveTextLessonBody', lead.request, {
        ...base,
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'link',
                  marks: [{ type: 'link', attrs: { href: 'http://example.com/' } }],
                },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { 'bodyEn.links.0': ['errors.catalog.linkInvalid'] },
      },
    });
    const after = (await sectionEdit(courseId, sectionId, lead)).lessons[0] as Lesson;
    expect(after.version).toBe(lesson.version);
  });

  it('AC3.17.3 Given a published section, When I delete a lesson, Then it is withdrawn from new viewing at the next publish and its records are kept', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    const sectionId = sectionIds[0] as string;
    const keep = await addTextLesson(lead, courseId, sectionId);
    const gone = await addTextLesson(lead, courseId, sectionId);
    value(await transition('selfApproveSection', lead, courseId, sectionId));
    value(await publish(lead, courseId));
    const { rows: before } = await s.t.pool.query(
      'SELECT first_published_at FROM lesson WHERE lesson_id = $1',
      [gone],
    );
    // The first edit after publish opens a working copy from the live version (BR8.1).
    const edit = await sectionEdit(courseId, sectionId, lead);
    value(
      await s.call('removeLesson', lead.request, {
        courseId,
        sectionId,
        expectedVersion: edit.editVersion,
        lessonId: gone,
      }),
    );
    value(await transition('selfApproveSection', lead, courseId, sectionId));
    value(await publish(lead, courseId));
    const { rows } = await s.t.pool.query(
      'SELECT lesson_id, live_state, first_published_at FROM lesson WHERE lesson_id = ANY($1)',
      [[keep, gone]],
    );
    const byId = new Map(rows.map((r) => [r.lesson_id, r]));
    expect(byId.get(gone)).toMatchObject({ live_state: 'withdrawn' });
    expect(byId.get(gone)?.first_published_at).toEqual(before[0]?.first_published_at);
    expect(byId.get(keep)).toMatchObject({ live_state: 'live' });
  });
});

describe('US3.9 Submit a section for review', () => {
  it('AC3.9.1 Given my section is in draft, When I submit it, Then it moves to in-review, becomes read-only for me, and the Lead is notified', async () => {
    const { lead, co, courseId, sectionIds } = await fixture({ withCo: true });
    const sectionId = sectionIds[0] as string;
    await addTextLesson(co, courseId, sectionId);
    value(await transition('submitSection', co, courseId, sectionId));
    const after = await sectionEdit(courseId, sectionId, co);
    expect(after.working?.reviewState).toBe('in_review');
    expect(await addLesson(co, courseId, sectionId, 'text')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.workingCopyReadOnly' },
    });
    const notes = await outboxNotifications('notify.catalog.sectionSubmitted');
    expect(notes.some((n) => n.recipientUserId === lead.userId)).toBe(true);
    // IDs only (BR12.4): no title or other free text rides in the notification.
    expect(JSON.stringify(notes)).not.toMatch(/সংখ্যা/);
  });

  it('AC3.9.2 Given a lesson with no video or content, When I submit, Then it is refused and the incomplete lesson is listed', async () => {
    const { co, courseId, sectionIds } = await fixture({ withCo: true });
    const sectionId = sectionIds[0] as string;
    await addTextLesson(co, courseId, sectionId);
    value(await addLesson(co, courseId, sectionId, 'video'));
    expect(await transition('submitSection', co, courseId, sectionId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.incompleteLessons' },
    });
    const after = await sectionEdit(courseId, sectionId, co);
    expect(after.working?.reviewState).toBe('draft');
    expect(after.lessons.filter((l) => !l.isComplete).map((l) => l.kind)).toEqual(['video']);
  });

  it('AC3.9.2 (BR7.6, BR7.7) a video lesson completes once its media is ready, a quiz lesson once it has questions', async () => {
    const { co, courseId, sectionIds } = await fixture({ withCo: true });
    const sectionId = sectionIds[0] as string;
    const video = value<{ lessonId: string }>(await addLesson(co, courseId, sectionId, 'video'));
    const quiz = value<{ lessonId: string }>(await addLesson(co, courseId, sectionId, 'quiz'));
    await withTransaction(getDb(), async (tx) => {
      expect(
        (
          await u4().setLessonMedia(tx, {
            lessonId: video.lessonId,
            videoAssetId: crypto.randomUUID(),
            mediaStatus: 'ready',
            captionLanguages: ['bn'],
          })
        ).ok,
      ).toBe(true);
      expect(
        (await u4().setQuizContentStatus(tx, { lessonId: quiz.lessonId, questionCount: 5 })).ok,
      ).toBe(true);
    });
    expect((await transition('submitSection', co, courseId, sectionId)).ok).toBe(true);
  });
});

describe('US3.10 Approve or return a section', () => {
  async function inReview() {
    const f = await fixture({ withCo: true });
    const sectionId = f.sectionIds[0] as string;
    await addTextLesson(f.co, f.courseId, sectionId);
    value(await transition('submitSection', f.co, f.courseId, sectionId));
    return { ...f, sectionId };
  }

  it('AC3.10.1 Given a section in review, When I approve it, Then it becomes approved and the owner is notified', async () => {
    const { lead, co, courseId, sectionId } = await inReview();
    value(await transition('approveSection', lead, courseId, sectionId));
    expect((await sectionEdit(courseId, sectionId, lead)).working?.reviewState).toBe('approved');
    const notes = await outboxNotifications('notify.catalog.sectionApproved');
    expect(notes.some((n) => n.recipientUserId === co.userId)).toBe(true);
  });

  it('AC3.10.2 Given a section in review, When I return it with a comment, Then it goes back to draft with the comment visible to the owner', async () => {
    const { lead, co, courseId, sectionId } = await inReview();
    const comment = 'দ্বিতীয় পাঠে উদাহরণ যোগ করুন। Add an example to lesson 2.';
    value(await transition('returnSection', lead, courseId, sectionId, { comment }));
    const ownerView = await sectionEdit(courseId, sectionId, co);
    expect(ownerView.working?.reviewState).toBe('draft');
    expect(ownerView.lastReturnComment).toBe(comment);
    const notes = await outboxNotifications('notify.catalog.sectionReturned');
    expect(notes.some((n) => n.recipientUserId === co.userId)).toBe(true);
    // The comment is never copied into a notification (BR8.5, BR12.4).
    expect(JSON.stringify(notes)).not.toContain('Add an example');
  });

  it('AC3.10.3 Given an empty comment, When I return a section, Then it is refused because a comment is required', async () => {
    const { lead, courseId, sectionId } = await inReview();
    expect(
      await transition('returnSection', lead, courseId, sectionId, { comment: '   ' }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { comment: ['errors.catalog.returnCommentRequired'] },
      },
    });
    expect((await sectionEdit(courseId, sectionId, lead)).working?.reviewState).toBe('in_review');
  });

  it('a Co-instructor cannot approve a section (BR8.4)', async () => {
    const { co, courseId, sectionId } = await inReview();
    expect(await transition('approveSection', co, courseId, sectionId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
  });
});

describe('US3.8 Publish a course', () => {
  it('AC3.8.1 Given all sections are approved and a price and duration are set, When I publish, Then the course is published for its Goal', async () => {
    const { lead, courseId, sectionIds } = await fixture({ sections: 2 });
    await readyToPublish(lead, courseId, sectionIds);
    value(await publish(lead, courseId));
    const v = await view(courseId, lead);
    expect(v.course.status).toBe('published');
    expect(v.course.firstPublishedAt).not.toBeNull();
    const { rows } = await s.t.pool.query(
      `SELECT action FROM audit_log_entry WHERE subject_id = $1 AND action = 'catalog.course.published'`,
      [courseId],
    );
    expect(rows).toHaveLength(1);
  });

  it('AC3.8.2 Given one section is still in review, When I try to publish, Then it is refused and nothing is published', async () => {
    const { lead, co, courseId, sectionIds } = await fixture({ sections: 2, withCo: true });
    const [coSection, leadSection] = sectionIds as [string, string];
    await addTextLesson(co, courseId, coSection);
    value(await transition('submitSection', co, courseId, coSection));
    await readyToPublish(lead, courseId, [leadSection]);
    expect(await publish(lead, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.publishPreconditions' },
    });
    expect((await view(courseId, lead)).course.status).toBe('draft');
  });

  it('AC3.8.3 Given I am a Co-instructor, When I call publish, Then it is refused with not_lead', async () => {
    const { co, courseId } = await fixture({ withCo: true });
    expect(await publish(co, courseId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
  });

  it('AC3.8.4 Given two video lessons have no caption track, When I publish, Then a warning lists them and publishing succeeds once I confirm', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    const sectionId = sectionIds[0] as string;
    const ids: string[] = [];
    for (const captions of [[], [], ['bn', 'en']] as const) {
      const { lessonId } = value<{ lessonId: string }>(
        await addLesson(lead, courseId, sectionId, 'video'),
      );
      await withTransaction(getDb(), async (tx) => {
        await u4().setLessonMedia(tx, {
          lessonId,
          videoAssetId: crypto.randomUUID(),
          mediaStatus: 'ready',
          captionLanguages: [...captions],
        });
      });
      ids.push(lessonId);
    }
    value(await transition('selfApproveSection', lead, courseId, sectionId));
    const ready = value<Readiness>(await s.call('getPublishReadiness', lead.request, { courseId }));
    expect([...ready.missingCaptionLessonIds].sort()).toEqual([ids[0], ids[1]].sort());
    expect(await publish(lead, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.captionsNotConfirmed' },
    });
    expect((await view(courseId, lead)).course.status).toBe('draft');
    value(await publish(lead, courseId, [ids[0] as string, ids[1] as string]));
    expect((await view(courseId, lead)).course.status).toBe('published');
  });
});

describe('US3.0 Course lifecycle', () => {
  it('AC3.0.1 Given a Goal, When an Admin creates a course with a Lead, sections and lessons and publishes it without the review chain, Then it is published', async () => {
    const { lead, co, courseId, sectionIds } = await fixture({ sections: 2, withCo: true });
    await addTextLesson(co, courseId, sectionIds[0] as string);
    await addTextLesson(lead, courseId, sectionIds[1] as string);
    value(await publish(s.admin, courseId));
    expect((await view(courseId, lead)).course.status).toBe('published');
    const { rows } = await s.t.pool.query(
      `SELECT action FROM section_review WHERE section_id = ANY($1) AND action = 'admin_approved'`,
      [sectionIds],
    );
    expect(rows).toHaveLength(2);
  });

  it('AC3.0.2 Given a course with no price, When I publish, Then it is refused and the missing field is named', async () => {
    const lead = await s.newInstructor();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      }),
    );
    const ready = value<{ missingFields: string[] }>(
      await s.call('getPublishReadiness', lead.request, { courseId }),
    );
    expect(ready.missingFields).toEqual(
      expect.arrayContaining(['listPrice', 'accessDuration', 'description']),
    );
    expect(await publish(lead, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.publishPreconditions' },
    });
  });

  it('AC3.0.3 Given a published course, When I unpublish it (flag catalog.unpublish on), Then it leaves the catalog and can be republished', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    await readyToPublish(lead, courseId, sectionIds);
    value(await publish(lead, courseId));
    const unpublish = async () =>
      s.call('unpublishCourse', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
      });
    // CR-5 fallback: unpublish does not ship until the flag is turned on.
    expect(await unpublish()).toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } });
    value(
      await s.call('saveFlag', s.admin.request, {
        flagKey: 'catalog.unpublish',
        description: 'AT: unpublish on',
        state: 'on',
      }),
    );
    value(await unpublish());
    expect((await view(courseId, lead)).course.status).toBe('unpublished');
    value(await publish(lead, courseId));
    expect((await view(courseId, lead)).course.status).toBe('published');
  });

  it('retire is permanent: a retired course cannot be republished (BR4.3)', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    await readyToPublish(lead, courseId, sectionIds);
    value(await publish(lead, courseId));
    value(
      await s.call('retireCourse', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
      }),
    );
    expect((await view(courseId, lead)).course.status).toBe('retired');
    expect(await publish(lead, courseId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });

  it('BR4.8 Given the course is a segment trial course, When the Lead retires it, Then it is refused isTrialCourse', async () => {
    const { lead, courseId, sectionIds } = await fixture();
    await readyToPublish(lead, courseId, sectionIds);
    value(await publish(lead, courseId));
    // trial.policy is declared by the unit that owns trials; until then the instance seam stands in.
    const seam = (await import(
      '#src/features/catalog/server/catalog-instance.server.ts'
    )) as unknown as {
      setTrialCourseLookupForTests?: (fn: (id: string) => Promise<string[]>) => () => void;
    };
    if (typeof seam.setTrialCourseLookupForTests !== 'function') {
      throw new Error('setTrialCourseLookupForTests is not exported from catalog-instance');
    }
    const restore = seam.setTrialCourseLookupForTests(async (id) =>
      id === courseId ? ['segment-1'] : [],
    );
    try {
      expect(
        await s.call('retireCourse', lead.request, {
          courseId,
          expectedVersion: (await view(courseId, lead)).course.version,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', i18nKey: 'errors.catalog.isTrialCourse' },
      });
    } finally {
      restore();
    }
    expect((await view(courseId, lead)).course.status).toBe('published');
  });
});
