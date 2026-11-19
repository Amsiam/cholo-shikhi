// An exam result: the marks, the merit list for a live exam, and every question with the Student's
// answer and the right one. A live exam's result waits until its window ends.
import { Link } from '@tanstack/react-router';
import { Hourglass, Medal } from 'lucide-react';
import type { ExamResult } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

export function ExamResultView(props: { result: ExamResult }) {
  const { t, locale, formatInteger, formatMarks, formatDateTime } = useI18n();
  const r = props.result;
  const letters = LETTERS[locale];
  const back = (
    <Link to="/exams" className="tap-target font-medium text-primary hover:underline">
      {t('exams.result.back')}
    </Link>
  );

  if (!r.isReleased || !r.marking)
    return (
      <div className="flex flex-col gap-5" data-testid="exam-result-pending">
        {back}
        <section className="flex flex-col items-start gap-3 border border-primary/15 bg-background p-6">
          <Hourglass aria-hidden="true" className="size-7 text-primary" />
          <h1 className="text-2xl font-extrabold">{pick(r.titleBn, r.titleEn, locale)}</h1>
          <p>{t('exams.result.submitted')}</p>
          {r.releasesAt ? (
            <p className="text-ink/80">
              {t('exams.result.releasesAt', { at: formatDateTime(r.releasesAt) })}
            </p>
          ) : null}
        </section>
      </div>
    );

  const m = r.marking;
  const percent = m.maxX100 > 0 ? Math.max(0, Math.round((m.scoreX100 / m.maxX100) * 100)) : 0;
  const lost = m.correct * 100 - m.scoreX100;

  return (
    <div className="flex flex-col gap-6" data-testid="exam-result">
      {back}
      <section
        aria-labelledby="result-title"
        className="flex flex-col gap-5 border-2 border-ink bg-background p-5 sm:p-7"
      >
        <header className="flex flex-col gap-1 border-b border-ink/20 pb-4">
          <h1 id="result-title" className="text-2xl font-extrabold sm:text-3xl">
            {pick(r.titleBn, r.titleEn, locale)}
          </h1>
          {r.submittedAt ? (
            <p className="text-sm text-ink-muted">
              {t('exams.result.submittedAt', { at: formatDateTime(r.submittedAt) })}
            </p>
          ) : null}
        </header>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <p className="flex flex-col">
            <span className="text-sm text-ink-muted">{t('exams.result.score')}</span>
            <span
              className="text-5xl font-extrabold tabular-nums text-omr"
              data-testid="exam-score"
            >
              {formatMarks(m.scoreX100)}
              <span className="text-2xl text-ink-muted">
                {' / '}
                {formatMarks(m.maxX100)}
              </span>
            </span>
          </p>
          <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-muted">{t('exams.result.correct')}</dt>
            <dt className="text-ink-muted">{t('exams.result.wrong')}</dt>
            <dt className="text-ink-muted">{t('exams.result.skipped')}</dt>
            <dd className="text-xl font-bold text-pass tabular-nums">{formatInteger(m.correct)}</dd>
            <dd className="text-xl font-bold text-omr tabular-nums">{formatInteger(m.wrong)}</dd>
            <dd className="text-xl font-bold tabular-nums">{formatInteger(m.skipped)}</dd>
          </dl>
        </div>
        <div className="flex flex-col gap-1">
          <span aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-omr-soft">
            <span className="block h-full rounded-full bg-pass" style={{ width: `${percent}%` }} />
          </span>
          <p className="text-sm text-ink/80">
            {t('exams.result.percent', { percent: formatInteger(percent) })}
            {lost > 0 ? ` · ${t('exams.result.negativeLost', { marks: formatMarks(lost) })}` : ''}
          </p>
        </div>
        {m.wrong > 0 ? (
          <p className="text-sm">
            {t('exams.result.toVault', { n: formatInteger(m.wrong) })}{' '}
            <Link to="/vault" className="tap-target font-semibold text-primary hover:underline">
              {t('practice.done.toVault')}
            </Link>
          </p>
        ) : null}
      </section>

      {r.merit ? (
        <section
          aria-labelledby="merit-title"
          className="flex flex-col gap-3"
          data-testid="exam-merit"
        >
          <h2 id="merit-title" className="flex items-center gap-2 text-xl font-bold">
            <Medal aria-hidden="true" className="size-5 text-primary" />
            {t('exams.merit.title')}
          </h2>
          {r.merit.myRank ? (
            <p className="font-semibold">
              {t('exams.merit.mine', {
                rank: formatInteger(r.merit.myRank),
                total: formatInteger(r.merit.total),
              })}
            </p>
          ) : null}
          <ol className="divide-y divide-primary/10 border border-primary/15 bg-background">
            {r.merit.top.map((x) => (
              <li
                key={`${x.rank}-${x.name}-${x.scoreX100}`}
                className={`flex items-center gap-4 px-4 py-3 ${x.isMe ? 'bg-primary/10 font-semibold' : ''}`}
              >
                <span className="w-8 text-right font-bold tabular-nums">
                  {formatInteger(x.rank)}
                </span>
                <span className="flex-1">{x.isMe ? t('exams.merit.you') : x.name}</span>
                <span className="tabular-nums">{formatMarks(x.scoreX100)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="review-title" className="flex flex-col gap-3">
        <h2 id="review-title" className="text-xl font-bold">
          {t('exams.review.title')}
        </h2>
        <ol className="flex flex-col gap-3">
          {r.review.map((q, n) => {
            const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
            const explanation = locale === 'bn' ? q.explanationBn : q.explanationEn;
            const verdict =
              q.chosenIndex === null
                ? 'skipped'
                : q.chosenIndex === q.correctIndex
                  ? 'right'
                  : 'wrong';
            return (
              <li
                key={q.questionId}
                className={`flex flex-col gap-3 border bg-background p-4 ${verdict === 'wrong' ? 'border-omr/50' : 'border-primary/15'}`}
                data-testid="exam-review-item"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">
                    {formatInteger(n + 1)}. {pick(q.promptBn, q.promptEn, locale)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      verdict === 'right'
                        ? 'bg-pass/15 text-pass'
                        : verdict === 'wrong'
                          ? 'bg-omr-soft text-omr'
                          : 'bg-ink/10 text-ink'
                    }`}
                  >
                    {t(`exams.review.${verdict}`)}
                  </span>
                </p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {options.map((o, i) => {
                    const isRight = i === q.correctIndex;
                    const isMine = i === q.chosenIndex;
                    return (
                      <li
                        key={letters[i]}
                        className={`flex items-center gap-2 px-2 py-1 text-sm ${isRight ? 'bg-pass/10 font-semibold' : isMine ? 'bg-omr-soft' : ''}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                            isRight
                              ? 'border-pass bg-pass text-white'
                              : isMine
                                ? 'border-omr bg-omr text-white'
                                : 'border-omr/50 text-omr'
                          }`}
                        >
                          {letters[i]}
                        </span>
                        <span>{o}</span>
                        {isMine ? (
                          <span className="sr-only">{t('exams.review.yourAnswer')}</span>
                        ) : null}
                        {isRight ? (
                          <span className="sr-only">{t('exams.review.rightAnswer')}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {explanation ? <p className="text-sm text-ink/80">{explanation}</p> : null}
              </li>
            );
          })}
        </ol>
      </section>
      <Button asChild variant="outline" className="w-fit">
        <Link to="/exams">{t('exams.result.back')}</Link>
      </Button>
    </div>
  );
}
