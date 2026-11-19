import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { getMyLiveClasses } from '#src/features/live/server/live.functions.ts';
import type { LiveClassCard } from '#src/features/live/server/live.server.ts';
import { LiveListView } from '#src/features/live/ui/LiveRoom.tsx';

// Live classes of the Student's courses.
export const Route = createFileRoute('/live/')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const r = await getMyLiveClasses({ data: {} });
    return r.ok
      ? (r.value as { upcoming: LiveClassCard[]; recordings: LiveClassCard[] })
      : { upcoming: [], recordings: [] };
  },
  component: () => {
    const data = Route.useLoaderData();
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <LiveListView upcoming={data.upcoming} recordings={data.recordings} />
        </div>
      </div>
    );
  },
});
