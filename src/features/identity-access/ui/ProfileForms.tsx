// Settings: the Student's own profile (name, mobile number) and a password change. A password change
// signs every other device out (BR2.9); the server checks the current password.
import { useForm } from '@tanstack/react-form';
import { KeyRound, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { formatBdPhone } from '../domain/phone.ts';
import type { Profile } from '../server/profile.server.ts';
import { FormField } from './FormField.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; i18nKey: string; fieldErrors?: Record<string, readonly string[]> };

const panel = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

export function ProfileForm(props: {
  profile: Profile;
  onSave: (input: { name: string; phone: string }) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useForm({
    defaultValues: {
      name: props.profile.name,
      phone: props.profile.phone ? formatBdPhone(props.profile.phone) : '',
    },
    onSubmit: async ({ value }) => {
      setStatus('idle');
      const r = await props.onSave(value);
      if (r.ok) {
        setErrors({});
        setStatus('saved');
        return;
      }
      setErrors({
        name: r.fieldErrors?.name?.[0] ?? '',
        phone: r.fieldErrors?.phone?.[0] ?? '',
        _form: r.fieldErrors ? '' : r.i18nKey,
      });
    },
  });
  return (
    <section aria-labelledby="profile-title" className={panel} data-testid="profile-form">
      <h2 id="profile-title" className="flex items-center gap-2 text-lg">
        <UserRound aria-hidden="true" className="size-5 text-primary" />
        {t('profile.title')}
      </h2>
      <p className="text-sm text-ink-muted">{t('profile.email', { email: props.profile.email })}</p>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <FormField
              id="profile-name"
              label={t('profile.name')}
              testId="profile-name"
              error={errors.name ? tDynamic(errors.name) : undefined}
              inputProps={{
                value: field.state.value,
                maxLength: 80,
                autoComplete: 'name',
                onChange: (e) => field.handleChange(e.target.value),
              }}
            />
          )}
        </form.Field>
        <form.Field name="phone">
          {(field) => (
            <FormField
              id="profile-phone"
              label={t('profile.phone')}
              hint={t('profile.phoneHint')}
              testId="profile-phone"
              error={errors.phone ? tDynamic(errors.phone) : undefined}
              inputProps={{
                value: field.state.value,
                inputMode: 'tel',
                autoComplete: 'tel-national',
                placeholder: '01XXX-XXXXXX',
                onChange: (e) => field.handleChange(e.target.value),
              }}
            />
          )}
        </form.Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" data-testid="profile-save">
            {t('profile.save')}
          </Button>
          {status === 'saved' ? (
            <p role="status" className="text-sm font-semibold text-pass">
              {t('profile.saved')}
            </p>
          ) : null}
          {errors._form ? (
            <p role="alert" className="text-sm text-destructive">
              {tDynamic(errors._form)}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

export function ChangePasswordForm(props: {
  onChange: (input: { currentPassword: string; newPassword: string }) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [status, setStatus] = useState<'idle' | 'changed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: async ({ value, formApi }) => {
      setStatus('idle');
      if (value.newPassword.length < 12) {
        setError('errors.validation.password_length');
        return;
      }
      const r = await props.onChange(value);
      if (r.ok) {
        setError(null);
        setStatus('changed');
        formApi.reset();
        return;
      }
      setError(r.fieldErrors?.password?.[0] ?? r.i18nKey);
    },
  });
  return (
    <section aria-labelledby="password-title" className={panel} data-testid="password-form">
      <h2 id="password-title" className="flex items-center gap-2 text-lg">
        <KeyRound aria-hidden="true" className="size-5 text-primary" />
        {t('profile.password.title')}
      </h2>
      <p className="text-sm text-ink-muted">{t('profile.password.note')}</p>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="currentPassword">
          {(field) => (
            <FormField
              id="password-current"
              label={t('profile.password.current')}
              testId="password-current"
              inputProps={{
                type: 'password',
                autoComplete: 'current-password',
                value: field.state.value,
                onChange: (e) => field.handleChange(e.target.value),
              }}
            />
          )}
        </form.Field>
        <form.Field name="newPassword">
          {(field) => (
            <FormField
              id="password-new"
              label={t('profile.password.new')}
              hint={t('profile.password.newHint')}
              testId="password-new"
              inputProps={{
                type: 'password',
                autoComplete: 'new-password',
                minLength: 12,
                value: field.state.value,
                onChange: (e) => field.handleChange(e.target.value),
              }}
            />
          )}
        </form.Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="outline" data-testid="password-save">
            {t('profile.password.save')}
          </Button>
          {status === 'changed' ? (
            <p role="status" className="text-sm font-semibold text-pass">
              {t('profile.password.changed')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="password-error">
              {tDynamic(error)}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
