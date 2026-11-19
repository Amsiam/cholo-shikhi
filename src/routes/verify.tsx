import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ResendVerificationForm } from '#src/features/identity-access/ui/ResetForms.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// VerifyResult (UC2): the verify link itself is handled by /api/auth/verify-email, which redirects here
// only when the link expired or was already used.
export const Route = createFileRoute('/verify')({
  validateSearch: z.object({ error: z.string().optional() }),
  component: VerifyPage,
});

function VerifyPage() {
  const { t } = useI18n();
  const { error } = Route.useSearch();
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 border border-primary/15 bg-background p-6 sm:p-8"
      data-testid="verify-page"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">{t('auth.verify.title')}</h1>
      {error ? (
        <p role="alert" data-testid="verify-expired">
          {t('auth.verify.expired')}
        </p>
      ) : null}
      <ResendVerificationForm />
    </section>
  );
}
