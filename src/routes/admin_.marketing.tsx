import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { listSegments } from '#src/features/goals/server/goals.functions.ts';
import {
  createBundle,
  createCampaign,
  createPromoCode,
  getMarketingOverview,
  setPromoCodeActive,
} from '#src/features/marketing/server/marketing.functions.ts';
import type { MarketingOverview } from '#src/features/marketing/server/marketing.server.ts';
import { MarketingAdmin, type SegmentOption } from '#src/features/marketing/ui/MarketingAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };

// A9 Marketing: campaigns, promo codes and bundles, for Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/marketing')({
  loader: async () => {
    const [r, segments] = await Promise.all([
      getMarketingOverview({ data: {} }),
      listSegments({ data: { page: 1, pageSize: 100 } }).catch(() => null),
    ]);
    if (!r.ok) return { denied: true as const };
    return {
      denied: false as const,
      overview: r.value as MarketingOverview,
      segments: (segments?.ok
        ? (segments.value as { rows: SegmentOption[] }).rows
        : []) as SegmentOption[],
    };
  },
  component: MarketingPage,
});

function MarketingPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.marketing.forbidden')} />;
  const refresh = async (r: unknown) => {
    const outcome = r as Outcome;
    if (outcome.ok) await router.invalidate();
    return outcome;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <MarketingAdmin
          overview={data.overview}
          segments={data.segments}
          onSaveCampaign={async (v) => refresh(await createCampaign({ data: v as never }))}
          onSavePromo={async (v) => refresh(await createPromoCode({ data: v as never }))}
          onSetPromoActive={async (promoCodeId, isActive) =>
            refresh(await setPromoCodeActive({ data: { promoCodeId, isActive } }))
          }
          onSaveBundle={async (v) => refresh(await createBundle({ data: v as never }))}
        />
      </div>
    </div>
  );
}
