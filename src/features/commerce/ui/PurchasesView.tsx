// Purchase history and receipts: every payment the Student made, its status and the access it
// bought. A receipt is a printable sheet; a fake-gateway payment is marked as a test with no money.
import { Link } from '@tanstack/react-router';
import { Printer, Receipt } from 'lucide-react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { Purchase } from '../server/commerce.server.ts';
import type { OrderView } from '../server/product.server.ts';
import { RefundCell } from './RefundParts.tsx';

const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

const STATUS_TONE: Record<Purchase['status'], string> = {
  succeeded: 'bg-pass/15 text-pass',
  pending: 'bg-ink/10 text-ink',
  failed: 'bg-omr-soft text-omr',
};

function AccessCell(props: { purchase: Purchase }) {
  const { t, formatDate, formatInteger } = useI18n();
  const a = props.purchase.access;
  if (!a) return <span className="text-ink-muted">—</span>;
  if (a.isExpired)
    return (
      <span className="text-ink-muted">
        {t('purchases.access.ended', { date: formatDate(a.endsAt) })}
      </span>
    );
  if (a.isExpiringSoon)
    return (
      <span className="font-semibold text-omr">
        {t('purchases.access.daysLeft', { days: formatInteger(a.daysLeft) })}
      </span>
    );
  return <span>{t('learn.accessUntil', { date: formatDate(a.endsAt) })}</span>;
}

export function PurchasesView(props: {
  purchases: Purchase[];
  orders?: OrderView[];
  onRequestRefund?: (
    paymentId: string,
    reason: string,
  ) => Promise<{ ok: true } | { ok: false; error: { i18nKey: string } }>;
}) {
  const { t, locale, formatMoney, formatDate } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="purchases-page">
      <header className="flex flex-col gap-1">
        <h1>{t('purchases.title')}</h1>
        <p className="text-ink/75">{t('purchases.subtitle')}</p>
      </header>
      <DataTable
        testId="purchases-table"
        caption={t('purchases.title')}
        rows={props.purchases}
        rowId={(p) => p.paymentId}
        emptyText={t('purchases.empty')}
        display={[
          {
            id: 'date',
            header: t('insights.col.date'),
            cell: (p) => <span className="whitespace-nowrap">{formatDate(p.createdAt)}</span>,
          },
          {
            id: 'course',
            header: t('insights.col.course'),
            cell: (p) => (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{pick(p.titleBn, p.titleEn, locale)}</span>
                {p.kind === 'renewal' ? (
                  <span className="text-xs text-ink-muted">{t('purchases.kind.renewal')}</span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'status',
            header: t('insights.col.status'),
            cell: (p) => (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[p.status]}`}
              >
                {t(`purchases.status.${p.status}`)}
              </span>
            ),
          },
          {
            id: 'access',
            header: t('purchases.col.access'),
            cell: (p) => <AccessCell purchase={p} />,
          },
          {
            id: 'amount',
            header: t('insights.col.amount'),
            isNumeric: true,
            cell: (p) => formatMoney(p.amountPoisha as MoneyPoisha),
          },
          {
            id: 'refund',
            header: t('refund.col'),
            cell: (p) =>
              props.onRequestRefund ? (
                <RefundCell
                  paymentId={p.paymentId}
                  courseTitle={pick(p.titleBn, p.titleEn, locale)}
                  refund={p.refund}
                  onRequest={props.onRequestRefund}
                />
              ) : null,
          },
          {
            id: 'receipt',
            header: <span className="sr-only">{t('purchases.col.receipt')}</span>,
            isNumeric: true,
            cell: (p) =>
              p.status === 'succeeded' ? (
                <Link
                  to="/me/purchases/$paymentId"
                  params={{ paymentId: p.paymentId }}
                  className="tap-target gap-1.5 font-semibold text-primary hover:underline"
                  data-testid="purchase-receipt-link"
                >
                  <Receipt aria-hidden="true" className="size-4" />
                  {t('purchases.col.receipt')}
                </Link>
              ) : null,
          },
        ]}
      />
      {props.orders && props.orders.length > 0 ? (
        <section aria-labelledby="orders-title" className="flex flex-col gap-3">
          <h2 id="orders-title" className="text-xl font-bold">
            {t('order.historyTitle')}
          </h2>
          <DataTable
            testId="orders-table"
            caption={t('order.historyTitle')}
            rows={props.orders}
            rowId={(o) => o.orderId}
            emptyText=""
            display={[
              {
                id: 'date',
                header: t('insights.col.date'),
                cell: (o) => <span className="whitespace-nowrap">{formatDate(o.createdAt)}</span>,
              },
              {
                id: 'product',
                header: t('order.col.product'),
                cell: (o) => (
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold">{pick(o.titleBn, o.titleEn, locale)}</span>
                    <span className="text-xs text-ink-muted">
                      {t(`order.kind.${o.productType}`)}
                    </span>
                  </span>
                ),
              },
              {
                id: 'status',
                header: t('insights.col.status'),
                cell: (o) => (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[o.status]}`}
                  >
                    {t(`purchases.status.${o.status}`)}
                  </span>
                ),
              },
              {
                id: 'access',
                header: t('purchases.col.access'),
                cell: (o) =>
                  o.access ? (
                    <span>{t('learn.accessUntil', { date: formatDate(o.access.endsAt) })}</span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  ),
              },
              {
                id: 'amount',
                header: t('insights.col.amount'),
                isNumeric: true,
                cell: (o) => formatMoney(o.amountPoisha as MoneyPoisha),
              },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}

export function ReceiptView(props: { purchase: Purchase; displayName: string }) {
  const { t, locale, formatMoney, formatDateTime, formatDate, formatInteger } = useI18n();
  const p = props.purchase;
  const rows: Array<[string, string]> = [
    [t('receipt.number'), p.receiptNumber],
    [t('receipt.date'), formatDateTime(p.settledAt ?? p.createdAt)],
    [t('receipt.billedTo'), props.displayName || t('shell.account.unnamed')],
    [t('insights.col.course'), pick(p.titleBn, p.titleEn, locale)],
    [
      t('receipt.access'),
      t('catalog.browse.duration', { months: formatInteger(p.accessDurationMonths) }),
    ],
    ...(p.access
      ? ([[t('receipt.validUntil'), formatDate(p.access.endsAt)]] as Array<[string, string]>)
      : []),
    [t('receipt.method'), t('receipt.method.fake')],
  ];
  return (
    <div className="flex flex-col gap-5" data-testid="receipt-page">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/me/purchases" className="tap-target font-medium text-primary hover:underline">
          {t('receipt.back')}
        </Link>
        <Button variant="outline" onClick={() => window.print()} data-testid="receipt-print">
          <Printer aria-hidden="true" className="size-4" />
          {t('receipt.print')}
        </Button>
      </div>
      <article className="mx-auto flex w-full max-w-xl flex-col gap-6 border border-primary/20 bg-background p-6 sm:p-8 print:border-ink">
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-lg font-extrabold">
              <span aria-hidden="true" className="size-4 rounded-full border-2 border-omr bg-ink" />
              {t('app.name')}
            </p>
            <h1 className="text-2xl font-extrabold">{t('receipt.title')}</h1>
          </div>
          <span className="rounded-full bg-pass/15 px-3 py-1 text-sm font-semibold text-pass">
            {t('purchases.status.succeeded')}
          </span>
        </header>
        {p.gateway === 'fake' ? (
          <p className="border border-dashed border-omr bg-omr-soft px-3 py-2 text-sm font-semibold text-omr">
            {t('receipt.testNote')}
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm text-ink-muted">{label}</dt>
              <dd className="font-medium break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="flex items-baseline justify-between border-t-2 border-ink pt-4">
          <span className="font-semibold">{t('receipt.total')}</span>
          <span className="text-2xl font-extrabold tabular-nums" data-testid="receipt-total">
            {formatMoney(p.amountPoisha as MoneyPoisha)}
          </span>
        </p>
      </article>
    </div>
  );
}
