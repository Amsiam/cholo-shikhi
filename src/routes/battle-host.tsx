import { createFileRoute, useRouter } from '@tanstack/react-router';
import { getQuestionTaxonomy } from '#src/features/assessment/server/bank.functions.ts';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import type { GoalGroup } from '#src/features/assessment/ui/ExamBuilder.tsx';
import {
  listMyHostedBattles,
  scheduleHostedBattle,
} from '#src/features/battle/server/battle.functions.ts';
import type { BattleSummary } from '#src/features/battle/server/battle.server.ts';
import { HostBattles } from '#src/features/battle/ui/HostBattles.tsx';
import { listPublicGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Staff: hosted battles.
export const Route = createFileRoute('/battle-host')({
  loader: async () => {
    const [battles, goals, taxonomy] = await Promise.all([
      listMyHostedBattles({ data: {} }),
      listPublicGoals({ data: {} }),
      getQuestionTaxonomy({ data: {} }),
    ]);
    if (!battles.ok || !taxonomy.ok) return { denied: true as const };
    return {
      denied: false as const,
      battles: battles.value as BattleSummary[],
      goals: goals.ok ? (goals.value as { segments: GoalGroup[] }).segments : [],
      taxonomy: taxonomy.value as TaxonomySubject[],
    };
  },
  component: HostPage,
});

function HostPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <HostBattles
          battles={data.battles}
          goals={data.goals}
          taxonomy={data.taxonomy}
          onSchedule={async (input) => {
            const r = (await scheduleHostedBattle({ data: input })) as Outcome<{
              battleId: string;
            }>;
            if (r.ok) await router.invalidate();
            return r;
          }}
        />
      </div>
    </div>
  );
}
