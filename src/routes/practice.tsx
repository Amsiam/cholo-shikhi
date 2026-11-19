import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { StudentQuestion } from '#src/features/assessment/index.ts';
import {
  answerMyPracticeQuestion,
  getMyPracticeTopics,
  startMyPractice,
} from '#src/features/learning/server/learning.functions.ts';
import type {
  PracticeAnswerResult,
  PracticeCatalog,
} from '#src/features/learning/server/practice.server.ts';
import { PracticeView } from '#src/features/learning/ui/PracticeView.tsx';

type Result<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// Topic-wise practice from the question bank, for the Student's current Goal.
export const Route = createFileRoute('/practice')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const result = await getMyPracticeTopics({ data: {} });
    return result.ok ? (result.value as PracticeCatalog) : null;
  },
  component: PracticePage,
});

function PracticePage() {
  const catalog = Route.useLoaderData();
  if (!catalog) return null;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <PracticeView
          catalog={catalog}
          onStart={async (input) =>
            (await startMyPractice({ data: input })) as Result<{ questions: StudentQuestion[] }>
          }
          onAnswer={async (questionId, chosenIndex) =>
            (await answerMyPracticeQuestion({
              data: { questionId, chosenIndex },
            })) as Result<PracticeAnswerResult>
          }
        />
      </div>
    </div>
  );
}
