import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  getMyKycStatus,
  saveMyPayoutAccount,
  submitMyKyc,
} from '#src/features/kyc/server/kyc.functions.ts';
import type { MyKyc } from '#src/features/kyc/server/kyc.server.ts';
import { KycView } from '#src/features/kyc/ui/KycView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// I6 Payout details: KYC and the payout account.
export const Route = createFileRoute('/instructor/payouts')({
  loader: async () => {
    const r = await getMyKycStatus({ data: {} });
    return r.ok ? { denied: false as const, kyc: r.value as MyKyc } : { denied: true as const };
  },
  component: PayoutsPage,
});

function PayoutsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  const refresh = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <KycView
          data={data.kyc}
          onSubmitKyc={async (input) =>
            refresh((await submitMyKyc({ data: input as never })) as Outcome)
          }
          onSaveAccount={async (input) =>
            refresh((await saveMyPayoutAccount({ data: input as never })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
