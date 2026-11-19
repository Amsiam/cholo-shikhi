// The question bank for staff: filters (subject, topic, difficulty, status, search), the questions
// table with set and measured difficulty, and the editor. Instructors see their own questions and the
// published ones; Admins see everything and work the review queue.
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { BankStatus, Difficulty, ReviewAction } from '../domain/bank.ts';
import type { BankQuestionView, TaxonomySubject } from '../server/bank.server.ts';
import { MeasuredDifficulty, StatusBadge } from './bank-parts.tsx';
import { type QuestionDraft, QuestionEditor, TopicSelect } from './QuestionEditor.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

export type BankFilters = {
  topicId?: string;
  difficulty?: Difficulty;
  status?: BankStatus;
  q?: string;
  page: number;
};

export type BankPage = {
  rows: BankQuestionView[];
  total: number;
  page: number;
  pageCount: number;
  isAdmin: boolean;
};

const STATUSES: readonly BankStatus[] = ['draft', 'in_review', 'published', 'rejected', 'retired'];

export function QuestionBankView(props: {
  page: BankPage;
  filters: BankFilters;
  taxonomy: TaxonomySubject[];
  onFilter: (next: BankFilters) => void;
  onSave: (draft: QuestionDraft) => Promise<Outcome<BankQuestionView>>;
  onReview: (input: {
    questionId: string;
    expectedVersion: number;
    action: ReviewAction;
    note?: string;
  }) => Promise<Outcome<BankQuestionView>>;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<BankQuestionView | 'new' | null>(null);
  const [search, setSearch] = useState(props.filters.q ?? '');
  const f = props.filters;
  const topicName = new Map(
    props.taxonomy.flatMap((s) =>
      s.topics.flatMap((tp) => [
        [tp.topicId, locale === 'bn' ? tp.nameBn : tp.nameEn] as const,
        ...tp.subtopics.map(
          (x) =>
            [
              x.topicId,
              `${locale === 'bn' ? tp.nameBn : tp.nameEn} › ${locale === 'bn' ? x.nameBn : x.nameEn}`,
            ] as const,
        ),
      ]),
    ),
  );
  const set = (patch: Partial<BankFilters>) => props.onFilter({ ...f, ...patch, page: 1 });
  const hasTopics = props.taxonomy.some((s) => s.topics.length > 0);

  if (editing)
    return (
      <QuestionEditor
        key={editing === 'new' ? 'new' : editing.questionId}
        question={editing === 'new' ? null : editing}
        taxonomy={props.taxonomy}
        isAdmin={props.page.isAdmin}
        onSave={props.onSave}
        onReview={props.onReview}
        onClose={(changed) => {
          setEditing(null);
          if (changed) props.onChanged();
        }}
      />
    );

  return (
    <div className="flex flex-col gap-6" data-testid="bank-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('bank.title')}</h1>
          <p className="text-ink/75">
            {t(props.page.isAdmin ? 'bank.subtitle.admin' : 'bank.subtitle.instructor')}
          </p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={!hasTopics} data-testid="bank-new">
          <Plus aria-hidden="true" className="size-4" />
          {t('bank.new')}
        </Button>
      </header>
      {!hasTopics ? (
        <p className="border border-primary/15 bg-background p-4 text-sm text-ink/80">
          {t(props.page.isAdmin ? 'bank.noTopics.admin' : 'bank.noTopics.instructor')}
        </p>
      ) : null}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t('bank.filter.status')}</legend>
        {[undefined, ...STATUSES].map((s) => (
          <Button
            key={s ?? 'all'}
            size="sm"
            variant={f.status === s ? 'default' : 'outline'}
            aria-pressed={f.status === s}
            onClick={() => set({ status: s })}
            data-testid={`bank-status-${s ?? 'all'}`}
          >
            {s ? t(`bank.status.${s}`) : t('bank.filter.all')}
          </Button>
        ))}
      </fieldset>

      <form
        className="grid gap-3 border border-primary/15 bg-background p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_2fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() || undefined });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="bank-filter-topic">{t('bank.field.topic')}</Label>
          <TopicSelect
            id="bank-filter-topic"
            taxonomy={props.taxonomy}
            value={f.topicId ?? ''}
            onChange={(v) => set({ topicId: v || undefined })}
            emptyLabel={t('bank.filter.allTopics')}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bank-filter-difficulty">{t('bank.filter.measured')}</Label>
          <NativeSelect
            id="bank-filter-difficulty"
            value={f.difficulty ?? ''}
            onChange={(e) => set({ difficulty: (e.target.value || undefined) as Difficulty })}
          >
            <option value="">{t('practice.anyDifficulty')}</option>
            <option value="easy">{t('bank.difficulty.easy')}</option>
            <option value="medium">{t('bank.difficulty.medium')}</option>
            <option value="hard">{t('bank.difficulty.hard')}</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bank-filter-q">{t('bank.filter.search')}</Label>
          <Input
            id="bank-filter-q"
            type="search"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" className="self-end">
          <Search aria-hidden="true" className="size-4" />
          {t('bank.filter.apply')}
        </Button>
      </form>

      <DataTable
        testId="bank-table"
        caption={t('bank.title')}
        rows={props.page.rows}
        rowId={(q) => q.questionId}
        emptyText={t('bank.empty')}
        paging={{
          page: props.page.page,
          pages: props.page.pageCount,
          onPage: (page) => props.onFilter({ ...f, page }),
        }}
        display={[
          {
            id: 'question',
            header: t('bank.col.question'),
            cell: (q) => (
              <button
                type="button"
                onClick={() => setEditing(q)}
                className="tap-target flex max-w-md flex-col items-start gap-1 text-left"
                data-testid="bank-row-open"
              >
                <span className="line-clamp-2 font-semibold text-primary hover:underline">
                  {locale === 'bn' ? q.promptBn : q.promptEn}
                </span>
                <span className="text-xs text-ink-muted">
                  {[topicName.get(q.topicId), q.sourceNote].filter(Boolean).join(' · ')}
                </span>
              </button>
            ),
          },
          {
            id: 'difficulty',
            header: t('bank.col.difficulty'),
            cell: (q) => <MeasuredDifficulty q={q} />,
          },
          {
            id: 'status',
            header: t('insights.col.status'),
            cell: (q) => <StatusBadge status={q.status} />,
          },
          {
            id: 'author',
            header: t('bank.col.author'),
            cell: (q) => <span className="text-sm">{q.authorName || '—'}</span>,
          },
        ]}
      />
    </div>
  );
}
