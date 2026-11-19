import { createFileRoute } from '@tanstack/react-router';
import { ResetRequestForm } from '#src/features/identity-access/ui/ResetForms.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const Route = createFileRoute('/reset-password/')({ component: ResetRequestPage });

function ResetRequestPage() {
  const { t } = useI18n();
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 border border-primary/15 bg-background p-6 sm:p-8"
      data-testid="reset-request-page"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.reset.title')}</h1>
      <ResetRequestForm />
    </section>
  );
}
