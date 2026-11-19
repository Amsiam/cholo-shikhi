import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  answerLiveQuestion,
  getLiveRoom,
  sendLiveHeartbeat,
} from '#src/features/live/server/live.functions.ts';
import type { LiveRoom } from '#src/features/live/server/live.server.ts';
import { LiveRoomView } from '#src/features/live/ui/LiveRoom.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

// One live class: the player, attendance heartbeats and the pop-quiz.
export const Route = createFileRoute('/live/$liveClassId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const r = await getLiveRoom({ data: { liveClassId: params.liveClassId } });
    return r.ok ? (r.value as LiveRoom) : null;
  },
  component: RoomPage,
});

function RoomPage() {
  const { t } = useI18n();
  const room = Route.useLoaderData();
  const { liveClassId } = Route.useParams();
  if (!room)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-10">
        <p role="alert">{t('live.notFound')}</p>
        <Link to="/live" className="tap-target font-semibold text-primary hover:underline">
          {t('live.back')}
        </Link>
      </div>
    );
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <LiveRoomView
          key={liveClassId}
          initial={room}
          onRefresh={async () => {
            const r = await getLiveRoom({ data: { liveClassId } }).catch(() => null);
            return r?.ok ? (r.value as LiveRoom) : null;
          }}
          onHeartbeat={async (isVisible) => {
            await sendLiveHeartbeat({ data: { liveClassId, isVisible } }).catch(() => null);
          }}
          onAnswer={async (quizId, questionId, chosenIndex) =>
            (await answerLiveQuestion({ data: { quizId, questionId, chosenIndex } })) as Outcome
          }
        />
      </div>
    </div>
  );
}
