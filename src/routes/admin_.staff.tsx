import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  cancelStaffInvite,
  inviteStaff,
  listStaff,
  listStaffInvites,
  resendStaffInvite,
  revokeStaffRole,
} from '#src/features/identity-access/server/staff.functions.ts';
import {
  StaffAdmin,
  type StaffInvitation,
  type StaffMember,
} from '#src/features/identity-access/ui/StaffAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: { code: string; i18nKey?: string } };

// US1.6 Staff and roles, for Admins with two-step sign-in: add staff (role now, or an emailed
// invitation), open invitations, and the current staff.
export const Route = createFileRoute('/admin_/staff')({
  loader: async () => {
    const [staff, invites] = await Promise.all([
      listStaff({ data: {} }),
      listStaffInvites({ data: {} }),
    ]);
    return staff.ok
      ? {
          denied: false as const,
          staff: staff.value as StaffMember[],
          invitations: invites.ok ? (invites.value as StaffInvitation[]) : [],
        }
      : { denied: true as const };
  },
  component: StaffPage,
});

function StaffPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied)
    return <AccessDenied reason={t('staff.error.forbidden')} testId="staff-denied" />;
  const refresh = async <T,>(r: Outcome<T>) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <StaffAdmin
          staff={data.staff}
          invitations={data.invitations}
          onInvite={async (input) =>
            refresh(
              (await inviteStaff({ data: input })) as Outcome<{
                mode: 'assigned' | 'invited';
                userId: string;
              }>,
            )
          }
          onResendInvite={async (invitationId) =>
            refresh((await resendStaffInvite({ data: { invitationId } })) as Outcome)
          }
          onCancelInvite={async (invitationId) =>
            refresh((await cancelStaffInvite({ data: { invitationId } })) as Outcome)
          }
          onRevoke={async (userId, role) =>
            refresh((await revokeStaffRole({ data: { userId, role } })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
