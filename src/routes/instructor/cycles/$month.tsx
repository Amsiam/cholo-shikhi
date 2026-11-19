import { createFileRoute, notFound } from '@tanstack/react-router';
import { getMyCycleStatement } from '#src/features/payouts/server/payouts.functions.ts';
import type { CycleStatement } from '#src/features/payouts/server/payouts.server.ts';
import { CycleStatementView } from '#src/features/payouts/ui/MyPayouts.tsx';

// US7.8 per cycle: the caller's own payout statement for one committed cycle.
export const Route = createFileRoute('/instructor/cycles/$month')({
  loader: async ({ params }) => {
    const r = await getMyCycleStatement({ data: { month: params.month } });
    if (!r.ok) throw notFound();
    return r.value as CycleStatement;
  },
  component: CyclePage,
});

function CyclePage() {
  const statement = Route.useLoaderData();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink print:bg-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <CycleStatementView statement={statement} />
      </div>
    </div>
  );
}
