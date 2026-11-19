import { createFileRoute, notFound } from '@tanstack/react-router';
import { getMyEarningStatement } from '#src/features/insights/server/insights.functions.ts';
import type { MonthlyStatement } from '#src/features/insights/server/insights.types.ts';
import { StatementView } from '#src/features/insights/ui/StatementView.tsx';

// US7.8: one month's earnings statement (the caller's own only).
export const Route = createFileRoute('/instructor/statements/$month')({
  loader: async ({ params }) => {
    const r = await getMyEarningStatement({
      data: { month: params.month },
    });
    if (!r.ok) throw notFound();
    return r.value as MonthlyStatement;
  },
  component: StatementPage,
});

function StatementPage() {
  const statement = Route.useLoaderData();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink print:bg-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <StatementView statement={statement} />
      </div>
    </div>
  );
}
