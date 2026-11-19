import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  answerMyVaultQuestion,
  getMyVault,
  getMyVaultSession,
} from '#src/features/learning/server/learning.functions.ts';
import type {
  VaultAnswerResult,
  VaultQuestion,
  VaultSummary,
} from '#src/features/learning/server/vault.server.ts';
import { VaultView } from '#src/features/learning/ui/VaultView.tsx';

type Result<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

// Mistake Vault (FR-ADP-1): the signed-in Student's own wrong answers, practised until mastered.
export const Route = createFileRoute('/vault')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const result = await getMyVault({ data: {} });
    return result.ok ? (result.value as VaultSummary) : null;
  },
  component: VaultPage,
});

function VaultPage() {
  const summary = Route.useLoaderData();
  const router = useRouter();
  if (!summary) return null;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <VaultView
          summary={summary}
          onStart={async () =>
            (await getMyVaultSession({ data: {} })) as Result<{ questions: VaultQuestion[] }>
          }
          onAnswer={async (questionId, chosenIndex) =>
            (await answerMyVaultQuestion({
              data: { questionId, chosenIndex },
            })) as Result<VaultAnswerResult>
          }
          onDone={() => void router.invalidate()}
        />
      </div>
    </div>
  );
}
