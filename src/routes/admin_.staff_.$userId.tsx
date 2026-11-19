import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { getInstructorHr } from '#src/features/hr/server/hr.functions.ts';
import { getStaffMember } from '#src/features/identity-access/server/staff.functions.ts';
import { StaffProfile } from '#src/features/identity-access/ui/StaffProfile.tsx';
import { getInstructorEarnings } from '#src/features/insights/server/insights.functions.ts';
import { getInstructorKyc } from '#src/features/kyc/server/kyc.functions.ts';
import {
  getInstructorCycleStatement,
  getInstructorPayoutCycles,
} from '#src/features/payouts/server/payouts.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

const okValue = <T,>(r: { ok: true; value: T } | { ok: false }): T | null =>
  r.ok ? r.value : null;

// The staff profile (Admin with two-step only): account, roles and role history, and for anyone who
// teaches or taught, their payout cycles (?cycle=YYYY-MM opens that cycle's statement), earnings,
// KYC and HR. Each part loads on its own, so one failing read never hides the rest.
export const Route = createFileRoute('/admin_/staff_/$userId')({
  validateSearch: z.object({
    cycle: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ cycle: search.cycle }),
  loader: async ({ params, deps }) => {
    const member = await getStaffMember({ data: { userId: params.userId } });
    if (!member.ok) {
      if (member.error.code === 'NOT_FOUND' || member.error.code === 'VALIDATION_FAILED')
        throw notFound();
      return { denied: true as const };
    }
    const teaches = member.value.history.some((h) => h.role === 'instructor');
    if (!teaches)
      return { denied: false as const, member: member.value, money: null, statement: null };
    const instructorId = params.userId;
    const [earnings, cycles, kyc, hr, statement] = await Promise.all([
      getInstructorEarnings({ data: { instructorId } }),
      getInstructorPayoutCycles({ data: { instructorId } }),
      getInstructorKyc({ data: { instructorId } }),
      getInstructorHr({ data: { instructorId } }),
      deps.cycle
        ? getInstructorCycleStatement({ data: { instructorId, month: deps.cycle } })
        : Promise.resolve({ ok: false as const }),
    ]);
    return {
      denied: false as const,
      member: member.value,
      money: {
        earnings: okValue(earnings),
        cycles: okValue(cycles),
        kyc: okValue(kyc),
        hr: okValue(hr),
      },
      statement: okValue(statement),
    };
  },
  component: StaffProfilePage,
});

function StaffProfilePage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { cycle } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  if (data.denied)
    return <AccessDenied reason={t('staff.error.forbidden')} testId="staff-denied" />;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <StaffProfile
          member={data.member}
          money={data.money}
          statement={data.statement}
          selectedCycle={cycle}
          onSelectCycle={(month) =>
            void navigate({
              search: month ? { cycle: month } : {},
              replace: true,
              resetScroll: false,
            })
          }
        />
      </div>
    </div>
  );
}
