// An instructor's own earnings: what they have earned from their 70% share, month by month and per
// course, with a link to each course's statistics; salary, pay-policy adjustments and attribution
// reassignments each on their own line, adding up to the total.
import { Link } from '@tanstack/react-router';
import { BarChart3, BookOpen, CalendarDays, Wallet } from 'lucide-react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import type { InstructorEarnings } from '../server/insights.types.ts';
import { BarChart, Panel, StatTile } from './insights-parts.tsx';

const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

export function EarningsView(props: { earnings: InstructorEarnings }) {
  const { t, locale, formatMoney, formatInteger } = useI18n();
  const e = props.earnings;
  const money = (v: number) => formatMoney(v as MoneyPoisha);
  const signed = (v: number) => (v < 0 ? `−${money(-v)}` : money(v));
  const thisMonth = e.byMonth[e.byMonth.length - 1]?.amount ?? 0;
  const lastMonth = e.byMonth[e.byMonth.length - 2]?.amount ?? 0;
  return (
    <div className="flex flex-col gap-6" data-testid="earnings-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('insights.earnings.title')}
        </h1>
        <p className="text-ink/70">{t('insights.earnings.subtitle')}</p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Wallet}
          label={t('insights.earnings.total')}
          value={money(e.total)}
          hint={t('insights.earnings.totalHint')}
          testId="earnings-total"
        />
        <StatTile
          icon={CalendarDays}
          tone="pass"
          label={t('insights.earnings.thisMonth')}
          value={money(thisMonth)}
          hint={t('insights.earnings.lastMonth', { amount: money(lastMonth) })}
          testId="earnings-this-month"
        />
        <StatTile
          icon={BarChart3}
          tone="ink"
          label={t('insights.earnings.sales')}
          value={formatInteger(e.sales)}
          testId="earnings-sales"
        />
        <StatTile
          icon={BookOpen}
          tone="omr"
          label={t('insights.earnings.courses')}
          value={formatInteger(e.courses.length)}
          testId="earnings-courses"
        />
      </div>
      <Panel title={t('insights.earnings.other')} description={t('insights.earnings.otherHint')}>
        <dl
          className="flex flex-col divide-y divide-primary/10 text-sm"
          data-testid="earnings-lines"
        >
          {(
            [
              ['courseEarnings', e.courseEarnings, false],
              ['reassigned', e.reassigned, true],
              ['salary', e.salary, false],
              ['policyAdjustment', e.policyAdjustment, false],
            ] as const
          ).map(([key, amount, isPartOf]) => (
            <div
              key={key}
              className={`flex justify-between gap-4 py-2 ${isPartOf ? 'pl-4 text-ink/70' : ''}`}
              data-testid={`earnings-line-${key}`}
            >
              <dt>{t(`insights.earnings.${key}`)}</dt>
              <dd className="tabular-nums">{signed(amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-2 font-extrabold">
            <dt>{t('insights.earnings.total')}</dt>
            <dd className="tabular-nums" data-testid="earnings-line-total">
              {signed(e.total)}
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel title={t('insights.earnings.byMonth')} description={t('insights.last12Months')}>
        <BarChart
          points={e.byMonth.map((m) => ({ month: m.month, value: m.amount }))}
          format={money}
          locale={locale}
          label={t('insights.earnings.byMonth')}
          testId="earnings-chart"
        />
      </Panel>
      <Panel title={t('insights.earnings.byCourse')}>
        <DataTable
          testId="earnings-courses-table"
          caption={t('insights.earnings.byCourse')}
          rows={e.courses}
          rowId={(c) => c.courseId}
          emptyText={t('insights.earnings.noCourses')}
          display={[
            {
              id: 'course',
              header: t('insights.col.course'),
              cell: (c) => (
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{pick(c.titleBn, c.titleEn, locale)}</span>
                  <span className="text-xs text-ink-muted">
                    {t(`catalog.instructor.status.${c.status as 'draft'}`)}
                  </span>
                </span>
              ),
            },
            {
              id: 'sales',
              header: t('insights.col.sales'),
              isNumeric: true,
              cell: (c) => formatInteger(c.sales),
            },
            {
              id: 'gross',
              header: t('insights.col.gross'),
              isNumeric: true,
              cell: (c) => money(c.gross),
            },
            {
              id: 'earned',
              header: t('insights.col.yourShare'),
              isNumeric: true,
              cell: (c) => <span className="font-semibold text-primary">{money(c.earned)}</span>,
            },
            {
              id: 'stats',
              header: <span className="sr-only">{t('insights.col.actions')}</span>,
              isNumeric: true,
              cell: (c) => (
                <Link
                  to="/instructor/courses/$courseId/stats"
                  params={{ courseId: c.courseId }}
                  className="inline-flex min-h-11 items-center rounded-sm border border-primary/30 px-3 font-semibold text-primary hover:bg-primary/10"
                  data-testid="earnings-course-stats"
                >
                  {t('insights.viewStats')}
                </Link>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
