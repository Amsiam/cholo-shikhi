// UC5: reset request (neutral confirmation) and new-password form ("link expired" on a bad link).
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordInput, ResetRequestInput } from '../server/auth.schema.ts';
import { postAuth } from './auth-client.ts';
import { FormField } from './FormField.tsx';
import { schemaFieldErrors } from './form-errors.ts';

export function ResetRequestForm() {
  const { t, tDynamic } = useI18n();
  const [status, setStatus] = useState<'idle' | 'sent'>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { email: '' },
    validators: {
      onSubmit: ({ value }) =>
        schemaFieldErrors(ResetRequestInput, value)
          ? { fields: schemaFieldErrors(ResetRequestInput, value) }
          : undefined,
    },
    onSubmit: async ({ value }) => {
      const result = await postAuth('/api/auth/request-password-reset', value);
      if (result.ok) setStatus('sent');
      else setFormError(result.i18nKey);
    },
  });
  if (status === 'sent') {
    return (
      <Alert role="status" data-testid="reset-request-sent">
        <AlertDescription>{t('auth.reset.checkEmail')}</AlertDescription>
      </Alert>
    );
  }
  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="reset-request-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <FormField
            id="reset-email"
            label={t('auth.field.email')}
            testId="reset-request-email"
            error={
              field.state.meta.errors[0] ? tDynamic(String(field.state.meta.errors[0])) : undefined
            }
            inputProps={{
              type: 'email',
              autoComplete: 'email',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(formError)}
        </p>
      ) : null}
      <Button size="lg" type="submit" data-testid="reset-request-submit">
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}

export function ResetPasswordForm(props: { token: string }) {
  const { t, tDynamic } = useI18n();
  const [isDone, setIsDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { newPassword: '' },
    validators: {
      onSubmit: ({ value }) =>
        PasswordInput.safeParse(value.newPassword).success
          ? undefined
          : { fields: { newPassword: 'errors.validation.password_length' } },
    },
    onSubmit: async ({ value }) => {
      const result = await postAuth('/api/auth/reset-password', {
        token: props.token,
        newPassword: value.newPassword,
      });
      if (result.ok) setIsDone(true);
      else setFormError(result.i18nKey);
    },
  });
  if (isDone) {
    return (
      <Alert role="status" data-testid="reset-password-done">
        <AlertDescription>{t('auth.reset.done')}</AlertDescription>
      </Alert>
    );
  }
  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="reset-password-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="newPassword">
        {(field) => (
          <FormField
            id="reset-new-password"
            label={t('auth.field.newPassword')}
            testId="reset-password-new"
            hint={t('auth.signUp.passwordHint', { count: field.state.value.length })}
            error={
              field.state.meta.errors[0] ? tDynamic(String(field.state.meta.errors[0])) : undefined
            }
            inputProps={{
              type: 'password',
              autoComplete: 'new-password',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="reset-password-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <Button size="lg" type="submit" data-testid="reset-password-submit">
        {t('auth.reset.save')}
      </Button>
    </form>
  );
}

export function ResendVerificationForm() {
  const { t } = useI18n();
  const [isSent, setIsSent] = useState(false);
  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      await postAuth('/api/identity/resend-verification', value);
      setIsSent(true);
    },
  });
  if (isSent)
    return (
      <p role="status" data-testid="verify-resent">
        {t('auth.verify.resent')}
      </p>
    );
  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="verify-resend-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <FormField
            id="verify-email"
            label={t('auth.field.email')}
            testId="verify-resend-email"
            inputProps={{
              type: 'email',
              autoComplete: 'email',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      <Button size="lg" type="submit" data-testid="verify-resend-submit">
        {t('auth.verify.resend')}
      </Button>
    </form>
  );
}
