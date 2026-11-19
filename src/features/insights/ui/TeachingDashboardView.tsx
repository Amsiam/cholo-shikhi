// I3 Teaching dashboard (US7.17): students, completion, NPS and returning students across the
// instructor's own courses, then the same per course as a data table with a completion bar. NPS
// below 5 answers reads "not enough responses"; with no enrolments the page says so.
import { Link } from '@tanstack/react-router';
import { BarChart3, GraduationCap, Repeat, Smile, Users } from 'lucide-react';
import type { NpsSummary } from '#src/features/learning/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { TeachingDashboard } from '../server/insights.types.ts';
import { formatPercent, Panel, StatTile } from './insights-parts.tsx';

const NPS_MIN = 5;

export function TeachingDashboardView(props: { data: TeachingDashboard }) {
  const { t, locale, formatInteger } = useI18n();
  const { totals, courses } = props.data;
  const pct = (bps: number | null) => (bps === null ? '—' : formatPercent(bps, locale));
  const npsText = (n: NpsSummary) =>
    n.nps === null
      ? t('teaching.nps.notEnough', { n: formatInteger(n.responses), min: formatInteger(NPS_MIN) })
      : formatInteger(n.nps);
  const title = (c: { titleBn: string; titleEn: string }) =>
    (locale === 'bn' ? c.titleBn : c.titleEn) || c.titleBn || c.titleEn;
  const hasStudents = totals.students > 0;

  return (
    <div className="flex flex-col gap-6" data-testid="teaching-dashboard">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('teaching.title')}
        </h1>
        <p className="text-ink/75">{t('teaching.subtitle')}</p>
      </header>

      {!hasStudents ? (
        <p
          className="border border-dashed border-primary/25 bg-background p-6 text-ink-muted"
          data-testid="teaching-empty"
        >
          {t('teaching.empty')}{' '}
          <Link
            to="/instructor/courses"
            className="tap-target font-semibold text-primary hover:underline"
          >
            {t('teaching.toCourses')}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          testId="teaching-students"
          icon={Users}
          label={t('teaching.stat.students')}
          value={formatInteger(totals.students)}
          hint={t('teaching.stat.courses', { n: formatInteger(totals.courses) })}
        />
        <StatTile
          testId="teaching-completion"
          icon={GraduationCap}
          tone="pass"
          label={t('teaching.stat.completion')}
          value={pct(totals.completionBps)}
        />
        <StatTile
          testId="teaching-nps"
          icon={Smile}
          label={t('teaching.stat.nps')}
          value={totals.nps.nps === null ? '—' : formatInteger(totals.nps.nps)}
          hint={
            totals.nps.nps === null
              ? npsText(totals.nps)
              : t('teaching.nps.responses', { n: formatInteger(totals.nps.responses) })
          }
        />
        <StatTile
          testId="teaching-repeat"
          icon={Repeat}
          tone="ink"
          label={t('teaching.stat.repeat')}
          value={pct(totals.repeatBps)}
          hint={t('teaching.stat.repeatHint', { n: formatInteger(totals.repeatStudents) })}
        />
      </div>

      <Panel
        title={t('teaching.courses.title')}
        description={t('teaching.courses.body')}
        testId="teaching-courses"
      >
        {courses.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('teaching.courses.none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{t('teaching.courses.title')}</caption>
              <thead className="border-b border-primary/15 text-ink/70">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t('teaching.col.course')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t('teaching.col.students')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('teaching.col.completion')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('teaching.col.nps')}
                  </th>
                  <th scope="col" className="py-2 pl-3">
                    <span className="sr-only">{t('teaching.col.stats')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/10">
                {courses.map((c) => (
                  <tr key={c.courseId} data-testid="teaching-course-row">
                    <th scope="row" className="py-3 pr-3 font-semibold break-words">
                      {title(c)}
                      <span className="block text-xs font-normal text-ink-muted">
                        {t(`teaching.status.${c.status === 'published' ? 'published' : 'other'}`)}
                      </span>
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatInteger(c.students)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2 w-20 overflow-hidden rounded-full bg-primary/10"
                        >
                          <span
                            className="block h-full bg-pass"
                            style={{ width: `${(c.completionBps ?? 0) / 100}%` }}
                          />
                        </span>
                        <span className="tabular-nums">
                          {pct(c.completionBps)}
                          <span className="block text-xs text-ink-muted">
                            {t('teaching.col.completedOf', {
                              done: formatInteger(c.completed),
                              total: formatInteger(c.students),
                            })}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{npsText(c.nps)}</td>
                    <td className="py-3 pl-3 text-right">
                      <Link
                        to="/instructor/courses/$courseId/stats"
                        params={{ courseId: c.courseId }}
                        className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        <BarChart3 aria-hidden="true" className="size-4" />
                        {t('teaching.col.stats')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
