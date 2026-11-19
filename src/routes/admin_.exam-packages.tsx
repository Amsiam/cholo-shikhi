import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import {
  listExamPackagesAdmin,
  publishExamPackage,
  retireExamPackage,
  saveExamPackage,
  unpublishExamPackage,
} from '#src/features/catalog/server/catalog-products.functions.ts';
import {
  type ExamPackageAdminRow,
  ExamPackagesAdmin,
  type GoalChoice,
} from '#src/features/catalog/ui/ExamPackagesAdmin.tsx';
import type { SaveOutcome } from '#src/features/catalog/ui/fields.tsx';
import { listActiveGoals } from '#src/features/goals/server/goals.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

const PAGE_SIZE = 20;
type Outcome = { ok: boolean; error?: NonNullable<SaveOutcome> };

// A12 exam packages (Admin with two-step only, BR10.11). A non-nested route at /admin/exam-packages,
// so the U1 Admin console stays a leaf. The question picker slot is filled with Assessment's picker
// once U4 ships; until then the screen's ID list is used. Paging is server-side.
export const Route = createFileRoute('/admin_/exam-packages')({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const [list, goals] = await Promise.all([
      listExamPackagesAdmin({ data: { page: deps.page, pageSize: PAGE_SIZE } }),
      listActiveGoals({ data: {} }),
    ]);
    if (!list.ok) return { denied: true as const };
    const groups = goals.ok
      ? (goals.value as { segments: Array<{ goals: GoalChoice[] }> }).segments
      : [];
    return {
      denied: false as const,
      list: list.value as { rows: ExamPackageAdminRow[]; total: number; page: number },
      goals: groups.flatMap((g) => g.goals),
    };
  },
  component: ExamPackagesPage,
});

function ExamPackagesPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate({ from: '/admin/exam-packages' });
  if (data.denied) {
    return (
      <p role="alert" data-testid="exam-packages-denied">
        {t('admin.denied')}
      </p>
    );
  }
  async function after(result: Outcome): Promise<SaveOutcome> {
    await router.invalidate();
    return result.ok ? null : (result.error ?? null);
  }
  return (
    <section className="grid gap-6" data-testid="exam-packages-page">
      <h1 className="text-2xl font-semibold">{t('catalog.product.exam.title')}</h1>
      <ExamPackagesAdmin
        rows={data.list.rows}
        total={data.list.total}
        goals={data.goals}
        paging={{
          page: data.list.page,
          pages: Math.max(1, Math.ceil(data.list.total / PAGE_SIZE)),
          onPage: (page) => void navigate({ search: { page } }),
        }}
        onSave={async (input) => after(await saveExamPackage({ data: input }))}
        onAction={async (action, row) => {
          const data = { examPackageId: row.examPackageId, expectedVersion: row.version };
          if (action === 'publish') return after(await publishExamPackage({ data }));
          if (action === 'unpublish') return after(await unpublishExamPackage({ data }));
          return after(await retireExamPackage({ data }));
        }}
      />
    </section>
  );
}
