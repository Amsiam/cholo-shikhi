import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  getQuestionTaxonomy,
  saveQuestionSubject,
  saveQuestionTopic,
} from '#src/features/assessment/server/bank.functions.ts';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import { type GoalOption, TopicManager } from '#src/features/assessment/ui/TopicManager.tsx';
import { listGoalsAdmin } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

// Admin: subjects, topics and sub-topics of the question bank.
export const Route = createFileRoute('/admin_/topics')({
  loader: async () => {
    const [taxonomy, goals] = await Promise.all([
      getQuestionTaxonomy({ data: {} }),
      listGoalsAdmin({ data: { page: 1, pageSize: 100 } }),
    ]);
    if (!taxonomy.ok || !goals.ok) return { denied: true as const };
    const rows = (goals.value as { rows: Array<GoalOption & { status: string }> }).rows;
    return {
      denied: false as const,
      taxonomy: taxonomy.value as TaxonomySubject[],
      goals: rows.filter((g) => g.status !== 'retired'),
    };
  },
  component: TopicsPage,
});

const toOutcome = (r: Outcome) =>
  r.ok ? { ok: true as const } : { ok: false as const, i18nKey: r.error.i18nKey };

function TopicsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('admin.denied')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <TopicManager
          taxonomy={data.taxonomy}
          goals={data.goals}
          onSaveSubject={async (input) => {
            const r = toOutcome((await saveQuestionSubject({ data: input })) as Outcome);
            if (r.ok) await router.invalidate();
            return r;
          }}
          onSaveTopic={async (input) => {
            const r = toOutcome((await saveQuestionTopic({ data: input })) as Outcome);
            if (r.ok) await router.invalidate();
            return r;
          }}
        />
      </div>
    </div>
  );
}
