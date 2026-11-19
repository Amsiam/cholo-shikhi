// One course's statistics for its instructors and Admins: money, sales and enrolments over time,
// learning progress and lesson drop-off, quiz performance, the hardest questions and a searchable,
// paged student list.
import { useForm } from '@tanstack/react-form';
import {
  Activity,
  CircleCheck,
  GraduationCap,
  Search,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { CourseInsights } from '../server/insights.types.ts';
import { BarChart, formatPercent, Meter, Panel, StatTile } from './insights-parts.tsx';

const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

function SearchStudents(props: { initial: string; onSearch: (q: string) => void }) {
  const { t } = useI18n();
  const form = useForm({
    defaultValues: { q: props.initial },
    onSubmit: ({ value }) => props.onSearch(value.q.trim()),
  });
  return (
    <form
      className="flex w-full max-w-sm items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="q">
        {(field) => (
          <label className="relative flex-1">
            <span className="sr-only">{t('insights.students.search')}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('insights.students.search')}
              maxLength={100}
              className="h-10 w-full rounded-sm border border-primary/25 bg-background pr-3 pl-9 text-sm focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              data-testid="course-stats-search"
            />
          </label>
        )}
      </form.Field>
      <Button type="submit" variant="outline">
        {t('insights.students.searchButton')}
      </Button>
    </form>
  );
}

function Tabs(props: {
  tabs: ReadonlyArray<{ id: string; label: string; content: ReactNode }>;
  initial: string;
}) {
  const [active, setActive] = useState(props.initial);
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t('insights.stats.sections')}
        className="flex flex-wrap gap-1 border-b border-primary/15"
      >
        {props.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`stats-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`stats-panel-${tab.id}`}
            onClick={() => setActive(tab.id)}
            className={`-mb-px min-h-11 border-b-2 px-4 font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset ${active === tab.id ? 'border-primary text-primary' : 'border-transparent text-ink/70 hover:text-primary'}`}
            data-testid={`course-stats-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`stats-panel-${tab.id}`}
          aria-labelledby={`stats-tab-${tab.id}`}
          hidden={active !== tab.id}
          className="flex flex-col gap-5"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

export function CourseStatsView(props: {
  stats: CourseInsights;
  /** The route renders the back link and the builder link. */
  header?: ReactNode;
  onSearch: (q: string) => void;
  onPage: (page: number) => void;
}) {
  const { t, locale, formatMoney, formatInteger, formatDate } = useI18n();
  const s = props.stats;
  const money = (v: number) => formatMoney(v as MoneyPoisha);
  const pct = (bps: number) => formatPercent(bps, locale);
  const thisMonth = s.finance.byMonth[s.finance.byMonth.length - 1];

  const overview = (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={t('insights.stats.revenueByMonth')} description={t('insights.last12Months')}>
        <BarChart
          points={s.finance.byMonth.map((m) => ({ month: m.month, value: m.amount }))}
          format={money}
          locale={locale}
          label={t('insights.stats.revenueByMonth')}
          testId="course-stats-revenue-chart"
        />
      </Panel>
      <Panel title={t('insights.stats.enrolmentsByMonth')} description={t('insights.last12Months')}>
        <BarChart
          points={s.enrolmentsByMonth.map((m) => ({ month: m.month, value: m.count }))}
          format={formatInteger}
          locale={locale}
          label={t('insights.stats.enrolmentsByMonth')}
          testId="course-stats-enrolment-chart"
        />
      </Panel>
      <Panel title={t('insights.stats.books')} description={t('insights.stats.booksHint')}>
        <dl className="grid gap-px overflow-hidden border border-primary/15 bg-primary/15">
          {[
            [t('insights.books.gross'), s.finance.gross, 'text-ink'],
            [t('insights.books.instructors'), s.finance.instructors, 'text-primary'],
            [t('insights.books.platform'), s.finance.platform, 'text-ink/70'],
            [t('insights.books.unassigned'), s.finance.unassigned, 'text-omr'],
          ].map(([label, value, tone]) => (
            <div
              key={label as string}
              className="flex items-center justify-between gap-3 bg-background px-4 py-3"
            >
              <dt className="text-sm text-ink/70">{label}</dt>
              <dd className={`font-bold tabular-nums ${tone}`}>{money(value as number)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );

  const learning = (
    <Panel title={t('insights.stats.lessons')} description={t('insights.stats.lessonsHint')}>
      <DataTable
        testId="course-stats-lessons"
        caption={t('insights.stats.lessons')}
        rows={s.lessons}
        rowId={(l) => l.lessonId}
        emptyText={t('insights.stats.noLessons')}
        display={[
          {
            id: 'n',
            header: '#',
            cell: (l) => formatInteger(s.lessons.indexOf(l) + 1),
          },
          {
            id: 'lesson',
            header: t('insights.col.lesson'),
            cell: (l) => (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{pick(l.titleBn, l.titleEn, locale)}</span>
                <span className="text-xs text-ink-muted">
                  {pick(l.sectionTitleBn, l.sectionTitleEn, locale)} ·{' '}
                  {t(`catalog.instructor.lessons.kind.${l.kind}`)}
                </span>
              </span>
            ),
          },
          {
            id: 'done',
            header: t('insights.col.completed'),
            isNumeric: true,
            cell: (l) => formatInteger(l.completions),
          },
          {
            id: 'rate',
            header: t('insights.col.reach'),
            cell: (l) => (
              <span className="flex items-center gap-3">
                <Meter bps={l.completionBps} label={pct(l.completionBps)} />
                <span className="w-14 shrink-0 text-right text-sm tabular-nums">
                  {pct(l.completionBps)}
                </span>
              </span>
            ),
          },
        ]}
      />
    </Panel>
  );

  const quizzes = (
    <>
      <Panel title={t('insights.stats.quizzes')}>
        <DataTable
          testId="course-stats-quizzes"
          caption={t('insights.stats.quizzes')}
          rows={s.quizzes}
          rowId={(q) => q.lessonId}
          emptyText={t('insights.stats.noQuizzes')}
          display={[
            {
              id: 'quiz',
              header: t('insights.col.quiz'),
              cell: (q) => (
                <span className="font-semibold">{pick(q.titleBn, q.titleEn, locale)}</span>
              ),
            },
            {
              id: 'students',
              header: t('insights.col.students'),
              isNumeric: true,
              cell: (q) => formatInteger(q.students),
            },
            {
              id: 'attempts',
              header: t('insights.col.attempts'),
              isNumeric: true,
              cell: (q) => formatInteger(q.attempts),
            },
            {
              id: 'avg',
              header: t('insights.col.averageScore'),
              cell: (q) => (
                <span className="flex items-center gap-3">
                  <Meter
                    bps={q.averageBps}
                    tone={q.averageBps < 5000 ? 'omr' : 'pass'}
                    label={pct(q.averageBps)}
                  />
                  <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {pct(q.averageBps)}
                  </span>
                </span>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t('insights.stats.hardest')} description={t('insights.stats.hardestHint')}>
        {s.hardestQuestions.length === 0 ? (
          <p className="text-ink-muted" data-testid="course-stats-hardest-empty">
            {t('insights.stats.noAnswers')}
          </p>
        ) : (
          <ol
            className="flex flex-col divide-y divide-primary/10"
            data-testid="course-stats-hardest"
          >
            {s.hardestQuestions.map((q, i) => (
              <li key={q.questionId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-omr-soft text-sm font-bold text-omr"
                >
                  {formatInteger(i + 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium break-words">
                    {pick(q.promptBn, q.promptEn, locale)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {pick(q.lessonTitleBn, q.lessonTitleEn, locale)}
                  </span>
                </span>
                <span className="flex flex-col items-end text-right">
                  <span className="font-bold text-omr tabular-nums">{pct(q.wrongBps)}</span>
                  <span className="text-xs text-ink-muted">
                    {t('insights.stats.wrongOf', {
                      wrong: formatInteger(q.wrong),
                      answers: formatInteger(q.answers),
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );

  const students = (
    <Panel
      title={t('insights.stats.students')}
      description={t('insights.students.count', { count: formatInteger(s.students.total) })}
      action={<SearchStudents initial={s.students.query} onSearch={props.onSearch} />}
    >
      <DataTable
        testId="course-stats-students"
        caption={t('insights.stats.students')}
        rows={s.students.rows}
        rowId={(r) => r.userId}
        emptyText={t(s.students.query ? 'insights.students.noMatch' : 'insights.students.none')}
        display={[
          {
            id: 'name',
            header: t('insights.col.student'),
            cell: (r) => (
              <span className="font-semibold">{r.name || t('insights.students.unnamed')}</span>
            ),
          },
          {
            id: 'enrolled',
            header: t('insights.col.enrolled'),
            cell: (r) => formatDate(r.enrolledAt),
          },
          {
            id: 'status',
            header: t('insights.col.status'),
            cell: (r) => (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === 'active' ? 'bg-pass/15 text-pass' : 'bg-ink/10 text-ink-muted'}`}
              >
                {t(`insights.status.${r.status}`)}
              </span>
            ),
          },
          {
            id: 'progress',
            header: t('insights.col.progress'),
            cell: (r) => (
              <span className="flex items-center gap-3">
                <Meter
                  bps={r.progressBps}
                  tone={r.progressBps === 10_000 ? 'pass' : 'primary'}
                  label={pct(r.progressBps)}
                />
                <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {t('insights.students.lessonsDone', {
                    done: formatInteger(r.completed),
                    total: formatInteger(s.lessons.length),
                  })}
                </span>
              </span>
            ),
          },
          {
            id: 'last',
            header: t('insights.col.lastActive'),
            cell: (r) =>
              r.lastActiveAt ? formatDate(r.lastActiveAt) : t('insights.students.never'),
          },
        ]}
      />
      {s.students.pageCount > 1 ? (
        <nav
          aria-label={t('insights.students.pages')}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span className="text-ink-muted">
            {t('insights.students.pageOf', {
              page: formatInteger(s.students.page),
              pages: formatInteger(s.students.pageCount),
            })}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={s.students.page <= 1}
              onClick={() => props.onPage(s.students.page - 1)}
              data-testid="course-stats-prev"
            >
              {t('insights.students.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={s.students.page >= s.students.pageCount}
              onClick={() => props.onPage(s.students.page + 1)}
              data-testid="course-stats-next"
            >
              {t('insights.students.next')}
            </Button>
          </span>
        </nav>
      ) : null}
    </Panel>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="course-stats-page">
      <header className="flex flex-col gap-3">
        {props.header}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance break-words sm:text-4xl">
            {pick(s.course.titleBn, s.course.titleEn, locale)}
          </h1>
          <p className="text-ink/75">{t('insights.stats.subtitle')}</p>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          icon={TrendingUp}
          label={t('insights.stats.gross')}
          value={money(s.finance.gross)}
          hint={t('insights.stats.thisMonth', { amount: money(thisMonth?.amount ?? 0) })}
          testId="course-stats-gross"
        />
        <StatTile
          icon={Wallet}
          tone="pass"
          label={t('insights.stats.yourEarnings')}
          value={money(s.finance.myEarnings)}
          testId="course-stats-my-earnings"
        />
        <StatTile
          icon={Users}
          tone="ink"
          label={t('insights.stats.students')}
          value={formatInteger(s.summary.students)}
          hint={t('insights.stats.activeHint', {
            active: formatInteger(s.summary.active),
            recent: formatInteger(s.summary.recentlyActive),
          })}
          testId="course-stats-students-tile"
        />
        <StatTile
          icon={Activity}
          label={t('insights.stats.averageProgress')}
          value={pct(s.summary.averageProgressBps)}
          testId="course-stats-progress"
        />
        <StatTile
          icon={s.summary.completionRateBps > 0 ? CircleCheck : GraduationCap}
          tone="omr"
          label={t('insights.stats.completionRate')}
          value={pct(s.summary.completionRateBps)}
          testId="course-stats-completion"
        />
      </div>
      <Tabs
        // A search or a later page of students opens straight on the student list.
        initial={s.students.query !== '' || s.students.page > 1 ? 'students' : 'overview'}
        tabs={[
          { id: 'overview', label: t('insights.tabs.overview'), content: overview },
          { id: 'learning', label: t('insights.tabs.learning'), content: learning },
          { id: 'quizzes', label: t('insights.tabs.quizzes'), content: quizzes },
          { id: 'students', label: t('insights.tabs.students'), content: students },
        ]}
      />
    </div>
  );
}
