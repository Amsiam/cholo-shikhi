import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  decideKycItem,
  getKycDocument,
  listKycQueue,
} from '#src/features/kyc/server/kyc.functions.ts';
import type { KycQueueItem } from '#src/features/kyc/server/kyc.server.ts';
import { KycQueue } from '#src/features/kyc/ui/KycQueue.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// A6 KYC review for Finance and Admins.
export const Route = createFileRoute('/admin_/kyc')({
  loader: async () => {
    const r = await listKycQueue({ data: {} });
    return r.ok
      ? { denied: false as const, items: r.value as KycQueueItem[] }
      : { denied: true as const };
  },
  component: KycPage,
});

function KycPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('admin.denied')} />;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <KycQueue
          items={data.items}
          onDecide={async (item, decision, reason) => {
            const r = (await decideKycItem({
              data: { kind: item.kind, id: item.id, decision, ...(reason ? { reason } : {}) },
            })) as Outcome;
            if (r.ok) await router.invalidate();
            return r;
          }}
          onPhoto={async (item, side) => {
            const r = await getKycDocument({ data: { submissionId: item.id, side } });
            return r.ok ? (r.value as { dataUrl: string }).dataUrl : null;
          }}
        />
      </div>
    </div>
  );
}
