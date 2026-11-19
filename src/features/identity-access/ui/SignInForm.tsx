// S11 SignInForm (UC3): generic incorrect message, offline message, sign-out-first notice.
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { SignInInput } from '../server/auth.schema.ts';
import { postAuth } from './auth-client.ts';
import { FormField } from './FormField.tsx';
import { schemaFieldErrors } from './form-errors.ts';

export function SignInForm(props: { onSignedIn: (next: string) => void | Promise<void> }) {
  const { t, tDynamic } = useI18n();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: {
      onSubmit: ({ value }) =>
        schemaFieldErrors(SignInInput, value)
          ? {
              fields: {
                email: 'errors.validation.required',
                password: 'errors.validation.required',
              },
            }
          : undefined,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await postAuth<{ next?: string }>('/api/auth/sign-in/email', value);
      if (result.ok) await props.onSignedIn(result.body.next ?? '/');
      else setFormError(result.i18nKey);
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="sign-in-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <FormField
            id="sign-in-email"
            label={t('auth.field.email')}
            testId="sign-in-email"
            error={
              field.state.meta.errors[0] && !field.state.value
                ? tDynamic(String(field.state.meta.errors[0]))
                : undefined
            }
            inputProps={{
              type: 'email',
              autoComplete: 'username',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <FormField
            id="sign-in-password"
            label={t('auth.field.password')}
            testId="sign-in-password"
            error={
              field.state.meta.errors[0] && !field.state.value
                ? tDynamic(String(field.state.meta.errors[0]))
                : undefined
            }
            inputProps={{
              type: 'password',
              autoComplete: 'current-password',
              value: field.state.value,
              onChange: (e) => field.handleChange(e.target.value),
            }}
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="sign-in-form-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button size="lg" type="submit" disabled={isSubmitting} data-testid="sign-in-submit">
            {t('auth.signIn.submit')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
