import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AuthShell } from '#src/features/identity-access/ui/AuthShell.tsx';
import { SignInForm } from '#src/features/identity-access/ui/SignInForm.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const Route = createFileRoute('/sign-in')({
  validateSearch: z.object({ verified: z.coerce.number().optional() }),
  component: SignInPage,
});

function SignInPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { verified } = Route.useSearch();
  return (
    <AuthShell
      variant="signIn"
      testId="sign-in-page"
      title={t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      footer={
        <Link
          to="/sign-up"
          className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          data-testid="sign-in-to-sign-up"
        >
          {t('auth.signIn.noAccount')}
        </Link>
      }
    >
      {verified ? (
        <p
          role="status"
          className="rounded-sm border border-pass/40 bg-pass/10 px-4 py-3 text-sm font-medium text-pass"
          data-testid="sign-in-verified"
        >
          {t('auth.signIn.verified')}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <SignInForm
          onSignedIn={async (next) => {
            await router.invalidate();
            await router.navigate({ to: next === '/two-step' ? '/two-step' : '/' });
          }}
        />
        <Link
          to="/reset-password"
          className="tap-target self-end text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid="sign-in-forgot"
        >
          {t('auth.signIn.forgot')}
        </Link>
      </div>
    </AuthShell>
  );
}
