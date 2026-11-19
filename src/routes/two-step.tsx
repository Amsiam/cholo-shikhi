import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  confirmTwoStepEnrolment,
  getTwoStepState,
  redeemTwoStepRecoveryCode,
  startTwoStepEnrolment,
  verifyTwoStepCode,
} from '#src/features/app-shell/server/shell.functions.ts';
import { TwoStepPanel } from '#src/features/identity-access/ui/TwoStepPanel.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const Route = createFileRoute('/two-step')({
  loader: async () => {
    const result = await getTwoStepState();
    return result.ok ? result.value.state : 'none';
  },
  component: TwoStepPage,
});

function TwoStepPage() {
  const { t } = useI18n();
  const state = Route.useLoaderData();
  const router = useRouter();
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 border border-primary/15 bg-background p-6 sm:p-8"
      data-testid="two-step-page"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">{t('twoStep.title')}</h1>
      <TwoStepPanel
        state={state}
        actions={{
          startEnrolment: startTwoStepEnrolment,
          confirmEnrolment: confirmTwoStepEnrolment,
          verifyCode: verifyTwoStepCode,
          redeemRecoveryCode: redeemTwoStepRecoveryCode,
        }}
        onDone={async () => {
          await router.invalidate();
          await router.navigate({ to: '/' });
        }}
      />
    </section>
  );
}
