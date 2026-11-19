import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  deleteSegment,
  listGoalsAdmin,
  listSegments,
  retireGoal,
  saveGoal,
  saveSegment,
} from '#src/features/goals/server/goals.functions.ts';
import type {
  GoalRetireInput,
  GoalSaveInput,
  SegmentDeleteInput,
  SegmentSaveInput,
} from '#src/features/goals/server/goals.schema.ts';
import {
  type GoalAdminRow,
  GoalsAdmin,
  type SegmentAdminRow,
} from '#src/features/goals/ui/GoalsAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

const PAGE_SIZE = 20;
type Outcome =
  | { ok: true }
  | {
      ok: false;
      error: { code: string; i18nKey: string; fieldErrors?: Record<string, readonly string[]> };
    };
const toOutcome = (result: Outcome) => (result.ok ? null : result.error);

// A4 Goals and segments (Admin with two-step only, BR1.1). A non-nested route at /admin/goals, so
// the U1 Admin console stays a leaf. Paging is server-side through validated search params.
export const Route = createFileRoute('/admin_/goals')({
  validateSearch: z.object({
    segmentsPage: z.coerce.number().int().min(1).default(1),
    goalsPage: z.coerce.number().int().min(1).default(1),
  }),
  loaderDeps: ({ search }) => ({ segmentsPage: search.segmentsPage, goalsPage: search.goalsPage }),
  loader: async ({ deps }) => {
    const [segments, goals] = await Promise.all([
      listSegments({ data: { page: deps.segmentsPage, pageSize: PAGE_SIZE } }),
      listGoalsAdmin({ data: { page: deps.goalsPage, pageSize: PAGE_SIZE } }),
    ]);
    if (!segments.ok || !goals.ok) return { denied: true as const };
    return {
      denied: false as const,
      segments: segments.value as { rows: SegmentAdminRow[]; total: number; page: number },
      goals: goals.value as { rows: GoalAdminRow[]; total: number; page: number },
    };
  },
  component: GoalsAdminPage,
});

function GoalsAdminPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate({ from: '/admin/goals' });
  if (data.denied) {
    return <AccessDenied reason={t('goals.admin.denied')} testId="goals-admin-denied" />;
  }
  const pages = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));
  async function after(result: Outcome) {
    await router.invalidate();
    return toOutcome(result);
  }
  return (
    <section className="grid gap-6" data-testid="goals-admin-page">
      <h1 className="text-2xl font-semibold">{t('goals.admin.title')}</h1>
      <GoalsAdmin
        segments={{
          ...data.segments,
          paging: {
            page: data.segments.page,
            pages: pages(data.segments.total),
            onPage: (page) => void navigate({ search: (s) => ({ ...s, segmentsPage: page }) }),
          },
        }}
        goals={{
          ...data.goals,
          paging: {
            page: data.goals.page,
            pages: pages(data.goals.total),
            onPage: (page) => void navigate({ search: (s) => ({ ...s, goalsPage: page }) }),
          },
        }}
        onSaveSegment={async (input) =>
          after(await saveSegment({ data: input as SegmentSaveInput }))
        }
        onDeleteSegment={async (input) =>
          after(await deleteSegment({ data: input as SegmentDeleteInput }))
        }
        onSaveGoal={async (input) => after(await saveGoal({ data: input as GoalSaveInput }))}
        onRetireGoal={async (input) => after(await retireGoal({ data: input as GoalRetireInput }))}
      />
    </section>
  );
}
