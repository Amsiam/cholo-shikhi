import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import {
  getQuestionTaxonomy,
  listBankQuestions,
  reviewBankQuestionAction,
  saveBankQuestionDraft,
} from '#src/features/assessment/server/bank.functions.ts';
import type {
  BankQuestionView,
  TaxonomySubject,
} from '#src/features/assessment/server/bank.server.ts';
import { type BankPage, QuestionBankView } from '#src/features/assessment/ui/QuestionBankView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

const BankSearch = z.object({
  topicId: z.string().uuid().optional().catch(undefined),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().catch(undefined),
  status: z
    .enum(['draft', 'in_review', 'published', 'rejected', 'retired'])
    .optional()
    .catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  page: z.number().int().min(1).max(10_000).optional().catch(undefined),
});

// The question bank (U4): Instructors write and submit; Admins review and manage everything.
export const Route = createFileRoute('/bank')({
  validateSearch: BankSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [page, taxonomy] = await Promise.all([
      listBankQuestions({ data: { ...deps, page: deps.page ?? 1 } }),
      getQuestionTaxonomy({ data: {} }),
    ]);
    return page.ok && taxonomy.ok
      ? {
          denied: false as const,
          page: page.value as BankPage,
          taxonomy: taxonomy.value as TaxonomySubject[],
        }
      : { denied: true as const };
  },
  component: BankRoute,
});

function BankRoute() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/bank' });
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" data-testid="bank-denied" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <QuestionBankView
          page={data.page}
          taxonomy={data.taxonomy}
          filters={{ ...search, page: search.page ?? 1 }}
          onFilter={(next) =>
            void navigate({ search: { ...next, page: next.page > 1 ? next.page : undefined } })
          }
          onSave={async (draft) =>
            (await saveBankQuestionDraft({ data: draft })) as Outcome<BankQuestionView>
          }
          onReview={async (input) =>
            (await reviewBankQuestionAction({ data: input })) as Outcome<BankQuestionView>
          }
          onChanged={() => void router.invalidate()}
        />
      </div>
    </div>
  );
}
