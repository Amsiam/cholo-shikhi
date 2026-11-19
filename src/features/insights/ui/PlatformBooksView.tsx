// The Admin's books: totals per ledger account, sales by month, revenue per course and per
// instructor, the whole ledger by entry type (sales, refunds, reassignments, salaries, pay-policy
// adjustments, payouts and referral money, each its own line, reconciled to the account balances),
// and the journal (every entry with its balanced debit and credit lines).

import { Banknote, Building2, HandCoins, Hourglass } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { PlatformFinance } from '../server/insights.types.ts';
import { BarChart, formatPercent, Panel, StatTile } from './insights-parts.tsx';

const TOP = 10;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

export function PlatformBooksView(props: {
  books: PlatformFinance;
  onPage: (page: number) => void;
}) {
  const { t, locale, formatMoney, formatInteger, formatDateTime } = useI18n();
  const b = props.books;
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [showAllInstructors, setShowAllInstructors] = useState(false);
  const hasMoreCourses = b.byCourse.length > TOP;
  const hasMoreInstructors = b.byInstructor.length > TOP;
  const money = (v: number) => formatMoney(v as MoneyPoisha);
  const signed = (v: number) => (v < 0 ? `(${money(-v)})` : money(v));
  return (
    <div className="flex flex-col gap-6" data-testid="platform-books-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('insights.books.title')}
        </h1>
        <p className="text-ink/70">{t('insights.books.subtitle')}</p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Banknote}
          label={t('insights.books.gross')}
          value={money(b.totals.gross)}
          hint={t('insights.books.salesCount', { count: formatInteger(b.salesCount) })}
          testId="books-gross"
        />
        <StatTile
          icon={Building2}
          tone="pass"
          label={t('insights.books.platform')}
          value={money(b.totals.platform)}
          hint={formatPercent(
            b.totals.gross === 0 ? 0 : Math.floor((b.totals.platform * 10_000) / b.totals.gross),
            locale,
          )}
          testId="books-platform"
        />
        <StatTile
          icon={HandCoins}
          tone="ink"
          label={t('insights.books.instructors')}
          value={money(b.totals.instructors)}
          hint={t('insights.books.payableHint')}
          testId="books-instructors"
        />
        <StatTile
          icon={Hourglass}
          tone="omr"
          label={t('insights.books.unassigned')}
          value={money(b.totals.unassigned)}
          hint={t('insights.books.unassignedHint')}
          testId="books-unassigned"
        />
      </div>
      <p className="-mt-3 text-xs text-ink-muted">{t('insights.books.salesSplitHint')}</p>
      <Panel title={t('insights.books.ledger')} description={t('insights.books.ledgerHint')}>
        <DataTable
          testId="books-ledger"
          caption={t('insights.books.ledger')}
          rows={b.ledger.entries}
          rowId={(e) => e.kind}
          emptyText={t('insights.books.noSales')}
          display={[
            {
              id: 'kind',
              header: t('insights.col.entryType'),
              cell: (e) => (
                <span className="font-semibold" data-testid={`books-ledger-${e.kind}`}>
                  {t(`insights.kind.${e.kind}`)}
                </span>
              ),
            },
            {
              id: 'entries',
              header: t('insights.col.entries'),
              isNumeric: true,
              cell: (e) => formatInteger(e.transactions),
            },
            {
              id: 'effect',
              header: t('insights.col.effect'),
              cell: (e) => (
                <span className="flex flex-col gap-0.5 text-xs">
                  {e.accounts.map((a) => (
                    <span key={a.account} className="flex justify-between gap-4">
                      <span>{t(`insights.account.${a.account}`)}</span>
                      <span className="tabular-nums">{signed(a.amount)}</span>
                    </span>
                  ))}
                </span>
              ),
            },
          ]}
        />
        <DataTable
          testId="books-balances"
          caption={t('insights.books.balances')}
          rows={b.ledger.balances}
          rowId={(a) => a.account}
          emptyText={t('insights.books.noSales')}
          display={[
            {
              id: 'account',
              header: t('insights.col.account'),
              cell: (a) => (
                <span className="font-semibold">{t(`insights.account.${a.account}`)}</span>
              ),
            },
            {
              id: 'balance',
              header: t('insights.col.balance'),
              isNumeric: true,
              cell: (a) => <span className="tabular-nums">{signed(a.amount)}</span>,
            },
          ]}
        />
        <p
          role={b.ledger.isReconciled ? undefined : 'alert'}
          className={`text-sm ${b.ledger.isReconciled ? 'text-pass' : 'font-semibold text-omr'}`}
          data-testid="books-reconciled"
        >
          {b.ledger.isReconciled
            ? t('insights.books.reconciled')
            : t('insights.books.notReconciled', { amount: signed(b.ledger.imbalance) })}
        </p>
      </Panel>
      <Panel title={t('insights.books.byMonth')} description={t('insights.last12Months')}>
        <BarChart
          points={b.byMonth.map((m) => ({ month: m.month, value: m.amount }))}
          format={money}
          locale={locale}
          label={t('insights.books.byMonth')}
          testId="books-chart"
        />
      </Panel>
      <div className="grid gap-5">
        <Panel
          title={t('insights.books.byCourse')}
          action={
            hasMoreCourses ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAllCourses((v) => !v)}
                data-testid="books-courses-toggle"
              >
                {t(showAllCourses ? 'insights.books.showTop' : 'insights.books.showAll', {
                  count: formatInteger(showAllCourses ? TOP : b.byCourse.length),
                })}
              </Button>
            ) : undefined
          }
        >
          <DataTable
            testId="books-courses"
            caption={t('insights.books.byCourse')}
            rows={showAllCourses ? b.byCourse : b.byCourse.slice(0, TOP)}
            rowId={(c) => c.courseId}
            emptyText={t('insights.books.noSales')}
            display={[
              {
                id: 'course',
                header: t('insights.col.course'),
                cell: (c) => (
                  <span className="font-semibold">{pick(c.titleBn, c.titleEn, locale)}</span>
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
                id: 'platform',
                header: t('insights.col.platformShare'),
                isNumeric: true,
                cell: (c) => money(c.platform),
              },
            ]}
          />
        </Panel>
        <Panel
          title={t('insights.books.byInstructor')}
          action={
            hasMoreInstructors ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAllInstructors((v) => !v)}
                data-testid="books-instructors-toggle"
              >
                {t(showAllInstructors ? 'insights.books.showTop' : 'insights.books.showAll', {
                  count: formatInteger(showAllInstructors ? TOP : b.byInstructor.length),
                })}
              </Button>
            ) : undefined
          }
        >
          <DataTable
            testId="books-instructors-table"
            caption={t('insights.books.byInstructor')}
            rows={showAllInstructors ? b.byInstructor : b.byInstructor.slice(0, TOP)}
            rowId={(i) => i.instructorId}
            emptyText={t('insights.books.noSales')}
            display={[
              {
                id: 'name',
                header: t('insights.col.instructor'),
                cell: (i) => (
                  <span className="font-semibold">{i.name || t('insights.students.unnamed')}</span>
                ),
              },
              {
                id: 'sales',
                header: t('insights.col.sales'),
                isNumeric: true,
                cell: (i) => formatInteger(i.sales),
              },
              {
                id: 'earned',
                header: t('insights.col.payable'),
                isNumeric: true,
                cell: (i) => <span className="font-semibold text-primary">{money(i.earned)}</span>,
              },
            ]}
          />
        </Panel>
      </div>
      <Panel title={t('insights.books.journal')} description={t('insights.books.journalHint')}>
        <DataTable
          testId="books-journal"
          caption={t('insights.books.journal')}
          rows={b.journal.rows}
          rowId={(r) => r.transactionId}
          emptyText={t('insights.books.noSales')}
          display={[
            {
              id: 'when',
              header: t('insights.col.date'),
              cell: (r) => (
                <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span>
              ),
            },
            {
              id: 'sale',
              header: t('insights.col.sale'),
              cell: (r) => (
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">
                    {r.kind === 'platform_sale'
                      ? t('insights.books.platformSale')
                      : r.courseId
                        ? pick(r.titleBn, r.titleEn, locale)
                        : t(`insights.kind.${r.kind}`)}
                    {r.kind === 'course_refund' ? (
                      <span className="ml-2 rounded-full bg-omr-soft px-2 py-0.5 text-xs text-omr">
                        {t('insights.books.refund')}
                      </span>
                    ) : null}
                    {r.kind === 'attribution_reassignment' ? (
                      <span className="ml-2 rounded-full bg-omr-soft px-2 py-0.5 text-xs text-omr">
                        {t('insights.books.reassignment')}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-col gap-0.5 text-xs text-ink/70">
                    {r.postings.map((p) => (
                      <span
                        key={`${p.account}-${p.instructorId ?? ''}`}
                        className="flex justify-between gap-4"
                      >
                        <span>
                          {t(`insights.account.${p.account}`)}
                          {p.instructorName ? ` · ${p.instructorName}` : ''}
                        </span>
                        <span
                          className={`tabular-nums ${p.amount < 0 ? 'text-ink/70' : 'font-semibold'}`}
                        >
                          {p.amount > 0 ? t('insights.books.dr') : t('insights.books.cr')}{' '}
                          {signed(Math.abs(p.amount))}
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
              ),
            },
            {
              id: 'amount',
              header: t('insights.col.amount'),
              isNumeric: true,
              cell: (r) =>
                r.kind === 'course_refund' ||
                r.kind === 'referral_clawback' ||
                r.kind === 'instructor_payout' ||
                r.kind === 'referral_payout' ? (
                  <span className="text-omr">−{money(r.amount)}</span>
                ) : (
                  money(r.amount)
                ),
            },
          ]}
        />
        {b.journal.pageCount > 1 ? (
          <nav
            aria-label={t('insights.students.pages')}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="text-ink-muted">
              {t('insights.students.pageOf', {
                page: formatInteger(b.journal.page),
                pages: formatInteger(b.journal.pageCount),
              })}
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={b.journal.page <= 1}
                onClick={() => props.onPage(b.journal.page - 1)}
                data-testid="books-prev"
              >
                {t('insights.students.previous')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={b.journal.page >= b.journal.pageCount}
                onClick={() => props.onPage(b.journal.page + 1)}
                data-testid="books-next"
              >
                {t('insights.students.next')}
              </Button>
            </span>
          </nav>
        ) : null}
      </Panel>
    </div>
  );
}
