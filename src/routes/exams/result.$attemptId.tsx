import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { ExamResult } from '#src/features/assessment/index.ts';
import { getMyExamResult } from '#src/features/learning/server/learning.functions.ts';
import { ExamResultView } from '#src/features/learning/ui/ExamResultView.tsx';

// One attempt's result (the Student's own).
export const Route = createFileRoute('/exams/result/$attemptId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const r = await getMyExamResult({ data: { attemptId: params.attemptId } });
    // A missing attempt, or another Student's, answers not-found rather than a blank page.
    if (!r.ok) throw notFound();
    return r.value as ExamResult;
  },
  component: ResultPage,
});

function ResultPage() {
  const result = Route.useLoaderData();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <ExamResultView result={result} />
      </div>
    </div>
  );
}
