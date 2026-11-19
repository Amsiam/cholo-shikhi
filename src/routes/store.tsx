import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { listCatalog } from '#src/features/catalog/server/catalog-browse.functions.ts';
import type {
  CatalogPage,
  ExamPackageCard,
  PlanCard,
} from '#src/features/catalog/server/catalog-browse.types.ts';
import { ProductPurchaseProvider } from '#src/features/catalog/ui/ProductBuy.tsx';
import { StoreView } from '#src/features/catalog/ui/StoreView.tsx';
import { getCurrentGoal } from '#src/features/goals/server/goals.functions.ts';
import { loadEntitlements, useProductPurchase } from './-adapters/product-purchase.ts';

// Packages and plans for the Student's goal.
export const Route = createFileRoute('/store')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [courses, packages, goal, entitlements] = await Promise.all([
      listCatalog({ data: { tab: 'courses' } }).catch(() => null),
      listCatalog({ data: { tab: 'exam_packages' } }).catch(() => null),
      getCurrentGoal({ data: {} }).catch(() => null),
      loadEntitlements(),
    ]);
    const items = (r: typeof courses) => (r?.ok ? (r.value as CatalogPage).items : []);
    return {
      goal: goal?.ok ? { nameBn: goal.value.nameBn, nameEn: goal.value.nameEn } : null,
      plans: items(courses).filter((c): c is PlanCard => c.kind === 'plan'),
      packages: items(packages).filter((c): c is ExamPackageCard => c.kind === 'exam_package'),
      entitlements,
    };
  },
  component: StorePage,
});

function StorePage() {
  const data = Route.useLoaderData();
  const purchase = useProductPurchase(data.entitlements);
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <ProductPurchaseProvider value={purchase}>
          <StoreView goal={data.goal} plans={data.plans} packages={data.packages} />
        </ProductPurchaseProvider>
      </div>
    </div>
  );
}
