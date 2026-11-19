// I1 new-course form (UC7, US3.1): both titles, an active Goal and optional sections, with TanStack
// Form validated by the same Zod schema as the server (BR4.2) plus the domain title rule (BR3.1).
// Field errors are linked and announced (NFR7.201).
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { validateTitles } from '../domain/course.ts';
import { CreateCourseInput } from '../server/catalog.schema.ts';
import {
  ChoiceField,
  type FieldErrorMap,
  firstErrors,
  type SaveOutcome,
  TextField,
} from './fields.tsx';

export type GoalOption = { goalId: string; nameBn: string; nameEn: string };
export type NewCourseDraft = {
  goalId: string;
  titleBn: string;
  titleEn: string;
  /** `key` is a client-only row identity; the shared schema drops it. */
  sections: Array<{ key: string; titleBn: string; titleEn: string }>;
};

let nextKey = 0;

export const EMPTY_COURSE: NewCourseDraft = { goalId: '', titleBn: '', titleEn: '', sections: [] };

function domainErrors(draft: NewCourseDraft) {
  const errors: Record<string, readonly string[]> = {};
  const course = validateTitles(draft);
  if (!course.ok) Object.assign(errors, course.error.fieldErrors);
  draft.sections.forEach((section, index) => {
    const valid = validateTitles(section, `sections.${index}.`);
    if (!valid.ok) Object.assign(errors, valid.error.fieldErrors);
  });
  return errors;
}

export function NewCourseForm(props: {
  goals: GoalOption[];
  onCreate: (input: NewCourseDraft) => Promise<SaveOutcome>;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: EMPTY_COURSE,
    onSubmit: async ({ value }) => {
      const local = firstErrors(CreateCourseInput, value, domainErrors(value));
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onCreate(value);
      setFormError(outcome ? outcome.i18nKey : null);
      if (outcome) setErrors(firstErrors(CreateCourseInput, value, outcome.fieldErrors));
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      data-testid="new-course-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="goalId">
        {(field) => (
          <ChoiceField
            legend={t('catalog.instructor.new.goal')}
            value={field.state.value}
            onChange={field.handleChange}
            options={props.goals.map((g) => ({
              value: g.goalId,
              label: locale === 'bn' ? g.nameBn : g.nameEn,
            }))}
            error={errors.goalId}
            testId="new-course-form-goal"
          />
        )}
      </form.Field>
      <form.Field name="titleBn">
        {(field) => (
          <TextField
            label={t('catalog.instructor.field.titleBn')}
            lang="bn"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.titleBn}
            testId="new-course-form-title-bn"
          />
        )}
      </form.Field>
      <form.Field name="titleEn">
        {(field) => (
          <TextField
            label={t('catalog.instructor.field.titleEn')}
            lang="en"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.titleEn}
            testId="new-course-form-title-en"
          />
        )}
      </form.Field>
      <form.Field name="sections" mode="array">
        {(sections) => (
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">
              {t('catalog.instructor.sections.title')}
            </legend>
            {sections.state.value.map((section, index) => (
              <div
                key={section.key}
                className="grid gap-2 sm:grid-cols-2"
                data-testid="new-course-form-section"
              >
                <form.Field name={`sections[${index}].titleBn`}>
                  {(field) => (
                    <TextField
                      label={t('catalog.instructor.field.sectionTitleBn', { n: index + 1 })}
                      lang="bn"
                      value={field.state.value}
                      onChange={field.handleChange}
                      error={errors[`sections.${index}.titleBn`]}
                      testId="new-course-form-section-title-bn"
                    />
                  )}
                </form.Field>
                <form.Field name={`sections[${index}].titleEn`}>
                  {(field) => (
                    <TextField
                      label={t('catalog.instructor.field.sectionTitleEn', { n: index + 1 })}
                      lang="en"
                      value={field.state.value}
                      onChange={field.handleChange}
                      error={errors[`sections.${index}.titleEn`]}
                      testId="new-course-form-section-title-en"
                    />
                  )}
                </form.Field>
              </div>
            ))}
            <Button
              size="lg"
              type="button"
              variant="outline"
              data-testid="new-course-form-add-section"
              onClick={() => {
                nextKey += 1;
                sections.pushValue({ key: `section-${nextKey}`, titleBn: '', titleEn: '' });
              }}
            >
              {t('catalog.instructor.sections.add')}
            </Button>
          </fieldset>
        )}
      </form.Field>
      {formError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="new-course-form-error">
          {tDynamic(formError)}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-fit justify-self-start"
        data-testid="new-course-form-submit"
      >
        {t('catalog.instructor.new.submit')}
      </Button>
    </form>
  );
}
