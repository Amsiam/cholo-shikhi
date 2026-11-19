import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  assignStaffRole,
  findStaffCandidate,
  listStaff,
  revokeStaffRole,
} from '#src/features/identity-access/server/staff.functions.ts';
import {
  StaffAdmin,
  type StaffCandidate,
  type StaffMember,
} from '#src/features/identity-access/ui/StaffAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: { code: string; i18nKey?: string } };

// US1.6 Staff and roles, for Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/staff')({
  loader: async () => {
    const r = await listStaff({ data: {} });
    return r.ok
      ? { denied: false as const, staff: r.value as StaffMember[] }
      : { denied: true as const };
  },
  component: StaffPage,
});

function StaffPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return (
      <p role="alert" className="p-6">
        {t('staff.error.forbidden')}
      </p>
    );
  const refresh = async <T,>(r: Outcome<T>) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <StaffAdmin
          staff={data.staff}
          onFind={async (email) =>
            (await findStaffCandidate({ data: { email } })) as Outcome<StaffCandidate>
          }
          onAssign={async (input) => refresh((await assignStaffRole({ data: input })) as Outcome)}
          onRevoke={async (userId, role) =>
            refresh((await revokeStaffRole({ data: { userId, role } })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
