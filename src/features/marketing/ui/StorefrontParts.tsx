// Student-facing marketing pieces: the S2 campaign banner (US8.1), the catalog's bundle list (US8.4)
// and the promo code field beside Buy on S4 (US8.3). Text comes in the student's language.
import { Link } from '@tanstack/react-router';
import { Megaphone, Package, TicketPercent } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BundleCard, CampaignBanner } from '../server/marketing.server.ts';

export function CampaignBanners(props: { banners: readonly CampaignBanner[] }) {
  const { t, locale } = useI18n();
  if (props.banners.length === 0) return null;
  return (
    <aside
      aria-label={t('marketing.banner.label')}
      className="flex flex-col gap-2"
      data-testid="campaign-banners"
    >
      {props.banners.map((b) => (
        <a
          key={b.campaignId}
          href={b.landingPath}
          className="flex items-center gap-3 border border-primary/30 bg-primary/5 px-4 py-3 font-semibold text-primary underline-offset-4 hover:underline"
          data-testid="campaign-banner"
        >
          <Megaphone aria-hidden="true" className="size-5 shrink-0" />
          {locale === 'bn' ? b.bannerBn : b.bannerEn}
        </a>
      ))}
    </aside>
  );
}

export function BundleList(props: { bundles: readonly BundleCard[] }) {
  const { t, locale, formatMoney } = useI18n();
  if (props.bundles.length === 0) return null;
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  return (
    <section
      aria-labelledby="bundles-title"
      className="flex flex-col gap-4"
      data-testid="bundle-section"
    >
      <h2 id="bundles-title" className="flex items-center gap-2 text-2xl font-bold">
        <Package aria-hidden="true" className="size-6 text-primary" />
        {t('catalog.browse.tab.bundles')}
      </h2>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {props.bundles.map((b) => (
          <li
            key={b.bundleId}
            className="flex flex-col gap-2 border border-primary/15 bg-background p-5"
            data-testid="bundle-card"
          >
            <span className="text-lg font-semibold">{pick(b.nameBn, b.nameEn)}</span>
            <ul className="flex flex-col gap-1 text-sm">
              {b.courses.map((c) => (
                <li key={c.courseId}>
                  <Link
                    to="/courses/$courseId"
                    params={{ courseId: c.courseId }}
                    className="underline underline-offset-4"
                  >
                    {pick(c.titleBn, c.titleEn)}
                  </Link>
                </li>
              ))}
            </ul>
            <span className="mt-auto text-xl font-bold tabular-nums">
              {formatMoney(b.pricePoisha as MoneyPoisha)}
            </span>
            <Link
              to="/bundles/$bundleId"
              params={{ bundleId: b.bundleId }}
              className="inline-flex min-h-11 items-center justify-center rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
              data-testid="bundle-open"
            >
              {t('bundle.view')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PromoCodeField(props: {
  value: string;
  onChange: (v: string) => void;
  errorKey: string | null;
}) {
  const { t, tDynamic } = useI18n();
  return (
    <div className="grid max-w-xs gap-1.5" data-testid="promo-field">
      <Label htmlFor="promo-code" className="flex items-center gap-1.5">
        <TicketPercent aria-hidden="true" className="size-4 text-primary" />
        {t('marketing.promo.apply')}
      </Label>
      <Input
        id="promo-code"
        value={props.value}
        autoComplete="off"
        aria-invalid={props.errorKey ? true : undefined}
        aria-describedby={props.errorKey ? 'promo-code-error' : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.errorKey ? (
        <p id="promo-code-error" role="alert" className="text-sm text-destructive">
          {tDynamic(props.errorKey)}
        </p>
      ) : null}
    </div>
  );
}
