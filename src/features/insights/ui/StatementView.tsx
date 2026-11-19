// US7.8 (monthly until payout cycles exist): one month of an instructor's earnings, ready to print
// or save as PDF from the browser, with a CSV download. Built from the immutable ledger, so the same
// month always gives the same statement.
import { Link } from '@tanstack/react-router';
import { Download, FileText, Printer } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { MonthlyStatement } from '../server/insights.types.ts';
import { formatMonth } from './insights-parts.tsx';

/** Saves the CSV text as a file (the BOM is already in the text). */
function downloadCsv(csv: string, month: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `statement-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function StatementView(props: { statement: MonthlyStatement }) {
  const { t, locale, formatMoney, formatDate, formatInteger } = useI18n();
  const s = props.statement;
  const signed = (v: number) =>
    v < 0 ? `−${formatMoney(-v as MoneyPoisha)}` : formatMoney(v as MoneyPoisha);
  const monthName = formatMonth(s.month, locale, true);
  // A line with no course: a sale of the platform, or a salary, policy adjustment or payout.
  const courseOf = (l: MonthlyStatement['lines'][number]) =>
    (locale === 'bn' ? l.titleBn : l.titleEn) ||
    l.titleBn ||
    l.titleEn ||
    (l.kind === 'course_sale' || l.kind === 'course_refund'
      ? t('statement.platform')
      : t('statement.noCourse'));
  // Reassignments, salary and policy adjustments get their own totals when the month has any.
  const extra = (
    [
      ['statement.reassigned', s.reassigned],
      ['statement.salary', s.salary],
      ['statement.policyAdjustment', s.policyAdjustment],
    ] as const
  ).filter(([, v]) => v !== 0);
  return (
    <article className="flex flex-col gap-6" data-testid="statement">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to="/instructor/earnings"
          className="tap-target text-sm font-semibold text-primary hover:underline"
        >
          {t('statement.back')}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => downloadCsv(s.csv[locale], s.month)}
            data-testid="statement-csv"
          >
            <Download aria-hidden="true" className="size-4" />
            {t('statement.csv')}
          </Button>
          <Button onClick={() => window.print()} data-testid="statement-print">
            <Printer aria-hidden="true" className="size-4" />
            {t('statement.print')}
          </Button>
        </div>
      </div>
      <header className="flex flex-col gap-1 border-b border-primary/20 pb-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <FileText aria-hidden="true" className="size-4" />
          {t('statement.kicker')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {t('statement.title', { month: monthName })}
        </h1>
        <p className="text-ink/80">{s.instructorName}</p>
      </header>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            ['statement.opening', s.opening],
            ['statement.earned', s.earned],
            ['statement.refunded', -s.refunded],
            ...extra,
            ['statement.paidOut', -s.paidOut],
            ['statement.closing', s.closing],
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col gap-1 border border-primary/15 bg-background p-4"
            data-testid={`statement-total-${key.slice('statement.'.length)}`}
          >
            <dt className="text-sm text-ink/70">{t(key)}</dt>
            <dd className="text-xl font-extrabold tabular-nums">{signed(value)}</dd>
          </div>
        ))}
      </dl>
      {s.lines.length === 0 ? (
        <p className="text-ink-muted">{t('statement.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">{t('statement.title', { month: monthName })}</caption>
            <thead className="border-b border-primary/15 text-ink/70">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t('statement.col.date')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('statement.col.type')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('statement.col.course')}
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  {t('statement.col.amount')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {s.lines.map((l, i) => (
                <tr
                  key={`${l.occurredAt}-${l.courseId}-${l.amount}-${i.toString()}`}
                  data-testid="statement-line"
                >
                  <td className="py-2 pr-3 tabular-nums">{formatDate(l.occurredAt)}</td>
                  <td className="px-3 py-2">{t(`statement.kind.${l.kind}`)}</td>
                  <td className="px-3 py-2 break-words">{courseOf(l)}</td>
                  <td className="py-2 pl-3 text-right font-semibold tabular-nums">
                    {signed(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-muted">{t('statement.note')}</p>
      <p className="text-xs text-ink-muted" data-testid="statement-stored">
        {s.stored
          ? t('statement.stored', {
              version: formatInteger(s.stored.version),
              stored: formatDate(s.stored.storedAt),
              until: formatDate(s.stored.retainUntil),
            })
          : t('statement.open')}
      </p>
    </article>
  );
}

/** The earnings page's list of months, each linking to its statement. */
export function StatementMonths(props: { months: readonly string[] }) {
  const { t, locale } = useI18n();
  return (
    <section
      className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      aria-labelledby="statement-months"
      data-testid="statement-months"
    >
      <h2 id="statement-months" className="text-lg font-bold">
        {t('statement.list')}
      </h2>
      {props.months.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('statement.none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {props.months.map((month) => (
            <li key={month}>
              <Link
                to="/instructor/statements/$month"
                params={{ month }}
                className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary/20 px-3 text-sm font-semibold hover:bg-primary/5"
              >
                <FileText aria-hidden="true" className="size-4 text-primary" />
                {formatMonth(month, locale, true)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
