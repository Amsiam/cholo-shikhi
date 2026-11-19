// The development fake payment gateway. It stands where a real gateway's hosted page will be (card
// entry only ever happens on SSLCommerz / ShurjoPay pages: project.md), and says plainly that no
// money moves. The Student approves or declines; the server settles the payment exactly once.
import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';

export type FakeGatewayCheckout = {
  paymentId: string;
  courseId: string;
  courseTitleBn: string;
  courseTitleEn: string;
  amountPoisha: number;
  /** US8.3: the promo discount already taken off the amount (0 or absent without a code). */
  discountPoisha?: number;
  accessDurationMonths: number;
  status: 'pending' | 'succeeded' | 'failed';
};

export function FakeGatewayView(props: {
  checkout: FakeGatewayCheckout;
  onSettle: (outcome: 'succeed' | 'fail') => Promise<string | null>;
  onRetry: () => Promise<void>;
}) {
  const { t, locale, formatInteger } = useI18n();
  const { checkout } = props;
  const [busy, setBusy] = useState<'succeed' | 'fail' | 'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = formatMoney(checkout.amountPoisha as MoneyPoisha, locale);
  const title = locale === 'bn' ? checkout.courseTitleBn : checkout.courseTitleEn;

  const settle = async (outcome: 'succeed' | 'fail') => {
    setBusy(outcome);
    setError(await props.onSettle(outcome));
    setBusy(null);
  };

  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10 text-ink"
      data-testid="fake-gateway"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <p
          role="note"
          className="flex items-center gap-2 border-2 border-dashed border-omr bg-omr-soft px-4 py-3 text-sm font-semibold text-omr"
          data-testid="fake-gateway-test-banner"
        >
          <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
          {t('checkout.testMode')}
        </p>

        <div className="flex flex-col gap-5 border-2 border-primary bg-background p-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-extrabold">{t('checkout.title')}</h1>
            <p className="text-sm font-medium text-primary">{t('checkout.gatewayName')}</p>
          </header>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-primary/15 py-4">
            <dt className="text-sm text-ink-muted">{t('checkout.course')}</dt>
            <dd className="font-semibold break-words" data-testid="fake-gateway-course">
              {title}
            </dd>
            <dt className="text-sm text-ink-muted">{t('catalog.course.durationLabel')}</dt>
            <dd>
              {t('catalog.browse.duration', {
                months: formatInteger(checkout.accessDurationMonths),
              })}
            </dd>
            <dt className="text-sm text-ink-muted">{t('checkout.amount')}</dt>
            <dd className="text-2xl font-extrabold tabular-nums" data-testid="fake-gateway-amount">
              {price}
            </dd>
            {checkout.discountPoisha ? (
              <dd className="col-span-2 text-sm text-primary" data-testid="fake-gateway-discount">
                {t('marketing.promo.discountApplied', {
                  amount: formatMoney(checkout.discountPoisha as MoneyPoisha, locale),
                })}
              </dd>
            ) : null}
          </dl>

          {checkout.status === 'pending' ? (
            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                type="button"
                disabled={busy !== null}
                onClick={() => void settle('succeed')}
                data-testid="fake-gateway-pay"
              >
                {t('checkout.pay', { price })}
              </Button>
              <Button
                size="lg"
                type="button"
                variant="outline"
                className="border-omr/50 text-omr hover:bg-omr-soft"
                disabled={busy !== null}
                onClick={() => void settle('fail')}
                data-testid="fake-gateway-decline"
              >
                {t('checkout.decline')}
              </Button>
            </div>
          ) : null}
          {checkout.status === 'succeeded' ? (
            <div className="flex flex-col gap-4" role="status" data-testid="fake-gateway-success">
              <p className="flex items-center gap-2 text-lg font-bold text-pass">
                <CheckCircle2 aria-hidden="true" className="size-6" />
                {t('checkout.success')}
              </p>
              <Link
                to="/learn/$courseId"
                params={{ courseId: checkout.courseId }}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
                data-testid="fake-gateway-start"
              >
                {t('checkout.startLearning')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          ) : null}
          {checkout.status === 'failed' ? (
            <div className="flex flex-col gap-4" role="status" data-testid="fake-gateway-failed">
              <p className="flex items-center gap-2 text-lg font-bold text-omr">
                <XCircle aria-hidden="true" className="size-6" />
                {t('checkout.failed')}
              </p>
              <Button
                size="lg"
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('retry');
                  await props.onRetry();
                  setBusy(null);
                }}
                data-testid="fake-gateway-retry"
              >
                {t('checkout.retry')}
              </Button>
              <Link
                to="/courses/$courseId"
                params={{ courseId: checkout.courseId }}
                className="text-center font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('checkout.backToCourse')}
              </Link>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="fake-gateway-error">
              {t('checkout.error')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
