import { createFileRoute, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { searchCatalogCourses } from '#src/features/catalog/server/catalog-browse.functions.ts';
import { CatalogPageSearch } from '#src/features/catalog/server/catalog-browse.schema.ts';
import type { CourseSearchPage } from '#src/features/catalog/server/catalog-browse.types.ts';
import {
  CourseResults,
  ExamPicker,
  finderContainer,
  type GoalGroup,
} from '#src/features/catalog/ui/CourseFinder.tsx';
import { getCurrentGoal, listPublicGoals } from '#src/features/goals/server/goals.functions.ts';
import { requireCurrentGoal } from '#src/features/goals/ui/require-current-goal.ts';
import { BundleList } from '#src/features/marketing/ui/StorefrontParts.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { type BundleCard, listBundlesForGoal } from './-adapters/marketing.ts';

type LoaderData =
  | { kind: 'pick'; groups: GoalGroup[]; currentGoalId: string | null }
  | { kind: 'results'; result: CourseSearchPage; bundles: BundleCard[] }
  | { kind: 'failed' };

// The catalog course finder. Without an exam in the address the page asks which exam the visitor is
// preparing for; a signed-in Student skips that step and starts on their current Goal (the Goal guard
// still sends a Student with no Goal to choose one first, BR2.1). With an exam it lists that exam's
// published courses, searchable by title, one numbered page at a time. `choose` reopens the picker
// without changing the Student's Goal. Signed-in responses stay no-store (NFR6.220).
export const Route = createFileRoute('/catalog')({
  validateSearch: CatalogPageSearch,
  beforeLoad: async () => {
    const shell = await getShellState();
    return { isSignedIn: shell.ok && shell.value.isSignedIn };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }): Promise<LoaderData> => {
    const current = context.isSignedIn
      ? await requireCurrentGoal(() => getCurrentGoal({ data: {} }))
      : null;
    const goalId = deps.goal ?? (deps.choose ? undefined : current?.goalId);
    if (!goalId) {
      const listed = await listPublicGoals({ data: {} }).catch(() => null);
      if (!listed?.ok) return { kind: 'failed' };
      return {
        kind: 'pick',
        groups: listed.value.segments,
        currentGoalId: current?.goalId ?? null,
      };
    }
    const result = await searchCatalogCourses({
      data: { goalId, query: deps.q, page: deps.page ?? 1 },
    }).catch(() => null);
    if (!result?.ok) {
      // An unknown or retired exam in a shared link: ask again instead of failing the page.
      if (result?.error.code === 'NOT_FOUND') {
        const listed = await listPublicGoals({ data: {} }).catch(() => null);
        if (listed?.ok)
          return {
            kind: 'pick',
            groups: listed.value.segments,
            currentGoalId: current?.goalId ?? null,
          };
      }
      return { kind: 'failed' };
    }
    // US8.4: the Goal's segment bundles, composed here (the catalog never imports Marketing).
    const bundles = await listBundlesForGoal(goalId).catch(() => []);
    return { kind: 'results', result: result.value, bundles };
  },
  component: CatalogPage,
});

function CatalogPage() {
  const data = Route.useLoaderData();
  if (data.kind === 'pick')
    return <ExamPicker groups={data.groups} currentGoalId={data.currentGoalId} />;
  if (data.kind === 'results')
    return (
      <>
        <CourseResults result={data.result} />
        {data.bundles.length > 0 ? (
          <div className={`${finderContainer} pb-12`}>
            <BundleList bundles={data.bundles} />
          </div>
        ) : null}
      </>
    );
  return <CatalogFailed />;
}

function CatalogFailed() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <section className="bg-paper" data-testid="catalog-page">
      <div
        role="alert"
        className={`${finderContainer} flex flex-col items-start gap-3 py-16`}
        data-testid="catalog-error"
      >
        <h1 className="text-3xl font-bold">{t('catalog.browse.title')}</h1>
        <p className="text-lg">{t('catalog.browse.loadFailed')}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void router.invalidate()}
          data-testid="catalog-error-retry"
        >
          {t('catalog.browse.retry')}
        </Button>
      </div>
    </section>
  );
}
