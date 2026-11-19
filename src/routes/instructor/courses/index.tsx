import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { createCourse, listMyCourses } from '#src/features/catalog/server/catalog.functions.ts';
import { CourseList, type CourseListRow } from '#src/features/catalog/ui/CourseList.tsx';
import { type GoalOption, NewCourseForm } from '#src/features/catalog/ui/NewCourseForm.tsx';
import { listActiveGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

const PAGE_SIZE = 20;

// I1 course list and new-course form (US3.1). Instructors and Admins with two-step only (the
// server functions refuse everyone else). Paging is server-side through validated search params.
export const Route = createFileRoute('/instructor/courses/')({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const [courses, goals] = await Promise.all([
      listMyCourses({ data: { page: deps.page, pageSize: PAGE_SIZE } }),
      listActiveGoals({ data: {} }),
    ]);
    if (!courses.ok) return { denied: true as const };
    const groups = goals.ok
      ? (goals.value as { segments: Array<{ goals: GoalOption[] }> }).segments
      : [];
    return {
      denied: false as const,
      courses: courses.value as { rows: CourseListRow[]; total: number; page: number },
      goals: groups.flatMap((g) => g.goals),
    };
  },
  component: InstructorCoursesPage,
});

function InstructorCoursesPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/instructor/courses/' });
  if (data.denied) {
    return (
      <p role="alert" data-testid="instructor-courses-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  return (
    <section className="grid gap-6" data-testid="instructor-courses-page">
      <h1 className="text-2xl font-semibold">{t('catalog.instructor.title')}</h1>
      <div className="rounded-sm border border-primary/20 bg-background p-5">
        <CourseList
          rows={data.courses.rows}
          paging={{
            page: data.courses.page,
            pages: Math.max(1, Math.ceil(data.courses.total / PAGE_SIZE)),
            onPage: (page) => void navigate({ search: { page } }),
          }}
        />
      </div>
      <section
        className="grid gap-3 rounded-sm border border-primary/20 bg-background p-5"
        aria-labelledby="new-course-heading"
      >
        <h2 id="new-course-heading" className="text-lg font-semibold">
          {t('catalog.instructor.new.heading')}
        </h2>
        {data.goals.length === 0 ? (
          <p data-testid="instructor-courses-no-goals">{t('catalog.instructor.new.noGoals')}</p>
        ) : (
          <NewCourseForm
            goals={data.goals}
            onCreate={async (draft) => {
              const result = await createCourse({
                data: {
                  goalId: draft.goalId,
                  titleBn: draft.titleBn,
                  titleEn: draft.titleEn,
                  sections: draft.sections.map((s) => ({ titleBn: s.titleBn, titleEn: s.titleEn })),
                },
              });
              if (!result.ok) return result.error;
              await navigate({
                to: '/instructor/courses/$courseId',
                params: { courseId: (result.value as { courseId: string }).courseId },
              });
              return null;
            }}
          />
        )}
      </section>
    </section>
  );
}
