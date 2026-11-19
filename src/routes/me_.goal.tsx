import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  changeGoal,
  getCurrentGoal,
  listActiveGoals,
} from '#src/features/goals/server/goals.functions.ts';
import { ChangeGoalSection } from '#src/features/goals/ui/ChangeGoalSection.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// S12 Me → Goal (UC2, US1.10). A non-nested route at /me/goal, so the U1 Me screen stays a leaf.
export const Route = createFileRoute('/me_/goal')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [current, listed] = await Promise.all([
      getCurrentGoal({ data: {} }),
      listActiveGoals({ data: {} }),
    ]);
    return {
      current: current.ok ? current.value : null,
      groups: listed.ok ? listed.value.segments : [],
      isLoadFailed: !listed.ok,
    };
  },
  component: MeGoalPage,
});

function MeGoalPage() {
  const { t } = useI18n();
  const router = useRouter();
  const data = Route.useLoaderData();
  return (
    <section className="grid gap-6" data-testid="me-goal-page">
      <h1 className="text-2xl font-semibold">{t('goals.me.title')}</h1>
      {data.isLoadFailed ? (
        <p role="alert" data-testid="me-goal-load-failed">
          {t('goals.picker.loadFailed')}
        </p>
      ) : null}
      {data.current ? (
        <ChangeGoalSection
          current={data.current}
          groups={data.groups}
          onChange={async (goalId) => {
            const result = await changeGoal({ data: { goalId, acknowledgedStreakReset: true } });
            await router.invalidate();
            return result.ok ? null : { i18nKey: result.error.i18nKey };
          }}
        />
      ) : (
        <div className="grid gap-3">
          <p>{t('goals.me.none')}</p>
          <Link to="/goals" data-testid="me-goal-choose">
            {t('goals.me.chooseLink')}
          </Link>
        </div>
      )}
    </section>
  );
}
