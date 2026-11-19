import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  answerBattleQuestion,
  finishMyBattle,
  getMyBattle,
  leaveMyBattle,
  startBattleRoom,
} from '#src/features/battle/server/battle.functions.ts';
import type { BattleView } from '#src/features/battle/server/battle.server.ts';
import { BattleArena } from '#src/features/battle/ui/BattleArena.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// One battle: lobby, play and results (refreshes itself).
export const Route = createFileRoute('/battles/$battleId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const r = await getMyBattle({ data: { battleId: params.battleId } });
    return r.ok ? (r.value as BattleView) : null;
  },
  staleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
  component: BattlePage,
});

function BattlePage() {
  const { t } = useI18n();
  const view = Route.useLoaderData();
  const { battleId } = Route.useParams();
  const navigate = useNavigate();
  if (!view)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-10">
        <p role="alert">{t('battle.notFound')}</p>
        <Link to="/battles" className="tap-target font-semibold text-primary hover:underline">
          {t('battle.back')}
        </Link>
      </div>
    );
  const ref = { data: { battleId } };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <BattleArena
          key={battleId}
          initial={view}
          onRefresh={async () => {
            const r = await getMyBattle(ref);
            return r.ok ? (r.value as BattleView) : null;
          }}
          onAnswer={async (questionId, chosenIndex) =>
            (await answerBattleQuestion({
              data: { battleId, questionId, chosenIndex },
            })) as Outcome<unknown>
          }
          onFinish={async () => {
            await finishMyBattle(ref);
          }}
          onStart={async () => (await startBattleRoom(ref)) as Outcome<unknown>}
          onLeave={async () => {
            await leaveMyBattle(ref);
            await navigate({ to: '/battles' });
          }}
        />
      </div>
    </div>
  );
}
