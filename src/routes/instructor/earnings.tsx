import { createFileRoute } from '@tanstack/react-router';
import {
  getMyEarningStatementMonths,
  getMyInstructorEarnings,
} from '#src/features/insights/server/insights.functions.ts';
import type { InstructorEarnings } from '#src/features/insights/server/insights.types.ts';
import { EarningsView } from '#src/features/insights/ui/EarningsView.tsx';
import { StatementMonths } from '#src/features/insights/ui/StatementView.tsx';
import { getMyPayoutCycles } from '#src/features/payouts/server/payouts.functions.ts';
import type { MyPayoutCycle } from '#src/features/payouts/server/payouts.server.ts';
import { MyPayoutCycles } from '#src/features/payouts/ui/MyPayouts.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// The signed-in instructor's own earnings.
export const Route = createFileRoute('/instructor/earnings')({
  loader: async () => {
    const [result, months, cycles] = await Promise.all([
      getMyInstructorEarnings({ data: {} }),
      getMyEarningStatementMonths({ data: {} }),
      getMyPayoutCycles({ data: {} }),
    ]);
    return result.ok
      ? {
          denied: false as const,
          earnings: result.value as InstructorEarnings,
          months: months.ok ? (months.value as string[]) : [],
          cycles: cycles.ok ? (cycles.value as MyPayoutCycle[]) : [],
        }
      : { denied: true as const };
  },
  component: EarningsPage,
});

function EarningsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  if (data.denied) {
    return (
      <p role="alert" data-testid="earnings-denied">
        {t('catalog.instructor.denied')}
      </p>
    );
  }
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-8">
          <EarningsView earnings={data.earnings} />
          <MyPayoutCycles cycles={data.cycles} />
          <StatementMonths months={data.months} />
        </div>
      </div>
    </div>
  );
}
