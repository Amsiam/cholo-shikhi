import { createFileRoute } from '@tanstack/react-router';
import { listExamsForStaff } from '#src/features/assessment/server/exam.functions.ts';
import type { StaffExamView } from '#src/features/assessment/server/exam.server.ts';
import { ExamList, type GoalGroup } from '#src/features/assessment/ui/ExamBuilder.tsx';
import { listPublicGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

// Staff: mock tests and live exams.
export const Route = createFileRoute('/exam-builder/')({
  loader: async () => {
    const [exams, goals] = await Promise.all([
      listExamsForStaff({ data: {} }),
      listPublicGoals({ data: {} }),
    ]);
    if (!exams.ok) return { denied: true as const };
    return {
      denied: false as const,
      exams: exams.value as StaffExamView[],
      goals: goals.ok ? (goals.value as { segments: GoalGroup[] }).segments : [],
    };
  },
  component: ExamBuilderPage,
});

function ExamBuilderPage() {
  const { t, locale } = useI18n();
  const data = Route.useLoaderData();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  const names = new Map(
    data.goals.flatMap((g) =>
      g.goals.map((x) => [x.goalId, locale === 'bn' ? x.nameBn : x.nameEn]),
    ),
  );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <ExamList exams={data.exams} goalName={(id) => names.get(id) ?? ''} />
      </div>
    </div>
  );
}
