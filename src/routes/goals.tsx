import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  chooseGoal,
  getCurrentGoal,
  listActiveGoals,
} from '#src/features/goals/server/goals.functions.ts';
import { GoalPicker, type PickerState } from '#src/features/goals/ui/GoalPicker.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// S1 Goal picker (UC1, BR2.1–BR2.3): the first screen for a signed-in Student with no Goal.
export const Route = createFileRoute('/goals')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async (): Promise<PickerState> => {
    const current = await getCurrentGoal({ data: {} });
    if (current.ok) throw redirect({ to: '/me/goal' });
    const listed = await listActiveGoals({ data: {} });
    return listed.ok ? { kind: 'loaded', groups: listed.value.segments } : { kind: 'failed' };
  },
  component: GoalsPage,
});

function GoalsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const state = Route.useLoaderData();
  return (
    <section className="grid gap-6" data-testid="goals-page">
      <h1 className="text-2xl font-semibold">{t('goals.picker.title')}</h1>
      <p>{t('goals.picker.intro')}</p>
      <GoalPicker
        state={state}
        onRetry={() => void router.invalidate()}
        onChoose={async (goalId) => {
          const result = await chooseGoal({ data: { goalId } });
          if (!result.ok) {
            await router.invalidate();
            return { i18nKey: result.error.i18nKey };
          }
          await router.navigate({ to: '/' });
          return null;
        }}
      />
    </section>
  );
}
