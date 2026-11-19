import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { saveSetting } from '#src/features/platform/server/settings.functions.ts';
import {
  decideReferralWithdrawal,
  getReferralAdmin,
} from '#src/features/referrals/server/referral.functions.ts';
import type { ReferralAdmin } from '#src/features/referrals/server/withdrawal.server.ts';
import { ReferralAdminView } from '#src/features/referrals/ui/ReferralAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };

// A1 referral payouts: settings and withdrawal approvals, for the owner-operator.
export const Route = createFileRoute('/admin_/referrals')({
  loader: async () => {
    const r = await getReferralAdmin({ data: {} });
    return r.ok
      ? { denied: false as const, data: r.value as ReferralAdmin }
      : { denied: true as const };
  },
  component: ReferralsAdminPage,
});

function ReferralsAdminPage() {
  const { t } = useI18n();
  const loaded = Route.useLoaderData();
  const router = useRouter();
  if (loaded.denied) return <AccessDenied reason={t('errors.referral.forbidden')} />;
  const refresh = async (r: unknown) => {
    const outcome = r as Outcome;
    if (outcome.ok) await router.invalidate();
    return outcome;
  };
  const save = (settingKey: string, value: number, reason: string) =>
    saveSetting({ data: { settingKey, value, reason } });
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <ReferralAdminView
          data={loaded.data}
          onSaveShare={async (bps) =>
            refresh(await save('referrals.shareBps', bps, 'Referral share set on A1'))
          }
          onSaveThreshold={async (poisha) =>
            refresh(
              await save('referrals.payoutThresholdPoisha', poisha, 'Referral threshold set on A1'),
            )
          }
          onDecide={async (withdrawalId, decision, reason) =>
            refresh(await decideReferralWithdrawal({ data: { withdrawalId, decision, reason } }))
          }
        />
      </div>
    </div>
  );
}
