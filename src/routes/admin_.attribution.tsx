import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  getAttributionCourse,
  listAttributionCases,
  openAttributionCase,
  postAttributionReassignments,
  resolveAttributionCase,
} from '#src/features/payouts/server/attribution.functions.ts';
import type { CaseCourse, CaseView } from '#src/features/payouts/server/attribution.server.ts';
import { AttributionQueue } from '#src/features/payouts/ui/AttributionQueue.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };

// A7 ambiguous attribution queue, for Finance or Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/attribution')({
  loader: async () => {
    const r = await listAttributionCases({ data: {} });
    return r.ok
      ? {
          denied: false as const,
          ...(r.value as {
            open: CaseView[];
            resolved: CaseView[];
            pendingReassignments: number;
            rules: { isOn: boolean; isApproved: boolean };
          }),
        }
      : { denied: true as const };
  },
  component: AttributionPage,
});

function AttributionPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.attribution.forbidden')} />;
  const refresh = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <AttributionQueue
          open={data.open}
          resolved={data.resolved}
          pendingReassignments={data.pendingReassignments}
          rules={data.rules}
          onPostPending={async () =>
            refresh((await postAttributionReassignments({ data: {} })) as Outcome)
          }
          onCourse={async (course) =>
            (await getAttributionCourse({ data: { course } })) as Outcome<CaseCourse>
          }
          onOpen={async (input) =>
            refresh((await openAttributionCase({ data: input as never })) as Outcome)
          }
          onResolve={async (caseId, ownerId, reason) =>
            refresh(
              (await resolveAttributionCase({ data: { caseId, ownerId, reason } })) as Outcome,
            )
          }
        />
      </div>
    </div>
  );
}
