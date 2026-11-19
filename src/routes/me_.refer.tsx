import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  declareReferrerAdult,
  getMyReferral,
  getMyReferralPayout,
  requestReferralWithdrawal,
  saveMyReferrerPayoutAccount,
  submitMyReferrerKyc,
} from '#src/features/referrals/server/referral.functions.ts';
import type { MyReferral } from '#src/features/referrals/server/referral.server.ts';
import type { MyReferralPayout } from '#src/features/referrals/server/withdrawal.server.ts';
import { ReferralPayout } from '#src/features/referrals/ui/ReferralPayout.tsx';
import { ReferView } from '#src/features/referrals/ui/ReferView.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Me → Refer (S18): the referral link, balance and history, and withdrawing earnings.
export const Route = createFileRoute('/me_/refer')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [r, payout] = await Promise.all([
      getMyReferral({ data: {} }),
      getMyReferralPayout({ data: {} }),
    ]);
    if (!r.ok || !payout.ok) throw redirect({ to: '/sign-in' });
    return { referral: r.value as MyReferral, payout: payout.value as MyReferralPayout };
  },
  component: ReferPage,
});

function ReferPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = async (r: unknown) => {
    const outcome = r as Outcome;
    if (outcome.ok) await router.invalidate();
    return outcome;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <ReferView data={data.referral}>
          <ReferralPayout
            data={data.payout}
            onDeclareAdult={async () => refresh(await declareReferrerAdult({ data: {} }))}
            onSubmitKyc={async (input) =>
              refresh(await submitMyReferrerKyc({ data: input as never }))
            }
            onSaveAccount={async (input) =>
              refresh(await saveMyReferrerPayoutAccount({ data: input as never }))
            }
            onWithdraw={async () => refresh(await requestReferralWithdrawal({ data: {} }))}
          />
        </ReferView>
      </div>
    </div>
  );
}
