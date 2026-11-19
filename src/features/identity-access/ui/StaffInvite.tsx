// The staff invitation page (/staff-invite/<token>): the invitee sees who invited them as what, and
// sets a password. That activates the account and gives the role; they then sign in and set up
// two-step like every staff member. An expired, used or unknown link says so and what to do.
import { Link } from '@tanstack/react-router';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { ErrorScreen } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { FormField } from './FormField.tsx';

export type StaffInvitePreview = {
  name: string;
  email: string;
  role: 'instructor' | 'admin' | 'finance';
  instructorType: 'employee' | 'contractor' | null;
  state: 'open' | 'expired' | 'used';
};
type Outcome =
  | { ok: true }
  | { ok: false; error: { code: string; fieldErrors?: Record<string, readonly string[]> } };

const PASSWORD_MIN = 12;

export function StaffInviteAccept(props: {
  invite: StaffInvitePreview | null;
  onAccept: (password: string) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const invite = props.invite;
  if (!invite || invite.state !== 'open') {
    const reason =
      invite?.state === 'used'
        ? 'staffInvite.used'
        : invite?.state === 'expired'
          ? 'staffInvite.expired'
          : 'errors.identity.INVITE_INVALID';
    return (
      <ErrorScreen
        kind="denied"
        testId="staff-invite-invalid"
        title={t('staffInvite.invalidTitle')}
        body={tDynamic(reason)}
        actions={
          <Link
            to="/sign-in"
            className="tap-target font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t('staffInvite.signIn')}
          </Link>
        }
      />
    );
  }
  const role = invite.instructorType
    ? `${t(`staff.role.${invite.role}`)} · ${t(`staff.type.${invite.instructorType}`)}`
    : t(`staff.role.${invite.role}`);
  const submit = async () => {
    setError(null);
    if (password.length < PASSWORD_MIN) return setError('staffInvite.passwordShort');
    if (password !== again) return setError('staffInvite.passwordMismatch');
    setIsSaving(true);
    const r = await props.onAccept(password);
    setIsSaving(false);
    if (r.ok) return setIsDone(true);
    setError(
      r.error.code === 'INVITE_INVALID'
        ? 'errors.identity.INVITE_INVALID'
        : (r.error.fieldErrors?.password?.[0] ?? 'staffInvite.failed'),
    );
  };
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 border border-primary/15 bg-background p-6 sm:p-8"
      data-testid="staff-invite-page"
    >
      {isDone ? (
        <div className="grid gap-4" role="status" data-testid="staff-invite-done">
          <CircleCheck aria-hidden="true" className="size-10 text-pass" />
          <h1 className="text-2xl font-extrabold tracking-tight">{t('staffInvite.doneTitle')}</h1>
          <p className="text-ink-muted">{t('staffInvite.doneBody', { email: invite.email })}</p>
          <Link
            to="/sign-in"
            search={{}}
            className="inline-flex min-h-12 w-fit items-center justify-center rounded-sm bg-primary px-6 font-semibold text-primary-foreground"
          >
            {t('staffInvite.signIn')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {t('staffInvite.title', { name: invite.name })}
            </h1>
            <p className="text-ink-muted">{t('staffInvite.body', { role, email: invite.email })}</p>
          </div>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FormField
              id="staff-invite-password"
              label={t('staffInvite.password')}
              hint={t('staffInvite.passwordHint')}
              testId="staff-invite-password"
              inputProps={{
                type: 'password',
                autoComplete: 'new-password',
                value: password,
                onChange: (e) => setPassword(e.target.value),
              }}
            />
            <FormField
              id="staff-invite-again"
              label={t('staffInvite.passwordAgain')}
              testId="staff-invite-again"
              error={error ? tDynamic(error) : undefined}
              inputProps={{
                type: 'password',
                autoComplete: 'new-password',
                value: again,
                onChange: (e) => setAgain(e.target.value),
              }}
            />
            <Button type="submit" size="lg" disabled={isSaving} data-testid="staff-invite-submit">
              <KeyRound aria-hidden="true" />
              {t('staffInvite.submit')}
            </Button>
          </form>
          <p className="text-xs text-ink-muted">{t('staffInvite.twoStepNote')}</p>
        </>
      )}
    </section>
  );
}
