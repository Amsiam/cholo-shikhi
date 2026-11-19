import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { AttemptSheet } from '#src/features/assessment/index.ts';
import {
  saveMyExamAnswer,
  startMyExam,
  submitMyExam,
} from '#src/features/learning/server/learning.functions.ts';
import { ExamSheet } from '#src/features/learning/ui/ExamSheet.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// Sitting an exam. Loading starts the attempt or resumes the open one, so links here never preload.
export const Route = createFileRoute('/exams/$examId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) =>
    (await startMyExam({ data: { examId: params.examId } })) as Outcome<AttemptSheet>,
  staleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
  component: ExamPage,
});

function ExamPage() {
  const { t, tDynamic } = useI18n();
  const r = Route.useLoaderData();
  const navigate = useNavigate();
  if (!r.ok)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-10">
        <p role="alert" className="text-lg" data-testid="exam-start-error">
          {tDynamic(r.error.i18nKey)}
        </p>
        <Link to="/exams" className="tap-target font-semibold text-primary hover:underline">
          {t('exams.result.back')}
        </Link>
      </div>
    );
  const sheet = r.value;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <ExamSheet
          sheet={sheet}
          onSave={async (questionId, chosenIndex) =>
            (await saveMyExamAnswer({
              data: { attemptId: sheet.attemptId, questionId, chosenIndex },
            })) as Outcome<unknown>
          }
          onSubmit={async () => {
            await submitMyExam({ data: { attemptId: sheet.attemptId } });
            await navigate({
              to: '/exams/result/$attemptId',
              params: { attemptId: sheet.attemptId },
              replace: true,
            });
          }}
        />
      </div>
    </div>
  );
}
