// Test-only helper (Bolt 4): builds published courses through the real authoring, review and publish
// server functions, so every browse test reads a course that was really published (plan: "the browse
// journey runs over a course that was really published, not one seeded straight into the database").
// Synthetic data only, from the catalog factories.
import { buildTitle } from '#src/test/factories/catalog.ts';
import type { Caller, ServerFnHarness, ServerFnResultLike } from '#src/test/server-fn-harness.ts';

export function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

type EditorView = {
  course: { courseId: string; status: string; version: number };
  sections: Array<{ sectionId: string; ownershipVersion: number; workingVersion: number | null }>;
};
type SectionEdit = {
  editVersion: number;
  working: { version: number } | null;
  lessons: Array<{ lessonId: string; version: number }>;
};
type Readiness = {
  courseVersion: number;
  sections: Array<{ sectionId: string; workingVersion: number | null }>;
};

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

export type PublishedCourse = {
  courseId: string;
  lead: Caller;
  co: Caller | null;
  sectionIds: string[];
  lessonIds: string[];
  titles: { titleBn: string; titleEn: string };
};

export function createPublishHelper(s: ServerFnHarness) {
  const view = async (courseId: string, caller: Caller) =>
    value<EditorView>(await s.call('getCourseForEditing', caller.request, { courseId }));
  const sectionEdit = async (courseId: string, sectionId: string, caller: Caller) =>
    value<SectionEdit>(
      await s.call('getSectionForEditing', caller.request, { courseId, sectionId }),
    );

  async function addTextLesson(caller: Caller, courseId: string, sectionId: string) {
    const edit = await sectionEdit(courseId, sectionId, caller);
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', caller.request, {
        courseId,
        sectionId,
        expectedVersion: edit.editVersion,
        kind: 'text',
        ...buildTitle(),
      }),
    );
    const lesson = (await sectionEdit(courseId, sectionId, caller)).lessons.find(
      (l) => l.lessonId === lessonId,
    );
    value(
      await s.call('saveTextLessonBody', caller.request, {
        courseId,
        sectionId,
        lessonId,
        expectedVersion: lesson?.version,
        language: 'bn',
        body: textDoc('সংখ্যা পদ্ধতির ভূমিকা'),
      }),
    );
    return lessonId;
  }

  async function publish(caller: Caller, courseId: string) {
    const ready = value<Readiness>(
      await s.call('getPublishReadiness', caller.request, { courseId }),
    );
    return s.call('publishCourse', caller.request, {
      courseId,
      expectedVersion: ready.courseVersion,
      sectionVersions: ready.sections
        .filter((x) => x.workingVersion !== null)
        .map((x) => ({ sectionId: x.sectionId, expectedVersion: x.workingVersion })),
      acknowledgedMissingCaptions: [],
    });
  }

  /**
   * A draft course of the Goal, priced and timed, with `sections` sections (the first owned by a
   * Co-instructor when `withCo`) and one complete text lesson per section. Not yet published.
   */
  async function draft(
    goalId: string,
    options: { sections?: number; withCo?: boolean; price?: string; months?: 4 | 6 | 12 } = {},
  ) {
    const lead = await s.newInstructor();
    const co = options.withCo ? await s.newInstructor() : null;
    const titles = buildTitle();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        ...titles,
        sections: Array.from({ length: options.sections ?? 1 }, () => buildTitle()),
      }),
    );
    value(
      await s.call('setCoursePrice', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
        price: options.price ?? '১৪৯৯',
      }),
    );
    value(
      await s.call('setAccessDuration', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
        months: options.months ?? 6,
      }),
    );
    value(
      await s.call('setCourseDescription', lead.request, {
        courseId,
        expectedVersion: (await view(courseId, lead)).course.version,
        descriptionBn: 'বিসিএস প্রস্তুতির কোর্স',
        descriptionEn: '',
      }),
    );
    const sectionIds = (await view(courseId, lead)).sections.map((x) => x.sectionId);
    if (co && sectionIds[0]) {
      const first = (await view(courseId, lead)).sections[0];
      value(
        await s.call('assignSection', lead.request, {
          courseId,
          sectionId: first?.sectionId,
          assigneeId: co.userId,
          expectedOwnershipVersion: first?.ownershipVersion,
        }),
      );
    }
    const lessonIds: string[] = [];
    for (const [index, sectionId] of sectionIds.entries()) {
      const owner = index === 0 && co ? co : lead;
      lessonIds.push(await addTextLesson(owner, courseId, sectionId));
    }
    return { courseId, lead, co, sectionIds, lessonIds, titles };
  }

  /** A course of the Goal, published by an Admin (BR9.3: the Admin publish approves every section). */
  async function published(
    goalId: string,
    options: { sections?: number; withCo?: boolean; price?: string; months?: 4 | 6 | 12 } = {},
  ): Promise<PublishedCourse> {
    const built = await draft(goalId, options);
    value(await publish(s.admin, built.courseId));
    return built;
  }

  return { view, sectionEdit, addTextLesson, publish, draft, published };
}
