import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  exportDisputeEvidencePack,
  getDisputeEvidencePack,
  listPaymentDisputes,
  recordPaymentDispute,
} from '#src/features/trustops/server/dispute.functions.ts';
import type { DisputePackView, DisputeView } from '#src/features/trustops/server/dispute.server.ts';
import { DisputesAdmin } from '#src/features/trustops/ui/DisputesAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };

// A11 Payment disputes and evidence packs, for Finance or Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/disputes')({
  loader: async () => {
    const r = await listPaymentDisputes({ data: {} });
    return r.ok
      ? { denied: false as const, disputes: r.value as DisputeView[] }
      : { denied: true as const };
  },
  component: DisputesPage,
});

function DisputesPage() {
  const { t, locale } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('errors.dispute.forbidden')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <DisputesAdmin
          disputes={data.disputes}
          onRecord={async (v) => {
            const r = (await recordPaymentDispute({ data: v as never })) as Outcome;
            if (r.ok) await router.invalidate();
            return r;
          }}
          onOpen={async (disputeId) =>
            (await getDisputeEvidencePack({ data: { disputeId } })) as Outcome<DisputePackView>
          }
          onExport={async (disputeId, format) =>
            (await exportDisputeEvidencePack({
              data: { disputeId, format, locale },
            })) as Outcome<{ fileName: string; contentType: string; content: string }>
          }
        />
      </div>
    </div>
  );
}
