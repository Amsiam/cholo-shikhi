// A4 Goal create/edit form (UC4, US1.15) with TanStack Form, validated with the shared Zod schema
// and the domain field rules (BR1.3). A missing Bangla or English name is a field error, announced.
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { validateGoalFields } from '../domain/goals.ts';
import { GoalSaveInput } from '../server/goals.schema.ts';
import {
  ChoiceField,
  type FieldErrorMap,
  firstErrors,
  type SaveOutcome,
  TextField,
} from './admin-fields.tsx';
import { localName, type Named } from './goal-choice.tsx';

export type GoalDraft = {
  goalId?: string;
  expectedVersion?: number;
  segmentId: string;
  nameBn: string;
  nameEn: string;
  status: 'inactive' | 'active';
  sortOrder: string;
};

function toInput(draft: GoalDraft) {
  return { ...draft, sortOrder: Number(draft.sortOrder === '' ? Number.NaN : draft.sortOrder) };
}

export function GoalForm(props: {
  initial: GoalDraft;
  segments: Array<Named & { segmentId: string }>;
  onSave: (input: ReturnType<typeof toInput>) => Promise<SaveOutcome>;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: props.initial,
    onSubmit: async ({ value }) => {
      const input = toInput(value);
      const domain = validateGoalFields(input, { isSegmentKnown: input.segmentId !== '' });
      const local = firstErrors(
        GoalSaveInput,
        input,
        domain.ok ? undefined : domain.error.fieldErrors,
      );
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onSave(input);
      setFormError(outcome ? outcome.i18nKey : null);
      if (outcome) setErrors(firstErrors(GoalSaveInput, input, outcome.fieldErrors));
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="segmentId">
        {(field) => (
          <ChoiceField
            legend={t('goals.admin.goals.segment')}
            value={field.state.value}
            onChange={field.handleChange}
            options={props.segments.map((s) => ({
              value: s.segmentId,
              label: localName(s, locale),
            }))}
            error={errors.segmentId}
            testId="goal-form-segment"
          />
        )}
      </form.Field>
      <form.Field name="nameBn">
        {(field) => (
          <TextField
            label={t('goals.admin.field.nameBn')}
            lang="bn"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.nameBn}
            testId="goal-form-name-bn"
          />
        )}
      </form.Field>
      <form.Field name="nameEn">
        {(field) => (
          <TextField
            label={t('goals.admin.field.nameEn')}
            lang="en"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.nameEn}
            testId="goal-form-name-en"
          />
        )}
      </form.Field>
      <form.Field name="status">
        {(field) => (
          <ChoiceField
            legend={t('goals.admin.goals.status')}
            value={field.state.value}
            onChange={(value) => field.handleChange(value as GoalDraft['status'])}
            options={[
              { value: 'inactive', label: t('goals.admin.goals.status.inactive') },
              { value: 'active', label: t('goals.admin.goals.status.active') },
            ]}
            testId="goal-form-status"
          />
        )}
      </form.Field>
      <form.Field name="sortOrder">
        {(field) => (
          <TextField
            label={t('goals.admin.field.sortOrder')}
            inputMode="numeric"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.sortOrder}
            testId="goal-form-sort-order"
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="goal-form-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <Button size="lg" type="submit" data-testid="goal-form-submit">
        {t('goals.admin.goals.save')}
      </Button>
    </form>
  );
}
