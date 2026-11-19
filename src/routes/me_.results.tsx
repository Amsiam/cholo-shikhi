import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { ExamHistoryItem } from '#src/features/assessment/index.ts';
import { getMyResults } from '#src/features/learning/server/learning.functions.ts';
import type { QuizHistoryItem } from '#src/features/learning/server/learning.server.ts';
import { ResultsView } from '#src/features/learning/ui/ResultsView.tsx';

// The Student's results: lesson quizzes and exams.
export const Route = createFileRoute('/me_/results')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const r = await getMyResults({ data: {} });
    return r.ok
      ? (r.value as { quizzes: QuizHistoryItem[]; exams: ExamHistoryItem[] })
      : { quizzes: [], exams: [] };
  },
  component: ResultsPage,
});

function ResultsPage() {
  const data = Route.useLoaderData();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <ResultsView quizzes={data.quizzes} exams={data.exams} />
      </div>
    </div>
  );
}
