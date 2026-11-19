import { createFileRoute, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  commitPayoutCycle,
  dryRunPayoutCycle,
  getPayoutsOverview,
  recordPayoutFailure,
  recordPayoutPayment,
  releaseHeldPayout,
} from '#src/features/payouts/server/payouts.functions.ts';
import type { DryRun, PayoutsOverview } from '#src/features/payouts/server/payouts.server.ts';
import { PayoutCycles } from '#src/features/payouts/ui/PayoutCycles.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true; value?: unknown } | { ok: false; error: { i18nKey: string } };

// A1 Payout cycles for Finance and Admins. Recording a payment is offered only to an Admin who has
// completed two-step sign-in (the server checks it again).
export const Route = createFileRoute('/admin_/payouts')({
  loader: async () => {
    const [r, shell] = await Promise.all([getPayoutsOverview({ data: {} }), getShellState()]);
    if (!r.ok) return { denied: true as const };
    const canPay = shell.ok && shell.value.roles.includes('admin') && shell.value.hasStepUp;
    return { denied: false as const, data: r.value as PayoutsOverview, canPay };
  },
  component: PayoutsPage,
});

function PayoutsPage() {
  const { t } = useI18n();
  const loaded = Route.useLoaderData();
  const router = useRouter();
  if (loaded.denied) return <AccessDenied reason={t('admin.denied')} />;
  const refresh = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <PayoutCycles
          data={loaded.data}
          canPay={loaded.canPay}
          onDryRun={async (month) =>
            (await dryRunPayoutCycle({ data: { month } })) as
              | { ok: true; value: DryRun }
              | { ok: false; error: { i18nKey: string } }
          }
          onCommit={async (month, inputHash) =>
            refresh((await commitPayoutCycle({ data: { month, inputHash } })) as Outcome)
          }
          onPay={async (lineId, providerRef, idempotencyKey) =>
            refresh(
              (await recordPayoutPayment({
                data: { lineId, providerRef, idempotencyKey },
              })) as Outcome,
            )
          }
          onFail={async (lineId, note) =>
            refresh((await recordPayoutFailure({ data: { lineId, note } })) as Outcome)
          }
          onRelease={async (lineId) =>
            refresh((await releaseHeldPayout({ data: { lineId } })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
