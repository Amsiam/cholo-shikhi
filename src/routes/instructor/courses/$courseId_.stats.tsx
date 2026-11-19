import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, PenSquare } from 'lucide-react';
import { getCourseStats } from '#src/features/insights/server/insights.functions.ts';
import { CourseStatsSearch } from '#src/features/insights/server/insights.schema.ts';
import type { CourseInsights } from '#src/features/insights/server/insights.types.ts';
import { CourseStatsView } from '#src/features/insights/ui/CourseStatsView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// A course's statistics, for its instructors and Admins (anyone else: not found).
export const Route = createFileRoute('/instructor/courses/$courseId_/stats')({
  validateSearch: CourseStatsSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const result = await getCourseStats({
      data: { courseId: params.courseId, q: deps.q ?? '', page: deps.page ?? 1 },
    });
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') throw notFound();
      return { denied: true as const };
    }
    return { denied: false as const, stats: result.value as CourseInsights };
  },
  component: CourseStatsPage,
});

function CourseStatsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { courseId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  if (data.denied) {
    return (
      <p role="alert" data-testid="course-stats-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <CourseStatsView
          stats={data.stats}
          header={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/instructor/earnings"
                className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="course-stats-back"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {t('insights.earnings.title')}
              </Link>
              <Link
                to="/instructor/courses/$courseId"
                params={{ courseId }}
                className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary/40 bg-background px-4 font-semibold text-primary hover:bg-primary/10"
                data-testid="course-stats-edit"
              >
                <PenSquare aria-hidden="true" className="size-4" />
                {t('insights.stats.openBuilder')}
              </Link>
            </div>
          }
          onSearch={(q) => void navigate({ search: { q: q || undefined, page: undefined } })}
          onPage={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        />
      </div>
    </div>
  );
}
