// [LT] Step 22: section content server functions through their real builders on a per-file schema
// with real Better Auth sessions, and the contract 5 U4 status pushes in-process. Covers the NFR6.202
// negative matrix (Finance included), the functional-spec §7 lesson rows (owner and Admin on the same
// or on different lessons; a lesson edit against a list change; a media push during an edit), the
// SD-211 blocked-domain check at save with no cache, BR7.4 removal and the CR-8 inputs.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLessonMedia, setQuizContentStatus } from '#src/features/catalog/index.ts';
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

type Lesson = { lessonId: string; version: number; position: number; kind: string };
type SectionEdit = {
  editVersion: number;
  working: { version: number; reviewState: string } | null;
  lessons: Lesson[];
  canEdit: boolean;
};

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

const doc = (...hrefs: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'পাঠ' },
        ...hrefs.map((href) => ({
          type: 'text',
          text: 'link',
          marks: [{ type: 'link', attrs: { href } }],
        })),
      ],
    },
  ],
});

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

/** A fresh Lead and a Co-instructor owning the first of two sections. */
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
  const v = value<{
    sections: Array<{ sectionId: string; ownershipVersion: number }>;
  }>(await s.call('getCourseForEditing', lead.request, { courseId }));
  const [coSection, leadSection] = v.sections as [
    { sectionId: string; ownershipVersion: number },
    { sectionId: string },
  ];
  value(
    await s.call('assignSection', lead.request, {
      courseId,
      sectionId: coSection.sectionId,
      assigneeId: co.userId,
      expectedOwnershipVersion: coSection.ownershipVersion,
    }),
  );
  return {
    lead,
    co,
    courseId,
    coSectionId: coSection.sectionId,
    leadSectionId: leadSection.sectionId,
  };
}

async function add(caller: Caller, courseId: string, sectionId: string, kind = 'text') {
  const e = await edit(courseId, sectionId, caller);
  return value<{ lessonId: string; version: number }>(
    await s.call('addLesson', caller.request, {
      courseId,
      sectionId,
      expectedVersion: e.editVersion,
      kind,
      ...buildTitle(),
    }),
  );
}

const lessonOf = async (courseId: string, sectionId: string, caller: Caller, lessonId: string) =>
  (await edit(courseId, sectionId, caller)).lessons.find((l) => l.lessonId === lessonId) as Lesson;

describe('NFR6.202 negative matrix (content)', () => {
  let inputs: Record<string, Record<string, unknown>>;
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
    const lesson = await add(f.co, f.courseId, f.coSectionId);
    const e = await edit(f.courseId, f.coSectionId, f.co);
    const l = e.lessons[0] as Lesson;
    const base = { courseId: f.courseId, sectionId: f.coSectionId };
    inputs = {
      getSectionForEditing: base,
      addLesson: { ...base, expectedVersion: e.editVersion, kind: 'text', ...buildTitle() },
      editLesson: {
        ...base,
        lessonId: lesson.lessonId,
        expectedVersion: l.version,
        ...buildTitle(),
      },
      saveTextLessonBody: {
        ...base,
        lessonId: lesson.lessonId,
        expectedVersion: l.version,
        language: 'bn',
        body: doc(),
      },
      reorderLessons: { ...base, expectedVersion: e.editVersion, lessonIds: [lesson.lessonId] },
      removeLesson: { ...base, expectedVersion: e.editVersion, lessonId: lesson.lessonId },
    };
  });
  const ALL = [
    'getSectionForEditing',
    'addLesson',
    'editLesson',
    'saveTextLessonBody',
    'reorderLessons',
    'removeLesson',
  ];
  const WRITES = ALL.filter((n) => n !== 'getSectionForEditing');

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
  it.each(ALL)('%s refuses Finance staff (wrong staff role)', async (name) => {
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
  it.each(ALL)("%s answers not-found to another course's instructor", async (name) => {
    const outsider = await s.newInstructor();
    expect(await s.call(name, outsider.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
  it.each(WRITES)('%s refuses a Co-instructor on a section they do not own', async (name) => {
    const other = { ...inputs[name], sectionId: f.leadSectionId };
    expect(await s.call(name, f.co.request, other)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' },
    });
  });
});

describe('lessons in the working copy (UC12)', () => {
  it('adds at the end, reorders and removes, bumping the working copy each time (BR7.2)', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const a = await add(lead, courseId, leadSectionId);
    const b = await add(lead, courseId, leadSectionId, 'quiz');
    let e = await edit(courseId, leadSectionId, lead);
    expect(e.lessons.map((l) => [l.lessonId, l.position])).toEqual([
      [a.lessonId, 1],
      [b.lessonId, 2],
    ]);
    // A stale working-copy token is refused and changes nothing.
    expect(
      await s.call('reorderLessons', lead.request, {
        courseId,
        sectionId: leadSectionId,
        expectedVersion: e.editVersion - 1,
        lessonIds: [b.lessonId, a.lessonId],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
    // Not a permutation.
    expect(
      await s.call('reorderLessons', lead.request, {
        courseId,
        sectionId: leadSectionId,
        expectedVersion: e.editVersion,
        lessonIds: [a.lessonId],
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { lessonIds: ['errors.catalog.reorderNotPermutation'] } },
    });
    value(
      await s.call('reorderLessons', lead.request, {
        courseId,
        sectionId: leadSectionId,
        expectedVersion: e.editVersion,
        lessonIds: [b.lessonId, a.lessonId],
      }),
    );
    e = await edit(courseId, leadSectionId, lead);
    value(
      await s.call('removeLesson', lead.request, {
        courseId,
        sectionId: leadSectionId,
        expectedVersion: e.editVersion,
        lessonId: b.lessonId,
      }),
    );
    e = await edit(courseId, leadSectionId, lead);
    expect(e.lessons.map((l) => [l.lessonId, l.position])).toEqual([[a.lessonId, 1]]);
    // BR7.4: a never-published lesson in no other version is deleted outright.
    const { rows } = await s.t.pool.query('SELECT 1 FROM lesson WHERE lesson_id = $1', [
      b.lessonId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a text body on a non-text lesson and an image before the image store exists', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const video = await add(lead, courseId, leadSectionId, 'video');
    const v = await lessonOf(courseId, leadSectionId, lead, video.lessonId);
    expect(
      await s.call('saveTextLessonBody', lead.request, {
        courseId,
        sectionId: leadSectionId,
        lessonId: video.lessonId,
        expectedVersion: v.version,
        language: 'en',
        body: doc(),
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { body: ['errors.catalog.lessonKindMismatch'] } },
    });
    const text = await add(lead, courseId, leadSectionId);
    const t = await lessonOf(courseId, leadSectionId, lead, text.lessonId);
    expect(
      await s.call('saveTextLessonBody', lead.request, {
        courseId,
        sectionId: leadSectionId,
        lessonId: text.lessonId,
        expectedVersion: t.version,
        language: 'en',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'image', attrs: { imageId: randomUUID(), alt: 'x' } }],
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'bodyEn.images': ['errors.catalog.imageUnavailable'] } },
    });
  });
});

describe('blocked domains at save (SD-211, NFR6.210)', () => {
  it('a domain blocked now is refused at the very next save, subdomains included, with its position', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const { lessonId } = await add(lead, courseId, leadSectionId);
    const save = async (body: unknown) =>
      s.call('saveTextLessonBody', lead.request, {
        courseId,
        sectionId: leadSectionId,
        lessonId,
        expectedVersion: (await lessonOf(courseId, leadSectionId, lead, lessonId)).version,
        language: 'bn',
        body,
      });
    const body = doc('https://example.com/', 'https://cdn.badsite.example/x');
    value(await save(body));
    const { rows } = await s.t.pool.query(
      `SELECT lv.link_domain_candidates FROM lesson_version lv WHERE lv.lesson_id = $1`,
      [lessonId],
    );
    expect(rows[0]?.link_domain_candidates).toEqual(
      expect.arrayContaining(['example.com', 'cdn.badsite.example', 'badsite.example']),
    );
    await s.t.pool.query(
      `INSERT INTO blocked_domain (domain, created_by) VALUES ('badsite.example', $1)`,
      [s.admin.userId],
    );
    expect(await save(body)).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { 'bodyBn.links.1': ['errors.catalog.blockedLink'] },
      },
    });
    // Removing the entry lets the next save through (no cache either way).
    await s.t.pool.query(`DELETE FROM blocked_domain WHERE domain = 'badsite.example'`);
    expect((await save(body)).ok).toBe(true);
  });

  it('clearing a body (null) recomputes the candidates from the other language', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const { lessonId } = await add(lead, courseId, leadSectionId);
    for (const [language, body] of [
      ['bn', doc('https://bn.example.org/')],
      ['en', doc('https://en.example.net/')],
      ['bn', null],
    ] as const) {
      value(
        await s.call('saveTextLessonBody', lead.request, {
          courseId,
          sectionId: leadSectionId,
          lessonId,
          expectedVersion: (await lessonOf(courseId, leadSectionId, lead, lessonId)).version,
          language,
          body,
        }),
      );
    }
    const { rows } = await s.t.pool.query(
      `SELECT body_bn, link_domain_candidates FROM lesson_version WHERE lesson_id = $1`,
      [lessonId],
    );
    expect(rows[0]?.body_bn).toBeNull();
    expect([...(rows[0]?.link_domain_candidates ?? [])].sort()).toEqual([
      'en.example.net',
      'example.net',
    ]);
  });
});

describe('functional-spec §7 lesson races', () => {
  it('owner and Admin on the same lesson: the second save is stale; on different lessons both succeed', async () => {
    const { co, courseId, coSectionId } = await fixture();
    const one = await add(co, courseId, coSectionId);
    const two = await add(co, courseId, coSectionId);
    const l1 = await lessonOf(courseId, coSectionId, co, one.lessonId);
    const l2 = await lessonOf(courseId, coSectionId, co, two.lessonId);
    const editOf = (caller: Caller, lesson: Lesson) =>
      s.call('editLesson', caller.request, {
        courseId,
        sectionId: coSectionId,
        lessonId: lesson.lessonId,
        expectedVersion: lesson.version,
        ...buildTitle(),
      });
    value(await editOf(co, l1));
    expect(await editOf(s.admin, l1)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', i18nKey: 'errors.catalog.staleVersion' },
    });
    // Two different lessons: each checks its own token, both bump the working copy in turn.
    value(await editOf(s.admin, l2));
  });

  it('a lesson edit bumps the working copy, so a list change based on the older copy is refused', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const one = await add(lead, courseId, leadSectionId);
    const before = await edit(courseId, leadSectionId, lead);
    const l1 = before.lessons[0] as Lesson;
    value(
      await s.call('editLesson', lead.request, {
        courseId,
        sectionId: leadSectionId,
        lessonId: one.lessonId,
        expectedVersion: l1.version,
        ...buildTitle(),
      }),
    );
    expect(
      await s.call('removeLesson', lead.request, {
        courseId,
        sectionId: leadSectionId,
        expectedVersion: before.editVersion,
        lessonId: one.lessonId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('a media push during an edit conflicts with nothing: it bumps no token (BR7.6, BR12.1)', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const video = await add(lead, courseId, leadSectionId, 'video');
    const before = await lessonOf(courseId, leadSectionId, lead, video.lessonId);
    const sectionBefore = await edit(courseId, leadSectionId, lead);
    const asset = randomUUID();
    await withTransaction(getDb(), async (tx) => {
      expect(
        await setLessonMedia(tx, {
          lessonId: video.lessonId,
          videoAssetId: asset,
          mediaStatus: 'processing',
        }),
      ).toEqual({ ok: true, value: undefined });
    });
    const after = await edit(courseId, leadSectionId, lead);
    expect(after.editVersion).toBe(sectionBefore.editVersion);
    // The edit sent before the push still matches its token.
    value(
      await s.call('editLesson', lead.request, {
        courseId,
        sectionId: leadSectionId,
        lessonId: video.lessonId,
        expectedVersion: before.version,
        ...buildTitle(),
      }),
    );
    await withTransaction(getDb(), async (tx) => {
      expect(
        (
          await setLessonMedia(tx, {
            lessonId: video.lessonId,
            videoAssetId: asset,
            mediaStatus: 'ready',
            captionLanguages: ['en'],
          })
        ).ok,
      ).toBe(true);
    });
    const { rows } = await s.t.pool.query(
      'SELECT media_status, caption_languages, video_asset_id FROM lesson_version WHERE lesson_id = $1',
      [video.lessonId],
    );
    expect(rows[0]).toMatchObject({
      media_status: 'ready',
      caption_languages: ['en'],
      video_asset_id: asset,
    });
  });
});

describe('contract 5 U4 inputs (CR-8)', () => {
  it('answers NOT_FOUND for an unknown lesson and INVALID_STATE for the wrong kind', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const text = await add(lead, courseId, leadSectionId);
    await withTransaction(getDb(), async (tx) => {
      expect(
        await setQuizContentStatus(tx, { lessonId: randomUUID(), questionCount: 3 }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(
        await setQuizContentStatus(tx, { lessonId: text.lessonId, questionCount: 3 }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
      expect(
        await setLessonMedia(tx, {
          lessonId: text.lessonId,
          videoAssetId: randomUUID(),
          mediaStatus: 'ready',
        }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
      expect(
        await setLessonMedia(tx, {
          lessonId: 'not-an-id',
          videoAssetId: randomUUID(),
          mediaStatus: 'ready',
        }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });
  });

  it('sets the quiz question count without bumping any token', async () => {
    const { lead, courseId, leadSectionId } = await fixture();
    const quiz = await add(lead, courseId, leadSectionId, 'quiz');
    const before = await edit(courseId, leadSectionId, lead);
    await withTransaction(getDb(), async (tx) => {
      expect(
        (await setQuizContentStatus(tx, { lessonId: quiz.lessonId, questionCount: 12 })).ok,
      ).toBe(true);
    });
    const after = await edit(courseId, leadSectionId, lead);
    expect(after.editVersion).toBe(before.editVersion);
    expect(after.lessons[0]).toMatchObject({ isComplete: true });
  });
});
