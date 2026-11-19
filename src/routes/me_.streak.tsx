import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { getMyStreakRewards } from '#src/features/learning/server/learning.functions.ts';
import type { MyRewards } from '#src/features/learning/server/streak.server.ts';
import { StreakView } from '#src/features/learning/ui/StreakView.tsx';

// Me → Streak (S8): streak, shields and streak-tokens.
export const Route = createFileRoute('/me_/streak')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const r = await getMyStreakRewards({ data: {} });
    if (!r.ok) throw redirect({ to: '/sign-in' });
    return r.value as MyRewards;
  },
  component: StreakPage,
});

function StreakPage() {
  const data = Route.useLoaderData();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <StreakView data={data} />
      </div>
    </div>
  );
}
