import { createFileRoute } from '@tanstack/react-router';
import {
  acceptStaffInvite,
  getStaffInvite,
} from '#src/features/identity-access/server/staff.functions.ts';
import {
  StaffInviteAccept,
  type StaffInvitePreview,
} from '#src/features/identity-access/ui/StaffInvite.tsx';

// The emailed staff invitation: set a password to join (the token in the path is the key).
export const Route = createFileRoute('/staff-invite/$token')({
  loader: async ({ params }) => {
    const r = await getStaffInvite({ data: { token: params.token } });
    return { invite: r.ok ? (r.value as StaffInvitePreview) : null };
  },
  component: StaffInvitePage,
});

function StaffInvitePage() {
  const { invite } = Route.useLoaderData();
  const { token } = Route.useParams();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper px-4 py-10">
      <StaffInviteAccept
        invite={invite}
        onAccept={async (password) =>
          (await acceptStaffInvite({ data: { token, password } })) as
            | { ok: true }
            | { ok: false; error: { code: string } }
        }
      />
    </div>
  );
}
