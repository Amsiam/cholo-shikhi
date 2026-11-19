import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordForm } from '#src/features/identity-access/ui/ResetForms.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const Route = createFileRoute('/reset-password/$token')({ component: ResetPasswordPage });

function ResetPasswordPage() {
  const { t } = useI18n();
  const { token } = Route.useParams();
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 border border-primary/15 bg-background p-6 sm:p-8"
      data-testid="reset-password-page"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.reset.newTitle')}</h1>
      <ResetPasswordForm token={token} />
    </section>
  );
}
