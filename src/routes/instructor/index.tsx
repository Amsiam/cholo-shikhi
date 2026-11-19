import { createFileRoute } from '@tanstack/react-router';
import { getMyTeachingDashboard } from '#src/features/insights/server/insights.functions.ts';
import type { TeachingDashboard } from '#src/features/insights/server/insights.types.ts';
import { TeachingDashboardView } from '#src/features/insights/ui/TeachingDashboardView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// I3 Teaching dashboard: the instructor's home.
export const Route = createFileRoute('/instructor/')({
  loader: async () => {
    const result = await getMyTeachingDashboard({ data: {} });
    return result.ok
      ? { denied: false as const, dashboard: result.value as TeachingDashboard }
      : { denied: true as const };
  },
  component: TeachingPage,
});

function TeachingPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  if (data.denied) {
    return (
      <p role="alert" data-testid="teaching-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <TeachingDashboardView data={data.dashboard} />
      </div>
    </div>
  );
}
