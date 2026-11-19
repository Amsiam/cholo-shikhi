import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';
import { ArrowLeft, ChartColumn, Eye, Pencil } from 'lucide-react';
import { listExamsForStaff } from '#src/features/assessment/server/exam.functions.ts';
import type { StaffExamView } from '#src/features/assessment/server/exam.server.ts';
import {
  addSection,
  assignSection,
  cancelSectionRemoval,
  editSectionTitle,
  getCourseForEditing,
  removeSection,
  reorderSections,
  setAccessDuration,
  setCoursePrice,
} from '#src/features/catalog/server/catalog.functions.ts';
import {
  listPracticePacks,
  publishPracticePack,
  savePracticePack,
} from '#src/features/catalog/server/catalog-products.functions.ts';
import {
  getPublishReadiness,
  publishCourse,
  retireCourse,
  setCourseDescription,
  unpublishCourse,
} from '#src/features/catalog/server/catalog-publish.functions.ts';
import {
  CourseEditor,
  type CourseEditorProps,
  type EditorCourse,
  type EditorSection,
} from '#src/features/catalog/ui/CourseEditor.tsx';
import type { SaveOutcome } from '#src/features/catalog/ui/fields.tsx';
import {
  type PracticePackRowView,
  PracticePacksPanel,
} from '#src/features/catalog/ui/PracticePacksPanel.tsx';
import { PublishPanel, type Readiness } from '#src/features/catalog/ui/PublishPanel.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Result = { ok: boolean; error?: NonNullable<SaveOutcome> };
type View = {
  course: EditorCourse & { descriptionBn: string | null; descriptionEn: string | null };
  role: CourseEditorProps['role'];
  canManageCourse: boolean;
  viewerId: string;
  sections: EditorSection[];
};

// I1 course builder (US3.1–US3.5, part 1; US3.8, US3.0, part 2). A course outside the caller's roles
// answers not-found (BR6.1, BR4.4); every write sends the version it was based on and reloads
// afterwards (BR12.1). The publish panel sends the section tokens its readiness read showed (BR12.2).
export const Route = createFileRoute('/instructor/courses/$courseId')({
  loader: async ({ params }) => {
    const result = await getCourseForEditing({ data: { courseId: params.courseId } });
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') throw notFound();
      return { denied: true as const };
    }
    const view = result.value as View;
    const [readiness, packs, exams] = await Promise.all([
      getPublishReadiness({ data: { courseId: params.courseId } }),
      // UC19 / BR10.9: Practice Packs are the Lead's; nobody else is shown the panel.
      view.role === 'lead'
        ? listPracticePacks({ data: { courseId: params.courseId } })
        : Promise.resolve(null),
      view.role === 'lead'
        ? listExamsForStaff({ data: {} }).catch(() => null)
        : Promise.resolve(null),
    ]);
    // A pack's contents are the Lead's published mock tests from the exam builder.
    const testOptions = exams?.ok
      ? (exams.value as StaffExamView[])
          .filter((e) => e.kind === 'mock' && e.status === 'published')
          .map((e) => ({ examId: e.examId, titleBn: e.titleBn, titleEn: e.titleEn }))
      : [];
    return {
      denied: false as const,
      view,
      packs: packs?.ok === true ? (packs.value as { rows: PracticePackRowView[] }).rows : null,
      testOptions,
      readiness: readiness.ok
        ? (readiness.value as Omit<Readiness, 'sections'> & {
            courseVersion: number;
            sections: Array<Readiness['sections'][number] & { workingVersion: number | null }>;
          })
        : null,
    };
  },
  component: CourseEditorPage,
});

function CourseEditorPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) {
    return (
      <p role="alert" data-testid="course-editor-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  const { view, readiness, packs } = data;
  const courseId = view.course.courseId;
  const expectedVersion = view.course.version;
  async function after(result: Result): Promise<SaveOutcome> {
    await router.invalidate();
    return result.ok ? null : (result.error ?? null);
  }
  const publishPanel = readiness ? (
    <PublishPanel
      readiness={readiness}
      canManage={view.canManageCourse}
      sectionTitles={Object.fromEntries(
        view.sections.map((s) => [s.sectionId, { titleBn: s.titleBn, titleEn: s.titleEn }]),
      )}
      description={view.course}
      onSaveDescription={async (input) =>
        after(await setCourseDescription({ data: { courseId, expectedVersion, ...input } }))
      }
      onPublish={async (acknowledgedMissingCaptions) =>
        after(
          await publishCourse({
            data: {
              courseId,
              expectedVersion: readiness.courseVersion,
              sectionVersions: readiness.sections
                .filter((s) => s.workingVersion !== null)
                .map((s) => ({
                  sectionId: s.sectionId,
                  expectedVersion: s.workingVersion as number,
                })),
              acknowledgedMissingCaptions,
            },
          }),
        )
      }
      onUnpublish={async () =>
        after(await unpublishCourse({ data: { courseId, expectedVersion } }))
      }
      onRetire={async () => after(await retireCourse({ data: { courseId, expectedVersion } }))}
    />
  ) : undefined;
  const packsPanel = packs ? (
    <PracticePacksPanel
      courseId={courseId}
      isCoursePublished={view.course.status === 'published'}
      rows={packs}
      testOptions={data.testOptions}
      onSave={async (input) => after(await savePracticePack({ data: input }))}
      onAction={async (_action, row) =>
        after(
          await publishPracticePack({
            data: { practicePackId: row.practicePackId, expectedVersion: row.version },
          }),
        )
      }
    />
  ) : undefined;
  return (
    <CourseEditor
      {...view}
      backLink={
        <Link
          to="/instructor/courses"
          className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          data-testid="course-editor-back-link"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('catalog.instructor.back')}
        </Link>
      }
      headerActions={
        <>
          <Link
            to="/instructor/courses/$courseId/stats"
            params={{ courseId }}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
            data-testid="course-editor-stats"
          >
            <ChartColumn aria-hidden="true" className="size-4" />
            {t('insights.stats.title')}
          </Link>
          {view.course.status === 'published' ? (
            <Link
              to="/courses/$courseId"
              params={{ courseId }}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary/40 bg-background px-4 font-semibold text-primary hover:bg-primary/10"
              data-testid="course-editor-view-page"
            >
              <Eye aria-hidden="true" className="size-4" />
              {t('catalog.instructor.viewCoursePage')}
            </Link>
          ) : null}
        </>
      }
      publishPanel={publishPanel}
      packsPanel={packsPanel}
      renderSectionLink={(section) => (
        <Link
          to="/instructor/courses/$courseId/sections/$sectionId"
          params={{ courseId, sectionId: section.sectionId }}
          className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          data-testid="section-row-open"
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t('catalog.instructor.sections.openContent')}
        </Link>
      )}
      onSetPrice={async (price) =>
        after(await setCoursePrice({ data: { courseId, expectedVersion, price } }))
      }
      onSetDuration={async (months) =>
        after(await setAccessDuration({ data: { courseId, expectedVersion, months } }))
      }
      onAddSection={async (titles) =>
        after(await addSection({ data: { courseId, expectedVersion, ...titles } }))
      }
      onReorder={async (sectionIds) =>
        after(await reorderSections({ data: { courseId, expectedVersion, sectionIds } }))
      }
      onRemoveSection={async (sectionId) =>
        after(await removeSection({ data: { courseId, expectedVersion, sectionId } }))
      }
      onCancelRemoval={async (sectionId) =>
        after(await cancelSectionRemoval({ data: { courseId, expectedVersion, sectionId } }))
      }
      onAssign={async (section, assigneeId) =>
        after(
          await assignSection({
            data: {
              courseId,
              sectionId: section.sectionId,
              assigneeId,
              expectedOwnershipVersion: section.ownershipVersion ?? 0,
            },
          }),
        )
      }
      onEditTitle={async (section, titles) =>
        after(
          await editSectionTitle({
            data: {
              courseId,
              sectionId: section.sectionId,
              expectedVersion: section.workingVersion ?? 1,
              ...titles,
            },
          }),
        )
      }
    />
  );
}
