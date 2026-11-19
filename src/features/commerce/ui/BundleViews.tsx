// US8.5 bundle screens: the bundle page (each member course's standalone price beside the bundle
// price and the saving, AC8.5.1) and the development fake gateway for a bundle order, which says
// plainly that no money moves. On success each course is listed with its own access end date.
import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, FlaskConical, Package, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { BundleOffer, BundleOrderView } from '../server/bundle.server.ts';

const m = (n: number) => n as MoneyPoisha;

export function BundleOfferView(props: {
  offer: BundleOffer;
  isSignedIn: boolean;
  onBuy: () => Promise<string | null>;
}) {
  const { t, tDynamic, locale, formatMoney, formatInteger } = useI18n();
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const o = props.offer;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buy = async () => {
    setBusy(true);
    setError(await props.onBuy());
    setBusy(false);
  };
  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10 text-ink"
      data-testid="bundle-offer"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Package aria-hidden="true" className="size-4" />
            {t('bundle.kind')}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{pick(o.nameBn, o.nameEn)}</h1>
        </header>
        <ul className="flex flex-col divide-y divide-primary/10 border border-primary/15 bg-background">
          {o.courses.map((c) => (
            <li
              key={c.courseId}
              className="flex flex-wrap items-baseline justify-between gap-2 p-4"
              data-testid="bundle-course"
            >
              <span className="flex flex-col">
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: c.courseId }}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {pick(c.titleBn, c.titleEn)}
                </Link>
                <span className="text-xs text-ink-muted">
                  {t('catalog.browse.duration', { months: formatInteger(c.accessDurationMonths) })}
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {t('bundle.standalone', { price: formatMoney(m(c.listPricePoisha)) })}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-2 border-primary bg-background p-5">
          <dt className="text-sm text-ink-muted">{t('bundle.standaloneTotal')}</dt>
          <dd className="tabular-nums line-through">{formatMoney(m(o.standaloneTotalPoisha))}</dd>
          <dt className="font-semibold">{t('bundle.price')}</dt>
          <dd className="text-2xl font-extrabold tabular-nums" data-testid="bundle-price">
            {formatMoney(m(o.pricePoisha))}
          </dd>
          {o.savingPoisha > 0 ? (
            <>
              <dt className="text-sm font-semibold text-pass">{t('bundle.saving')}</dt>
              <dd className="font-semibold text-pass tabular-nums" data-testid="bundle-saving">
                {formatMoney(m(o.savingPoisha))}
              </dd>
            </>
          ) : null}
        </dl>
        {props.isSignedIn ? (
          <Button
            className="w-full sm:w-fit"
            disabled={busy}
            onClick={() => void buy()}
            data-testid="bundle-buy"
          >
            {t('bundle.buy', { price: formatMoney(m(o.pricePoisha)) })}
          </Button>
        ) : (
          <Link
            to="/sign-in"
            className="inline-flex min-h-11 w-fit items-center justify-center rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t('bundle.signInToBuy')}
          </Link>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function BundleGatewayView(props: {
  order: BundleOrderView;
  onSettle: (outcome: 'succeed' | 'fail') => Promise<string | null>;
}) {
  const { t, tDynamic, locale, formatMoney, formatDate } = useI18n();
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const o = props.order;
  const [busy, setBusy] = useState<'succeed' | 'fail' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = formatMoney(m(o.amountPoisha));
  const settle = async (outcome: 'succeed' | 'fail') => {
    setBusy(outcome);
    setError(await props.onSettle(outcome));
    setBusy(null);
  };
  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10 text-ink"
      data-testid="bundle-gateway"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <p
          role="note"
          className="flex items-center gap-2 border-2 border-dashed border-omr bg-omr-soft px-4 py-3 text-sm font-semibold text-omr"
        >
          <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
          {t('checkout.testMode')}
        </p>
        <div className="flex flex-col gap-5 border-2 border-primary bg-background p-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-extrabold">{t('checkout.title')}</h1>
            <p className="text-sm font-medium text-primary">{t('checkout.gatewayName')}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-sm text-ink-muted">{t('bundle.kind')}</dt>
            <dd className="font-semibold break-words">{pick(o.nameBn, o.nameEn)}</dd>
            <dt className="text-sm text-ink-muted">{t('checkout.amount')}</dt>
            <dd className="text-xl font-extrabold tabular-nums">{price}</dd>
          </dl>
          <ul className="flex flex-col gap-1 text-sm">
            {o.items.map((i) => (
              <li key={i.courseId} className="flex flex-wrap justify-between gap-2">
                <span>{pick(i.titleBn, i.titleEn)}</span>
                <span className="text-ink-muted">
                  {i.accessEndsAt
                    ? t('order.until', { date: formatDate(i.accessEndsAt) })
                    : t('bundle.standalone', { price: formatMoney(m(i.listPricePoisha)) })}
                </span>
              </li>
            ))}
          </ul>
          {o.status === 'pending' ? (
            <div className="flex flex-col gap-2">
              <Button
                disabled={busy !== null}
                onClick={() => void settle('succeed')}
                data-testid="bundle-pay"
              >
                {t('checkout.pay', { price })}
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => void settle('fail')}
              >
                {t('checkout.decline')}
              </Button>
            </div>
          ) : null}
          {o.status === 'succeeded' ? (
            <div className="flex flex-col gap-3" role="status">
              <p className="flex items-center gap-2 font-semibold text-pass">
                <CheckCircle2 aria-hidden="true" className="size-5" />
                {t('bundle.success')}
              </p>
              <Link
                to="/learn"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="bundle-next"
              >
                {t('order.goCourses')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          ) : null}
          {o.status === 'failed' ? (
            <div className="flex flex-col gap-3" role="status">
              <p className="flex items-center gap-2 font-semibold text-omr">
                <XCircle aria-hidden="true" className="size-5" />
                {t('checkout.failed')}
              </p>
              <Link
                to="/catalog"
                search={{}}
                className="tap-target font-semibold text-primary hover:underline"
              >
                {t('order.backToCatalog')}
              </Link>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tDynamic(error)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
