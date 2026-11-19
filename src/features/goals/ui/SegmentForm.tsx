// A4 segment create/edit form (UC3, US1.16) with TanStack Form. It validates with the shared Zod
// schema and the domain field rules, and asks for confirmation before a type change (BR1.6).
import { useForm } from '@tanstack/react-form';
import { useRef, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { validateSegmentFields } from '../domain/goals.ts';
import { SegmentSaveInput } from '../server/goals.schema.ts';
import {
  ChoiceField,
  ConfirmDialog,
  type FieldErrorMap,
  firstErrors,
  type SaveOutcome,
  TextField,
} from './admin-fields.tsx';

export type SegmentDraft = {
  segmentId?: string;
  expectedVersion?: number;
  nameBn: string;
  nameEn: string;
  segmentType: 'academic' | 'job_aspirant';
  battleBand: string;
  sortOrder: string;
};

export const EMPTY_SEGMENT: SegmentDraft = {
  nameBn: '',
  nameEn: '',
  segmentType: 'academic',
  battleBand: '',
  sortOrder: '0',
};

function toInput(draft: SegmentDraft) {
  return { ...draft, sortOrder: Number(draft.sortOrder === '' ? Number.NaN : draft.sortOrder) };
}

export function SegmentForm(props: {
  initial: SegmentDraft;
  originalType?: SegmentDraft['segmentType'];
  onSave: (input: ReturnType<typeof toInput>) => Promise<SaveOutcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const isTypeChangeConfirmed = useRef(false);

  async function submit(draft: SegmentDraft) {
    const input = toInput(draft);
    const domain = validateSegmentFields(input);
    const local = firstErrors(
      SegmentSaveInput,
      input,
      domain.ok ? undefined : domain.error.fieldErrors,
    );
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    const outcome = await props.onSave(input);
    if (!outcome) {
      setFormError(null);
      return;
    }
    setErrors(firstErrors(SegmentSaveInput, input, outcome.fieldErrors));
    setFormError(outcome.i18nKey);
  }

  const form = useForm({
    defaultValues: props.initial,
    onSubmit: async ({ value }) => {
      const isTypeChange =
        value.segmentId !== undefined &&
        props.originalType !== undefined &&
        value.segmentType !== props.originalType;
      if (isTypeChange && !isTypeChangeConfirmed.current) {
        setIsConfirming(true);
        return;
      }
      isTypeChangeConfirmed.current = false;
      await submit(value);
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="segment-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="nameBn">
        {(field) => (
          <TextField
            label={t('goals.admin.field.nameBn')}
            lang="bn"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.nameBn}
            testId="segment-form-name-bn"
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
            testId="segment-form-name-en"
          />
        )}
      </form.Field>
      <form.Field name="segmentType">
        {(field) => (
          <ChoiceField
            legend={t('goals.admin.segments.type')}
            value={field.state.value}
            onChange={(value) => field.handleChange(value as SegmentDraft['segmentType'])}
            options={[
              { value: 'academic', label: t('goals.admin.segments.type.academic') },
              { value: 'job_aspirant', label: t('goals.admin.segments.type.job_aspirant') },
            ]}
            error={errors.segmentType}
            testId="segment-form-type"
          />
        )}
      </form.Field>
      <form.Field name="battleBand">
        {(field) => (
          <TextField
            label={t('goals.admin.segments.battleBand')}
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.battleBand}
            testId="segment-form-battle-band"
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
            testId="segment-form-sort-order"
          />
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="segment-form-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <Button size="lg" type="submit" data-testid="segment-form-submit">
        {t('goals.admin.segments.save')}
      </Button>
      <ConfirmDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title={t('goals.admin.segments.type')}
        description={t('goals.admin.segments.typeChangeConfirm')}
        confirmLabel={t('goals.admin.confirm')}
        onConfirm={() => {
          isTypeChangeConfirmed.current = true;
          setIsConfirming(false);
          void form.handleSubmit();
        }}
        testId="segment-form-type-confirm"
      />
    </form>
  );
}
