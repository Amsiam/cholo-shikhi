// Study mode: browse a topic's questions with the right answer and its explanation, and see where
// each one appeared before (earlier exams here, and its source such as "BCS 41"). Answers start
// hidden so a Student can test themselves; one switch shows them all.
import { Link } from '@tanstack/react-router';
import { Eye, EyeOff, History, Library, Search } from 'lucide-react';
import { useState } from 'react';
import type { ExploredQuestion } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { PracticeCatalog } from '../server/practice.server.ts';

const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

export type ExploreFilters = {
  topicId?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  q?: string;
  page: number;
};
export type ExplorePage = {
  rows: ExploredQuestion[];
  total: number;
  page: number;
  pageCount: number;
};

function QuestionCard(props: { q: ExploredQuestion; n: number; showAll: boolean }) {
  const { t, locale, formatInteger, formatDate } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const q = props.q;
  const show = props.showAll || isOpen;
  const letters = LETTERS[locale];
  const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
  const explanation = locale === 'bn' ? q.explanationBn : q.explanationEn;
  return (
    <li
      className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      data-testid="explore-question"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-bold break-words">
          <span className="tabular-nums text-ink-muted">{formatInteger(props.n)}. </span>
          {pick(q.promptBn, q.promptEn, locale)}
        </p>
        <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-semibold">
          {t(`bank.difficulty.${q.difficulty}`)}
        </span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {options.map((o, i) => {
          const isRight = show && i === q.correctIndex;
          return (
            <li
              key={letters[i]}
              className={`flex items-center gap-2 px-2 py-1.5 text-sm ${isRight ? 'bg-pass/10 font-semibold' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  isRight ? 'border-pass bg-pass text-white' : 'border-omr text-omr'
                }`}
              >
                {letters[i]}
              </span>
              <span>{o}</span>
              {isRight ? <span className="sr-only">{t('exams.review.rightAnswer')}</span> : null}
            </li>
          );
        })}
      </ul>
      {show && explanation ? (
        <p className="border-l-2 border-pass pl-3 text-sm text-ink/80">{explanation}</p>
      ) : null}
      {q.sourceNote || q.appearances.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <History aria-hidden="true" className="size-4 text-ink-muted" />
          <span className="text-ink-muted">{t('explore.appeared')}</span>
          {q.sourceNote ? (
            <span className="rounded-sm border border-ink/20 px-2 py-0.5 font-semibold">
              {q.sourceNote}
            </span>
          ) : null}
          {q.appearances.map((a) => (
            <span key={a.examId} className="rounded-sm bg-primary/10 px-2 py-0.5 text-primary">
              {pick(a.titleBn, a.titleEn, locale)}
              {a.at ? ` · ${formatDate(a.at)}` : ''}
            </span>
          ))}
        </div>
      ) : null}
      {props.showAll ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setIsOpen((x) => !x)}
          aria-expanded={isOpen}
          data-testid="explore-toggle"
        >
          {isOpen ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
          {t(isOpen ? 'explore.hideAnswer' : 'explore.showAnswer')}
        </Button>
      )}
    </li>
  );
}

export function QuestionExplorer(props: {
  catalog: PracticeCatalog;
  filters: ExploreFilters;
  page: ExplorePage | null;
  onFilter: (next: ExploreFilters) => void;
}) {
  const { t, locale, formatInteger } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState(props.filters.q ?? '');
  const f = props.filters;
  const set = (patch: Partial<ExploreFilters>) => props.onFilter({ ...f, ...patch, page: 1 });
  const topics = props.catalog.subjects.flatMap((s) =>
    s.topics.flatMap((tp) => [
      { ...tp, subjectId: s.subjectId, isSub: false },
      ...tp.subtopics.map((x) => ({ ...x, subtopics: [], subjectId: s.subjectId, isSub: true })),
    ]),
  );
  const current = topics.find((x) => x.topicId === f.topicId);
  const first = ((props.page?.page ?? 1) - 1) * 15;

  return (
    <div className="flex flex-col gap-6" data-testid="explore-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Library aria-hidden="true" className="size-8 text-primary" />
          {t('explore.title')}
        </h1>
        <p className="text-ink/75">{t('explore.subtitle')}</p>
      </header>

      <form
        className="grid gap-3 border border-primary/15 bg-background p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_2fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() || undefined });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="explore-topic">{t('bank.field.topic')}</Label>
          <NativeSelect
            id="explore-topic"
            value={f.topicId ?? ''}
            onChange={(e) => set({ topicId: e.target.value || undefined })}
            data-testid="explore-topic"
          >
            <option value="">{t('bank.field.topicPick')}</option>
            {props.catalog.subjects.map((s) => (
              <optgroup key={s.subjectId} label={pick(s.nameBn, s.nameEn, locale)}>
                {s.topics.flatMap((tp) => [
                  <option key={tp.topicId} value={tp.topicId}>
                    {`${pick(tp.nameBn, tp.nameEn, locale)} (${formatInteger(tp.questionCount)})`}
                  </option>,
                  ...tp.subtopics.map((x) => (
                    <option key={x.topicId} value={x.topicId}>
                      {`${pick(tp.nameBn, tp.nameEn, locale)} › ${pick(x.nameBn, x.nameEn, locale)} (${formatInteger(x.questionCount)})`}
                    </option>
                  )),
                ])}
              </optgroup>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="explore-difficulty">{t('practice.difficulty')}</Label>
          <NativeSelect
            id="explore-difficulty"
            value={f.difficulty ?? ''}
            onChange={(e) =>
              set({ difficulty: (e.target.value || undefined) as ExploreFilters['difficulty'] })
            }
          >
            <option value="">{t('practice.anyDifficulty')}</option>
            <option value="easy">{t('bank.difficulty.easy')}</option>
            <option value="medium">{t('bank.difficulty.medium')}</option>
            <option value="hard">{t('bank.difficulty.hard')}</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="explore-q">{t('explore.search')}</Label>
          <Input
            id="explore-q"
            type="search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" className="self-end" disabled={!f.topicId}>
          <Search aria-hidden="true" className="size-4" />
          {t('bank.filter.apply')}
        </Button>
      </form>

      {!props.page ? (
        <p className="border border-dashed border-primary/25 bg-background p-6 text-ink/80">
          {t('explore.pickTopic')}
        </p>
      ) : (
        <section aria-labelledby="explore-results" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="explore-results" className="text-xl font-bold">
              {current ? pick(current.nameBn, current.nameEn, locale) : ''}
              <span className="ml-2 text-base font-normal text-ink-muted">
                {t('practice.questionCount', { n: formatInteger(props.page.total) })}
              </span>
            </h2>
            <Button
              variant={showAll ? 'default' : 'outline'}
              onClick={() => setShowAll((x) => !x)}
              aria-pressed={showAll}
              data-testid="explore-show-all"
            >
              {showAll ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
              {t(showAll ? 'explore.hideAll' : 'explore.showAll')}
            </Button>
          </div>
          {props.page.rows.length === 0 ? (
            <p className="text-ink-muted">{t('bank.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {props.page.rows.map((q, i) => (
                <QuestionCard key={q.questionId} q={q} n={first + i + 1} showAll={showAll} />
              ))}
            </ol>
          )}
          {props.page.pageCount > 1 ? (
            <nav
              aria-label={t('explore.pages')}
              className="flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={props.page.page <= 1}
                onClick={() => props.onFilter({ ...f, page: (props.page?.page ?? 2) - 1 })}
              >
                {t('exams.sheet.prev')}
              </Button>
              <span className="text-sm tabular-nums">
                {t('explore.pageOf', {
                  n: formatInteger(props.page.page),
                  total: formatInteger(props.page.pageCount),
                })}
              </span>
              <Button
                variant="outline"
                disabled={props.page.page >= props.page.pageCount}
                onClick={() => props.onFilter({ ...f, page: (props.page?.page ?? 0) + 1 })}
              >
                {t('exams.sheet.next')}
              </Button>
            </nav>
          ) : null}
          <p className="text-sm">
            <Link to="/practice" className="tap-target font-semibold text-primary hover:underline">
              {t('explore.toPractice')}
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
