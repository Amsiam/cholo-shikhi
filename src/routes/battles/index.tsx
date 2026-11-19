import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  createBattleRoom,
  findQuickMatch,
  getMyBattleHome,
  joinBattleRoom,
  joinHostedBattle,
} from '#src/features/battle/server/battle.functions.ts';
import type { BattleHome } from '#src/features/battle/server/battle.server.ts';
import { BattleHomeView } from '#src/features/battle/ui/BattleHome.tsx';
import { getMyPracticeTopics } from '#src/features/learning/server/learning.functions.ts';
import type { PracticeCatalog } from '#src/features/learning/server/practice.server.ts';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// Quiz battles: quick match, friend rooms and staff-hosted battles.
export const Route = createFileRoute('/battles/')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [home, catalog] = await Promise.all([
      getMyBattleHome({ data: {} }),
      getMyPracticeTopics({ data: {} }),
    ]);
    if (!home.ok || !catalog.ok) return null;
    return { home: home.value as BattleHome, catalog: catalog.value as PracticeCatalog };
  },
  component: BattlesPage,
});

function BattlesPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  if (!data) return null;
  const go = async (r: Outcome<{ battleId: string }>) => {
    if (r.ok) await navigate({ to: '/battles/$battleId', params: { battleId: r.value.battleId } });
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <BattleHomeView
          home={data.home}
          catalog={data.catalog}
          onQuick={async (input) =>
            go((await findQuickMatch({ data: input })) as Outcome<{ battleId: string }>)
          }
          onCreateRoom={async (input) =>
            go((await createBattleRoom({ data: input })) as Outcome<{ battleId: string }>)
          }
          onJoinCode={async (code) =>
            go((await joinBattleRoom({ data: { code } })) as Outcome<{ battleId: string }>)
          }
          onJoinHosted={async (battleId) =>
            go((await joinHostedBattle({ data: { battleId } })) as Outcome<{ battleId: string }>)
          }
        />
      </div>
    </div>
  );
}
