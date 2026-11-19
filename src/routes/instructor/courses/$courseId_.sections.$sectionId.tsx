import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import {
  addLesson,
  approveSection,
  editLesson,
  getQuizForEditing,
  getSectionForEditing,
  removeLesson,
  reopenSection,
  reorderLessons,
  returnSection,
  saveQuizQuestions,
  saveTextLessonBody,
  selfApproveSection,
  setLessonVideo,
  submitSection,
} from '#src/features/catalog/server/catalog-content.functions.ts';
import type { SaveOutcome } from '#src/features/catalog/ui/fields.tsx';
import {
  type ContentSection,
  type ReviewAction,
  SectionContentEditor,
} from '#src/features/catalog/ui/SectionContentEditor.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Result = { ok: boolean; error?: NonNullable<SaveOutcome> };
type View = ContentSection & {
  courseId: string;
  editVersion: number | null;
  titleBn: string;
  titleEn: string;
  working: (ContentSection['working'] & { version: number }) | null;
};

// I1 builder part 2: one section's lessons and review (US3.17, US3.9, US3.10). Not nested under the
// course page, so the course route stays a leaf. Every write sends the token it was based on and
// reloads afterwards (BR12.1); a section outside the caller's roles answers not-found (BR6.1).
export const Route = createFileRoute('/instructor/courses/$courseId_/sections/$sectionId')({
  loader: async ({ params }) => {
    const result = await getSectionForEditing({
      data: { courseId: params.courseId, sectionId: params.sectionId },
    });
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') throw notFound();
      return { denied: true as const };
    }
    return { denied: false as const, view: result.value as View };
  },
  component: SectionContentPage,
});

function SectionContentPage() {
  const { t, locale } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) {
    return (
      <p role="alert" data-testid="section-content-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  const { view } = data;
  const base = { courseId: view.courseId, sectionId: view.sectionId };
  const listVersion = view.editVersion ?? 1;
  const reviewVersion = view.working?.version ?? 1;
  async function after(result: Result): Promise<SaveOutcome> {
    await router.invalidate();
    return result.ok ? null : (result.error ?? null);
  }
  const review: Record<ReviewAction, (comment?: string) => Promise<Result>> = {
    submit: () => submitSection({ data: { ...base, expectedVersion: reviewVersion } }),
    approve: () => approveSection({ data: { ...base, expectedVersion: reviewVersion } }),
    selfApprove: () => selfApproveSection({ data: { ...base, expectedVersion: reviewVersion } }),
    reopen: () => reopenSection({ data: { ...base, expectedVersion: reviewVersion } }),
    return: (comment) =>
      returnSection({ data: { ...base, expectedVersion: reviewVersion, comment: comment ?? '' } }),
  };
  return (
    <div className="flex flex-col bg-paper text-ink">
      <header className="border-b border-primary/15 bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6">
          <Link
            to="/instructor/courses/$courseId"
            params={{ courseId: view.courseId }}
            className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            data-testid="section-content-back-link"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('catalog.instructor.section.back')}
          </Link>
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance break-words sm:text-4xl">
            {(locale === 'bn' ? view.titleBn : view.titleEn) ||
              view.titleBn ||
              t('catalog.instructor.section.title')}
          </h1>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <SectionContentEditor
          section={view}
          onAddLesson={async (input) =>
            after(await addLesson({ data: { ...base, expectedVersion: listVersion, ...input } }))
          }
          onEditLesson={async (lesson, titles) =>
            after(
              await editLesson({
                data: {
                  ...base,
                  lessonId: lesson.lessonId,
                  expectedVersion: lesson.version,
                  ...titles,
                },
              }),
            )
          }
          onSaveBody={async (lesson, language, body) =>
            after(
              await saveTextLessonBody({
                data: {
                  ...base,
                  lessonId: lesson.lessonId,
                  expectedVersion: lesson.version,
                  language,
                  body,
                },
              }),
            )
          }
          onSetVideo={async (lesson, youtube) =>
            after(
              await setLessonVideo({
                data: {
                  ...base,
                  lessonId: lesson.lessonId,
                  expectedVersion: lesson.version,
                  youtube,
                },
              }),
            )
          }
          onLoadQuiz={async (lesson) => {
            const quiz = await getQuizForEditing({
              data: { ...base, lessonId: lesson.lessonId },
            }).catch(() => null);
            return quiz?.ok
              ? { questions: quiz.value.questions, streakBonusDays: quiz.value.streakBonusDays }
              : null;
          }}
          onSaveQuiz={async (lesson, questions, streakBonusDays) => {
            // The lesson version token comes from the editor read, which reflects the working copy.
            const current = await getQuizForEditing({
              data: { ...base, lessonId: lesson.lessonId },
            });
            return after(
              await saveQuizQuestions({
                data: {
                  ...base,
                  lessonId: lesson.lessonId,
                  expectedVersion: current.ok ? current.value.version : lesson.version,
                  questions,
                  streakBonusDays,
                },
              }),
            );
          }}
          onReorder={async (lessonIds) =>
            after(
              await reorderLessons({ data: { ...base, expectedVersion: listVersion, lessonIds } }),
            )
          }
          onRemoveLesson={async (lessonId) =>
            after(await removeLesson({ data: { ...base, expectedVersion: listVersion, lessonId } }))
          }
          onReview={async (action, comment) => after(await review[action](comment))}
        />
      </div>
    </div>
  );
}
