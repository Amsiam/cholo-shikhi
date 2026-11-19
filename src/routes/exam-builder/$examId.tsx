import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { getQuestionTaxonomy } from '#src/features/assessment/server/bank.functions.ts';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import {
  attachExamToMyCourse,
  drawExamQuestionSet,
  getExamForStaff,
  publishExamForStudents,
  retireExamForStudents,
  saveExamDraft,
} from '#src/features/assessment/server/exam.functions.ts';
import type { StaffExamDetail } from '#src/features/assessment/server/exam.server.ts';
import { ExamEditor, type GoalGroup } from '#src/features/assessment/ui/ExamBuilder.tsx';
import { listPublicGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Staff: one exam ("new" for a fresh one).
export const Route = createFileRoute('/exam-builder/$examId')({
  loader: async ({ params }) => {
    const [taxonomy, goals, detail] = await Promise.all([
      getQuestionTaxonomy({ data: {} }),
      listPublicGoals({ data: {} }),
      params.examId === 'new' ? null : getExamForStaff({ data: { examId: params.examId } }),
    ]);
    if (!taxonomy.ok || (detail && !detail.ok)) return { denied: true as const };
    return {
      denied: false as const,
      taxonomy: taxonomy.value as TaxonomySubject[],
      goals: goals.ok ? (goals.value as { segments: GoalGroup[] }).segments : [],
      detail: detail?.ok ? (detail.value as StaffExamDetail) : null,
    };
  },
  component: ExamEditorPage,
});

function ExamEditorPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('catalog.instructor.denied')}
      </p>
    );
  const ref = (id: string, expectedVersion: number) => ({ data: { examId: id, expectedVersion } });
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <ExamEditor
          key={examId}
          detail={data.detail}
          taxonomy={data.taxonomy}
          goals={data.goals}
          onSave={async (input) =>
            (await saveExamDraft({ data: input })) as Outcome<StaffExamDetail>
          }
          onDraw={async (id, v) =>
            (await drawExamQuestionSet(ref(id, v))) as Outcome<StaffExamDetail>
          }
          onPublish={async (id, v) =>
            (await publishExamForStudents(ref(id, v))) as Outcome<StaffExamDetail>
          }
          onRetire={async (id, v) =>
            (await retireExamForStudents(ref(id, v))) as Outcome<StaffExamDetail>
          }
          onAttach={async (id, v, courseId) =>
            (await attachExamToMyCourse({
              data: { examId: id, expectedVersion: v, courseId },
            })) as Outcome<StaffExamDetail>
          }
          onCreated={(id) =>
            void navigate({ to: '/exam-builder/$examId', params: { examId: id }, replace: true })
          }
        />
      </div>
    </div>
  );
}
