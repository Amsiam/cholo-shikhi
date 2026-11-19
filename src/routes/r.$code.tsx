import { createFileRoute, Link } from '@tanstack/react-router';
import { Share2 } from 'lucide-react';
import { openReferralLink } from '#src/features/referrals/server/referral.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

// A referral link (US8.6). Opening it keeps the code until the visitor signs up and signs in; a
// signed-in friend is attributed at once; the owner's own browser is marked as theirs.
export const Route = createFileRoute('/r/$code')({
  loader: async ({ params }) => {
    const r = await openReferralLink({ data: { code: params.code } }).catch(() => null);
    const outcome = r?.ok ? (r.value as { outcome: string }).outcome : 'unknown_code';
    return { outcome };
  },
  component: ReferralLanding,
});

function ReferralLanding() {
  const { t } = useI18n();
  const { outcome } = Route.useLoaderData();
  const message =
    outcome === 'pending'
      ? t('referral.landing.invited')
      : outcome === 'attributed'
        ? t('referral.landing.attributed')
        : outcome === 'own_code' || outcome === 'own_device'
          ? t('referral.landing.own')
          : t('referral.landing.unknown');
  return (
    <section className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10 text-ink">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 border-2 border-primary bg-background p-6">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <Share2 aria-hidden="true" className="size-6 text-primary" />
          {t('referral.landing.title')}
        </h1>
        <p data-testid="referral-landing">{message}</p>
        {outcome === 'pending' ? (
          <Link
            to="/sign-up"
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t('referral.landing.signUp')}
          </Link>
        ) : (
          <Link to="/catalog" search={{}} className="font-semibold text-primary hover:underline">
            {t('referral.landing.browse')}
          </Link>
        )}
      </div>
    </section>
  );
}
