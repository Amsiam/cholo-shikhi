import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';
import {
  listPlanItemCandidates,
  listPlansAdmin,
  publishPlan,
  retirePlan,
  savePlan,
  unpublishPlan,
} from '#src/features/catalog/server/catalog-products.functions.ts';
import type { GoalChoice } from '#src/features/catalog/ui/ExamPackagesAdmin.tsx';
import type { SaveOutcome } from '#src/features/catalog/ui/fields.tsx';
import {
  type PlanAdminRow,
  type PlanCandidate,
  PlansAdmin,
} from '#src/features/catalog/ui/PlansAdmin.tsx';
import { listActiveGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

const PAGE_SIZE = 20;
type Outcome = { ok: boolean; error?: NonNullable<SaveOutcome> };

// A9 subscription plans (Admin with two-step only, BR10.11). A non-nested route at /admin/plans, so
// the U1 Admin console stays a leaf. The item picker reads the published courses and exam packages
// of the plan's Goal (BR10.1, BR10.5). Paging is server-side.
export const Route = createFileRoute('/admin_/plans')({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const [list, goals] = await Promise.all([
      listPlansAdmin({ data: { page: deps.page, pageSize: PAGE_SIZE } }),
      listActiveGoals({ data: {} }),
    ]);
    if (!list.ok) return { denied: true as const };
    const groups = goals.ok
      ? (goals.value as { segments: Array<{ goals: GoalChoice[] }> }).segments
      : [];
    return {
      denied: false as const,
      list: list.value as { rows: PlanAdminRow[]; total: number; page: number },
      goals: groups.flatMap((g) => g.goals),
    };
  },
  component: PlansPage,
});

function PlansPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate({ from: '/admin/plans' });
  const loadCandidates = useCallback(async (goalId: string): Promise<PlanCandidate[]> => {
    const result = await listPlanItemCandidates({ data: { goalId } });
    if (!result.ok) return [];
    const value = result.value as { courses: PlanCandidate[]; examPackages: PlanCandidate[] };
    return [...value.courses, ...value.examPackages];
  }, []);
  if (data.denied) {
    return (
      <p role="alert" data-testid="plans-denied">
        {t('admin.denied')}
      </p>
    );
  }
  async function after(result: Outcome): Promise<SaveOutcome> {
    await router.invalidate();
    return result.ok ? null : (result.error ?? null);
  }
  return (
    <section className="grid gap-6" data-testid="plans-page">
      <h1 className="text-2xl font-semibold">{t('catalog.product.plan.title')}</h1>
      <PlansAdmin
        rows={data.list.rows}
        total={data.list.total}
        goals={data.goals}
        paging={{
          page: data.list.page,
          pages: Math.max(1, Math.ceil(data.list.total / PAGE_SIZE)),
          onPage: (page) => void navigate({ search: { page } }),
        }}
        loadCandidates={loadCandidates}
        onSave={async (input) => after(await savePlan({ data: input }))}
        onAction={async (action, row) => {
          const data = { planId: row.planId, expectedVersion: row.version };
          if (action === 'publish') return after(await publishPlan({ data }));
          if (action === 'unpublish') return after(await unpublishPlan({ data }));
          return after(await retirePlan({ data }));
        }}
      />
    </section>
  );
}
