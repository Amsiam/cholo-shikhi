import { createFileRoute } from '@tanstack/react-router';
import { getQuestionTaxonomy } from '#src/features/assessment/server/bank.functions.ts';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import {
  cancelLiveClass,
  fireLiveQuiz,
  getLiveControl,
} from '#src/features/live/server/live.functions.ts';
import type { LiveControl } from '#src/features/live/server/live.server.ts';
import { LiveControlView } from '#src/features/live/ui/LiveHost.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

// Staff: one live class's control room.
export const Route = createFileRoute('/live-host/$liveClassId')({
  loader: async ({ params }) => {
    const [control, taxonomy] = await Promise.all([
      getLiveControl({ data: { liveClassId: params.liveClassId } }),
      getQuestionTaxonomy({ data: {} }),
    ]);
    return control.ok
      ? {
          denied: false as const,
          control: control.value as LiveControl,
          taxonomy: taxonomy.ok ? (taxonomy.value as TaxonomySubject[]) : [],
        }
      : { denied: true as const };
  },
  component: ControlPage,
});

function ControlPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { liveClassId } = Route.useParams();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <LiveControlView
          key={liveClassId}
          initial={data.control}
          taxonomy={data.taxonomy}
          onRefresh={async () => {
            const r = await getLiveControl({ data: { liveClassId } }).catch(() => null);
            return r?.ok ? (r.value as LiveControl) : null;
          }}
          onFire={async (input) =>
            (await fireLiveQuiz({ data: { liveClassId, ...input } })) as Outcome
          }
          onCancel={async () => (await cancelLiveClass({ data: { liveClassId } })) as Outcome}
        />
      </div>
    </div>
  );
}
