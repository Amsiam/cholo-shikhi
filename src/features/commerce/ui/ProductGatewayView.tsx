// The development fake gateway for a Practice Pack, exam package or subscription order. Like the
// course gateway, it says plainly that no money moves; the server settles the order exactly once.
import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { OrderView } from '../server/product.server.ts';

export function ProductGatewayView(props: {
  order: OrderView;
  onSettle: (outcome: 'succeed' | 'fail') => Promise<string | null>;
}) {
  const { t, tDynamic, locale, formatInteger, formatMoney, formatDate } = useI18n();
  const o = props.order;
  const [busy, setBusy] = useState<'succeed' | 'fail' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = formatMoney(o.amountPoisha as MoneyPoisha);
  const settle = async (outcome: 'succeed' | 'fail') => {
    setBusy(outcome);
    setError(await props.onSettle(outcome));
    setBusy(null);
  };
  const next =
    o.productType === 'subscription_plan'
      ? { to: '/learn' as const, label: t('order.goCourses') }
      : { to: '/exams' as const, label: t('order.goExams') };
  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10 text-ink"
      data-testid="product-gateway"
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
            <dt className="text-sm text-ink-muted">{t(`order.kind.${o.productType}`)}</dt>
            <dd className="font-semibold break-words">{locale === 'bn' ? o.titleBn : o.titleEn}</dd>
            <dt className="text-sm text-ink-muted">{t('order.access')}</dt>
            <dd>
              {o.productType === 'subscription_plan'
                ? t('order.oneMonth')
                : t('catalog.browse.duration', { months: formatInteger(o.accessMonths) })}
            </dd>
            <dt className="text-sm text-ink-muted">{t('checkout.amount')}</dt>
            <dd className="text-xl font-extrabold tabular-nums">{price}</dd>
          </dl>
          {o.status === 'pending' ? (
            <div className="flex flex-col gap-2">
              <Button
                disabled={busy !== null}
                onClick={() => void settle('succeed')}
                data-testid="product-pay"
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
                {t('order.success')}
              </p>
              {o.access ? (
                <p className="text-sm">{t('order.until', { date: formatDate(o.access.endsAt) })}</p>
              ) : null}
              <Link
                to={next.to}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="product-next"
              >
                {next.label}
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
