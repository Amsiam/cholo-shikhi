import { createFileRoute, Link } from '@tanstack/react-router';
import { AuthShell } from '#src/features/identity-access/ui/AuthShell.tsx';
import { SignUpForm } from '#src/features/identity-access/ui/SignUpForm.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const Route = createFileRoute('/sign-up')({ component: SignUpPage });

function SignUpPage() {
  const { t } = useI18n();
  return (
    <AuthShell
      variant="signUp"
      testId="sign-up-page"
      title={t('auth.signUp.title')}
      subtitle={t('auth.signUp.subtitle')}
      footer={
        <Link
          to="/sign-in"
          className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          data-testid="sign-up-to-sign-in"
        >
          {t('auth.signUp.haveAccount')}
        </Link>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
