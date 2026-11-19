// The catalog course finder. Step 1 asks which exam the visitor is preparing for; step 2 lists every
// published course for that exam, searchable by title and split into numbered pages. The exam, the
// search text and the page live in the page address, so a result page can be shared and reloaded.
import { useForm } from '@tanstack/react-form';
import { Link, useNavigate } from '@tanstack/react-router';
import { Search, X } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { CourseSearchQuery } from '../server/catalog-browse.schema.ts';
import type { CourseCard, CourseSearchPage } from '../server/catalog-browse.types.ts';
import { localTitle } from './fields.tsx';

export const finderContainer = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

export type GoalGroup = {
  segmentId: string;
  nameBn: string;
  nameEn: string;
  goals: ReadonlyArray<{ goalId: string; nameBn: string; nameEn: string }>;
};

// ------------------------------------------------------------------------------------ step 1

/** Step 1: "Which exam are you preparing for?" Each exam opens its course list. */
export function ExamPicker(props: { groups: readonly GoalGroup[]; currentGoalId?: string | null }) {
  const { t, locale } = useI18n();
  const name = (x: { nameBn: string; nameEn: string }) => (locale === 'bn' ? x.nameBn : x.nameEn);
  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink"
      data-testid="catalog-exam-picker"
    >
      <div className={`${finderContainer} flex flex-col gap-10 py-12 sm:py-16`}>
        <header className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl">
            {t('catalog.finder.pick.title')}
          </h1>
          <p className="text-lg text-ink/75">{t('catalog.finder.pick.body')}</p>
        </header>
        {props.groups.length === 0 ? (
          <p role="status" className="text-lg" data-testid="catalog-no-goals">
            {t('catalog.public.noGoals')}
          </p>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            {props.groups.map((group) => (
              <section
                key={group.segmentId}
                aria-labelledby={`segment-${group.segmentId}`}
                className="flex flex-col gap-3"
              >
                <h2
                  id={`segment-${group.segmentId}`}
                  className="text-sm font-semibold tracking-wide text-ink-muted uppercase"
                >
                  {name(group)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.goals.map((goal) => {
                    const isCurrent = goal.goalId === props.currentGoalId;
                    return (
                      <li key={goal.goalId}>
                        <Link
                          to="/catalog"
                          search={{ goal: goal.goalId }}
                          className="group flex min-h-16 items-center gap-4 rounded-sm border-2 border-primary/20 bg-background px-5 py-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          data-testid="catalog-exam-option"
                        >
                          <span
                            aria-hidden="true"
                            className={`size-6 shrink-0 rounded-full border-2 border-primary transition-colors group-hover:bg-primary ${isCurrent ? 'bg-primary' : ''}`}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-lg font-semibold break-words">{name(goal)}</span>
                            {isCurrent ? (
                              <span className="text-sm text-primary">
                                {t('catalog.finder.pick.current')}
                              </span>
                            ) : null}
                          </span>
                          <span aria-hidden="true" className="text-xl text-primary">
                            →
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------ step 2

/** Step 2: the exam's courses, with a title search and numbered pages. */
export function CourseResults(props: { result: CourseSearchPage }) {
  const { t, locale, formatInteger } = useI18n();
  const { result } = props;
  const goalName = locale === 'bn' ? result.goal.nameBn : result.goal.nameEn;
  const count = formatInteger(result.total);
  return (
    <section className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink" data-testid="catalog-page">
      <header className="border-b border-primary/20 bg-background">
        <div className={`${finderContainer} flex flex-col gap-6 py-8 sm:py-10`}>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold tracking-wide text-primary uppercase">
                {t('catalog.browse.title')}
              </p>
              <h1
                className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
                data-testid="catalog-goal"
              >
                {goalName}
              </h1>
            </div>
            <Link
              to="/catalog"
              search={{ choose: true }}
              className="min-h-11 content-center font-medium text-primary underline underline-offset-4"
              data-testid="catalog-change-exam"
            >
              {t('catalog.finder.change')}
            </Link>
          </div>
          <SearchBox goalId={result.goal.goalId} query={result.query ?? ''} />
        </div>
      </header>

      <div className={`${finderContainer} flex flex-col gap-6 py-8`}>
        <p role="status" className="text-ink/70" data-testid="catalog-result-count">
          {result.query
            ? t('catalog.finder.countFor', { count, q: result.query })
            : t('catalog.finder.count', { count })}
        </p>

        {result.items.length === 0 ? (
          <div
            className="flex flex-col items-start gap-3 border border-dashed border-primary/40 bg-background p-8"
            data-testid="catalog-empty"
          >
            <p className="text-lg">
              {result.query
                ? t('catalog.finder.emptySearch', { q: result.query })
                : t('catalog.finder.empty')}
            </p>
            {result.query ? (
              <Link
                to="/catalog"
                search={{ goal: result.goal.goalId }}
                className="font-medium text-primary underline underline-offset-4"
                data-testid="catalog-empty-clear"
              >
                {t('catalog.finder.search.clear')}
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-list">
            {result.items.map((card) => (
              <CourseResultCard key={card.courseId} card={card} />
            ))}
          </ul>
        )}

        {result.pageCount > 1 ? <Pagination result={result} /> : null}
      </div>
    </section>
  );
}

function SearchBox(props: { goalId: string; query: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const form = useForm({
    defaultValues: { q: props.query },
    onSubmit: async ({ value }) => {
      const parsed = CourseSearchQuery.safeParse(value.q);
      const q = parsed.success && parsed.data ? parsed.data : undefined;
      await navigate({ to: '/catalog', search: { goal: props.goalId, q } });
    },
  });
  return (
    <form
      aria-label={t('catalog.finder.search.label')}
      className="flex w-full max-w-2xl gap-2"
      data-testid="catalog-search"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="q">
        {(field) => (
          <div className="relative min-w-0 flex-1">
            <label htmlFor="catalog-search-input" className="sr-only">
              {t('catalog.finder.search.label')}
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted"
            />
            <input
              id="catalog-search-input"
              type="search"
              maxLength={100}
              autoComplete="off"
              placeholder={t('catalog.finder.search.placeholder')}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              className="h-12 w-full rounded-sm border-2 border-primary/30 bg-background pr-11 pl-11 text-base outline-none placeholder:text-ink-muted focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
              data-testid="catalog-search-input"
            />
            {field.state.value ? (
              <Link
                to="/catalog"
                search={{ goal: props.goalId }}
                onClick={() => field.handleChange('')}
                aria-label={t('catalog.finder.search.clear')}
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                data-testid="catalog-search-clear"
              >
                <X aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </div>
        )}
      </form.Field>
      <Button size="lg" type="submit" data-testid="catalog-search-submit">
        {t('catalog.finder.search.submit')}
      </Button>
    </form>
  );
}

export function CourseResultCard({ card }: { card: CourseCard }) {
  const { t, locale, formatInteger } = useI18n();
  return (
    <li data-testid="catalog-card" className="group flex">
      <Link
        to="/courses/$courseId"
        params={{ courseId: card.courseId }}
        className="flex w-full flex-col gap-3 rounded-sm border border-primary/25 bg-background p-5 transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        data-testid="catalog-card-link"
      >
        {card.isPinned ? (
          <span className="w-fit rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {t('catalog.browse.pinned')}
          </span>
        ) : null}
        <span
          className="text-lg leading-snug font-semibold break-words"
          data-testid="catalog-card-title"
        >
          {localTitle(card, locale)}
        </span>
        <span className="text-sm text-ink-muted">
          {t('catalog.browse.duration', { months: formatInteger(card.accessDurationMonths) })}
        </span>
        <span className="mt-auto flex items-end justify-between gap-2 border-t border-primary/15 pt-3">
          <span className="text-xl font-bold tabular-nums" data-testid="catalog-card-price">
            {formatMoney(card.listPricePoisha as MoneyPoisha, locale)}
          </span>
          <span className="text-sm font-semibold text-primary">
            {t('catalog.browse.viewCourse')}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Page numbers around the current page, with the first and last always shown. */
export function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  for (const n of pages) {
    const prev = out.at(-1);
    if (typeof prev === 'number' && n - prev > 1) out.push('gap');
    out.push(n);
  }
  return out;
}

function Pagination({ result }: { result: CourseSearchPage }) {
  const { t, formatInteger } = useI18n();
  const q = result.query ?? undefined;
  const to = (page: number) => ({
    goal: result.goal.goalId,
    q,
    page: page === 1 ? undefined : page,
  });
  const step =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-primary/25 bg-background px-3 font-medium tabular-nums hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return (
    <nav aria-label={t('catalog.finder.pagination.label')} data-testid="catalog-pagination">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>
          {result.page > 1 ? (
            <Link
              to="/catalog"
              search={to(result.page - 1)}
              className={step}
              data-testid="catalog-page-prev"
            >
              {t('catalog.finder.pagination.prev')}
            </Link>
          ) : null}
        </li>
        {pageWindow(result.page, result.pageCount).map((n, index) =>
          n === 'gap' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity beyond its position
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-muted">
              …
            </li>
          ) : (
            <li key={n}>
              <Link
                to="/catalog"
                search={to(n)}
                aria-current={n === result.page ? 'page' : undefined}
                aria-label={t('catalog.finder.pagination.page', { n: formatInteger(n) })}
                className={`${step} ${n === result.page ? 'border-primary bg-primary text-primary-foreground' : ''}`}
                data-testid="catalog-page-number"
              >
                {formatInteger(n)}
              </Link>
            </li>
          ),
        )}
        <li>
          {result.page < result.pageCount ? (
            <Link
              to="/catalog"
              search={to(result.page + 1)}
              className={step}
              data-testid="catalog-page-next"
            >
              {t('catalog.finder.pagination.next')}
            </Link>
          ) : null}
        </li>
      </ul>
    </nav>
  );
}
