// S11 SignUpForm (UC1): shares SignUpInput with the server; neutral "check your email" in every case.
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SignUpInput } from '../server/auth.schema.ts';
import { firstFieldErrors, postAuth } from './auth-client.ts';
import { FormField } from './FormField.tsx';
import { schemaFieldErrors } from './form-errors.ts';

export function SignUpForm() {
  const { t, tDynamic, locale } = useI18n();
  const [isDone, setIsDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const form = useForm({
    defaultValues: { email: '', password: '', name: '' },
    validators: {
      onSubmit: ({ value }) =>
        schemaFieldErrors(SignUpInput, value)
          ? { fields: schemaFieldErrors(SignUpInput, value) }
          : undefined,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await postAuth('/api/auth/sign-up/email', { ...value, locale });
      if (result.ok) setIsDone(true);
      else {
        setServerFieldErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.i18nKey);
      }
    },
  });

  if (isDone) {
    return (
      <Alert data-testid="sign-up-check-email" role="status">
        <AlertDescription>{t('auth.signUp.checkEmail')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="sign-up-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <FormField
            id="sign-up-email"
            label={t('auth.field.email')}
            testId="sign-up-email"
            error={
              field.state.meta.errors[0]
                ? tDynamic(String(field.state.meta.errors[0]))
                : serverFieldErrors.email
                  ? tDynamic(serverFieldErrors.email)
                  : undefined
            }
            inputProps={{
              type: 'email',
              autoComplete: 'email',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
              onBlur: field.handleBlur,
            }}
          />
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <FormField
            id="sign-up-password"
            label={t('auth.field.password')}
            testId="sign-up-password"
            hint={t('auth.signUp.passwordHint', { count: field.state.value.length })}
            error={
              field.state.meta.errors[0]
                ? tDynamic('errors.validation.password_length')
                : serverFieldErrors.password
                  ? tDynamic(serverFieldErrors.password)
                  : undefined
            }
            inputProps={{
              type: 'password',
              autoComplete: 'new-password',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
              onBlur: field.handleBlur,
            }}
          />
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <FormField
            id="sign-up-name"
            label={t('auth.field.name')}
            testId="sign-up-name"
            inputProps={{
              autoComplete: 'nickname',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="sign-up-form-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button size="lg" type="submit" disabled={isSubmitting} data-testid="sign-up-submit">
            {t('auth.signUp.submit')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
