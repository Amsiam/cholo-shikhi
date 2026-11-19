import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  acceptStudyBuddyInvite,
  cancelMyBuddyInvite,
  createMyBuddyInvite,
  endMyStudyBuddy,
  getMyStudyBuddy,
  previewStudyBuddyInvite,
} from '#src/features/learning/server/buddy.functions.ts';
import type { MyBuddy } from '#src/features/learning/server/buddy.server.ts';
import { BuddyView } from '#src/features/learning/ui/BuddyView.tsx';

type Outcome<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Me → Study buddy (S12).
export const Route = createFileRoute('/me_/buddy')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const r = await getMyStudyBuddy({ data: {} });
    if (!r.ok) throw redirect({ to: '/sign-in' });
    return r.value as MyBuddy;
  },
  component: BuddyPage,
});

function BuddyPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refresh = async (r: Outcome): Promise<Outcome> => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <BuddyView
          data={data}
          onInvite={async () => refresh((await createMyBuddyInvite({ data: {} })) as Outcome)}
          onCancelInvite={async () => refresh((await cancelMyBuddyInvite({ data: {} })) as Outcome)}
          onPreview={async (code) =>
            (await previewStudyBuddyInvite({ data: { code } })) as Outcome<{ inviterName: string }>
          }
          onAccept={async (code) =>
            refresh((await acceptStudyBuddyInvite({ data: { code } })) as Outcome)
          }
          onEnd={async () => refresh((await endMyStudyBuddy({ data: {} })) as Outcome)}
        />
      </div>
    </div>
  );
}
