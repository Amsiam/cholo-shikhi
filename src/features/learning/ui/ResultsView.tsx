// The Student's results in one place: every lesson quiz and every exam, newest first, each linking
// back to the lesson (to try again) or to the full exam result.
import { Link } from '@tanstack/react-router';
import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import type { ExamHistoryItem } from '#src/features/assessment/index.ts';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import type { QuizHistoryItem } from '../server/learning.server.ts';

const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

function ScoreBar(props: { value: number; max: number; label: string }) {
  const pct = props.max > 0 ? Math.max(0, Math.round((props.value / props.max) * 100)) : 0;
  const tone = pct >= 80 ? 'bg-pass' : pct >= 50 ? 'bg-primary' : 'bg-omr';
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums font-semibold">{props.label}</span>
      <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/10">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function ResultsView(props: { quizzes: QuizHistoryItem[]; exams: ExamHistoryItem[] }) {
  const { t, locale, formatInteger, formatDateTime, formatMarks } = useI18n();
  const [tab, setTab] = useState<'quizzes' | 'exams'>('quizzes');
  return (
    <div className="flex flex-col gap-6" data-testid="results-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <ClipboardCheck aria-hidden="true" className="size-8 text-primary" />
          {t('results.title')}
        </h1>
        <p className="text-ink/75">{t('results.subtitle')}</p>
      </header>
      <div className="flex gap-2" role="tablist" aria-label={t('results.title')}>
        {(['quizzes', 'exams'] as const).map((k) => (
          <Button
            key={k}
            role="tab"
            aria-selected={tab === k}
            variant={tab === k ? 'default' : 'outline'}
            onClick={() => setTab(k)}
            data-testid={`results-tab-${k}`}
          >
            {t(`results.tab.${k}`, {
              n: formatInteger(k === 'quizzes' ? props.quizzes.length : props.exams.length),
            })}
          </Button>
        ))}
      </div>
      {tab === 'quizzes' ? (
        <DataTable
          testId="results-quizzes"
          caption={t('results.tab.quizzes', { n: formatInteger(props.quizzes.length) })}
          rows={props.quizzes}
          rowId={(r) => r.attemptId}
          emptyText={t('results.empty.quizzes')}
          display={[
            {
              id: 'when',
              header: t('insights.col.date'),
              cell: (r) => (
                <span className="whitespace-nowrap">{formatDateTime(r.submittedAt)}</span>
              ),
            },
            {
              id: 'lesson',
              header: t('results.col.lesson'),
              cell: (r) => (
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {pick(r.lessonTitleBn, r.lessonTitleEn, locale)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {pick(r.courseTitleBn, r.courseTitleEn, locale)}
                  </span>
                </span>
              ),
            },
            {
              id: 'score',
              header: t('exams.result.score'),
              cell: (r) => (
                <ScoreBar
                  value={r.score}
                  max={r.total}
                  label={t('results.outOf', {
                    n: formatInteger(r.score),
                    total: formatInteger(r.total),
                  })}
                />
              ),
            },
            {
              id: 'open',
              header: <span className="sr-only">{t('results.col.open')}</span>,
              isNumeric: true,
              cell: (r) => (
                <Link
                  to="/learn/$courseId/lessons/$lessonId"
                  params={{ courseId: r.courseId, lessonId: r.lessonId }}
                  className="tap-target font-semibold text-primary hover:underline"
                >
                  {t('results.tryAgain')}
                </Link>
              ),
            },
          ]}
        />
      ) : (
        <DataTable
          testId="results-exams"
          caption={t('results.tab.exams', { n: formatInteger(props.exams.length) })}
          rows={props.exams}
          rowId={(r) => r.attemptId}
          emptyText={t('results.empty.exams')}
          display={[
            {
              id: 'when',
              header: t('insights.col.date'),
              cell: (r) => (
                <span className="whitespace-nowrap">{formatDateTime(r.submittedAt)}</span>
              ),
            },
            {
              id: 'exam',
              header: t('examBuilder.col.exam'),
              cell: (r) => (
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{pick(r.titleBn, r.titleEn, locale)}</span>
                  <span className="text-xs text-ink-muted">{t(`results.kind.${r.kind}`)}</span>
                </span>
              ),
            },
            {
              id: 'score',
              header: t('exams.result.score'),
              cell: (r) =>
                r.scoreX100 === null || r.maxX100 === null ? (
                  <span className="text-sm text-ink-muted">{t('results.pending')}</span>
                ) : (
                  <ScoreBar
                    value={r.scoreX100}
                    max={r.maxX100}
                    label={t('results.outOf', {
                      n: formatMarks(r.scoreX100),
                      total: formatMarks(r.maxX100),
                    })}
                  />
                ),
            },
            {
              id: 'open',
              header: <span className="sr-only">{t('results.col.open')}</span>,
              isNumeric: true,
              cell: (r) => (
                <Link
                  to="/exams/result/$attemptId"
                  params={{ attemptId: r.attemptId }}
                  className="tap-target font-semibold text-primary hover:underline"
                >
                  {t('exams.viewResult')}
                </Link>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
