import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { StudentExamCard } from '#src/features/assessment/index.ts';
import {
  createMyPracticeExam,
  getMyExams,
  getMyPracticeTopics,
} from '#src/features/learning/server/learning.functions.ts';
import type { PracticeCatalog } from '#src/features/learning/server/practice.server.ts';
import { ExamsView } from '#src/features/learning/ui/ExamsView.tsx';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// Exams: live exams, mock tests and the Student's own practice exams.
export const Route = createFileRoute('/exams/')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [exams, catalog] = await Promise.all([
      getMyExams({ data: {} }),
      getMyPracticeTopics({ data: {} }),
    ]);
    if (!exams.ok || !catalog.ok) return null;
    const value = exams.value as { goalId: string | null; exams: StudentExamCard[] };
    return { ...value, catalog: catalog.value as PracticeCatalog };
  },
  component: ExamsPage,
});

function ExamsPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  if (!data) return null;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <ExamsView
          exams={data.exams}
          hasGoal={data.goalId !== null}
          catalog={data.catalog}
          onCreateCustom={async (input) => {
            const r = (await createMyPracticeExam({ data: input })) as Outcome<{ examId: string }>;
            if (r.ok) await navigate({ to: '/exams/$examId', params: { examId: r.value.examId } });
            return r;
          }}
        />
      </div>
    </div>
  );
}
