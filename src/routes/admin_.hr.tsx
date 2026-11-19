import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  findHrInstructor,
  getInstructorHr,
  listHrInstructors,
  recordInstructorLeave,
  saveEmployeeRecord,
  savePayPolicyVersion,
} from '#src/features/hr/server/hr.functions.ts';
import type { InstructorHr } from '#src/features/hr/server/hr.server.ts';
import { HrAdmin } from '#src/features/hr/ui/HrAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true; value?: unknown } | { ok: false; error: { i18nKey?: string } };

// A7/A8 HR records (pay-policy versions, employee records, leave), for Finance or Admins with
// two-step sign-in. The selected instructor lives in the page address.
export const Route = createFileRoute('/admin_/hr')({
  validateSearch: z.object({ instructor: z.uuid().optional() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [list, selected] = await Promise.all([
      listHrInstructors({ data: {} }),
      deps.instructor
        ? getInstructorHr({ data: { instructorId: deps.instructor } }).catch(() => null)
        : null,
    ]);
    if (!list.ok) return { denied: true as const };
    return {
      denied: false as const,
      instructors: list.value as Array<{ instructorId: string; name: string }>,
      selected: selected?.ok ? (selected.value as InstructorHr) : null,
    };
  },
  component: HrPage,
});

function HrPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.hr.forbidden')} />;
  const refresh = async (r: unknown) => {
    const outcome = r as Outcome;
    if (outcome.ok) await router.invalidate();
    return outcome;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <HrAdmin
          instructors={data.instructors}
          selected={data.selected}
          onFind={async (text) => {
            const r = (await findHrInstructor({ data: { instructor: text } })) as Outcome;
            if (r.ok)
              await navigate({
                search: { instructor: (r.value as InstructorHr).instructorId },
              });
            return r;
          }}
          onSavePolicy={async (v) => refresh(await savePayPolicyVersion({ data: v as never }))}
          onSaveRecord={async (v) => refresh(await saveEmployeeRecord({ data: v as never }))}
          onRecordLeave={async (v) => refresh(await recordInstructorLeave({ data: v as never }))}
        />
      </div>
    </div>
  );
}
