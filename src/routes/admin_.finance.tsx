import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { getPlatformBooks } from '#src/features/insights/server/insights.functions.ts';
import { BooksSearch } from '#src/features/insights/server/insights.schema.ts';
import type { PlatformFinance } from '#src/features/insights/server/insights.types.ts';
import { PlatformBooksView } from '#src/features/insights/ui/PlatformBooksView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// The platform's books, Admin only.
export const Route = createFileRoute('/admin_/finance')({
  validateSearch: BooksSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const result = await getPlatformBooks({ data: { page: deps.page ?? 1 } });
    return result.ok
      ? { denied: false as const, books: result.value as PlatformFinance }
      : { denied: true as const };
  },
  component: FinancePage,
});

function FinancePage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  if (data.denied) {
    return (
      <p role="alert" data-testid="books-denied">
        {t('admin.denied')}
      </p>
    );
  }
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <PlatformBooksView
          books={data.books}
          onPage={(page) => void navigate({ search: { page } })}
        />
      </div>
    </div>
  );
}
