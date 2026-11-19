import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  exploreQuestionBank,
  getMyPracticeTopics,
} from '#src/features/learning/server/learning.functions.ts';
import type { PracticeCatalog } from '#src/features/learning/server/practice.server.ts';
import { type ExplorePage, QuestionExplorer } from '#src/features/learning/ui/QuestionExplorer.tsx';

const ExploreSearch = z.object({
  topicId: z.string().uuid().optional().catch(undefined),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  page: z.number().int().min(1).max(10_000).optional().catch(undefined),
});

// Study mode: questions with answers, explanations and where they appeared before.
export const Route = createFileRoute('/questions')({
  validateSearch: ExploreSearch,
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [catalog, page] = await Promise.all([
      getMyPracticeTopics({ data: {} }),
      deps.topicId
        ? exploreQuestionBank({
            data: {
              topicId: deps.topicId,
              ...(deps.difficulty ? { difficulty: deps.difficulty } : {}),
              ...(deps.q ? { q: deps.q } : {}),
              page: deps.page ?? 1,
            },
          })
        : null,
    ]);
    if (!catalog.ok) return null;
    return {
      catalog: catalog.value as PracticeCatalog,
      page: page?.ok ? (page.value as ExplorePage) : null,
    };
  },
  component: QuestionsPage,
});

function QuestionsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/questions' });
  if (!data) return null;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <QuestionExplorer
          catalog={data.catalog}
          page={data.page}
          filters={{ ...search, page: search.page ?? 1 }}
          onFilter={(next) =>
            void navigate({ search: { ...next, page: next.page > 1 ? next.page : undefined } })
          }
        />
      </div>
    </div>
  );
}
