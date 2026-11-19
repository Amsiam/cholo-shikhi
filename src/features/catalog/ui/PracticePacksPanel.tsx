// I1 Practice Packs (UC19, US5.4): the course Lead creates and edits separately priced packs of
// question sets from the course's bank, on a published course only (BR10.9). The route shows this
// panel to the Lead only; the server also refuses everyone else (notLead for a Co-instructor). The
// question-set picker is an ID list until Assessment's picker ships with U4. A published pack
// appears on S4 as a separate item (BR11.8).
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { SavePracticePackInput as SaveInput } from '../server/catalog-products.schema.ts';
import { SavePracticePackInput } from '../server/catalog-products.schema.ts';
import type { PracticePackRowView } from '../server/catalog-products.types.ts';
import { firstErrors, localTitle, type SaveOutcome, TextField } from './fields.tsx';
import {
  IdListField,
  type ProductAction,
  ProductActions,
  poishaToTakaInput,
  StatusBadge,
} from './product-fields.tsx';

export type { PracticePackRowView };

export type PracticePacksPanelProps = {
  courseId: string;
  isCoursePublished: boolean;
  rows: PracticePackRowView[];
  onSave: (input: SaveInput) => Promise<SaveOutcome>;
  onAction: (action: ProductAction, row: PracticePackRowView) => Promise<SaveOutcome>;
  /** The Lead's published mock tests, to pick the pack's tests from (exam builder). */
  testOptions?: ReadonlyArray<{ examId: string; titleBn: string; titleEn: string }>;
};

type Draft = { titleBn: string; titleEn: string; price: string; questionSetIds: string[] };

/** The pack's contents: the Lead's published mock tests, ticked. */
function MockTestPicker(props: {
  options: NonNullable<PracticePacksPanelProps['testOptions']>;
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2" data-testid="pack-editor-tests">
      <legend className="text-sm font-medium">{t('catalog.product.pack.tests')}</legend>
      <p className="text-xs text-ink-muted">{t('catalog.product.pack.testsHint')}</p>
      {props.options.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('catalog.product.pack.noTests')}</p>
      ) : (
        props.options.map((o) => {
          const isOn = props.value.includes(o.examId);
          return (
            <label
              key={o.examId}
              className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={isOn}
                onChange={() =>
                  props.onChange(
                    isOn ? props.value.filter((x) => x !== o.examId) : [...props.value, o.examId],
                  )
                }
              />
              {locale === 'bn' ? o.titleBn : o.titleEn}
            </label>
          );
        })
      )}
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
    </fieldset>
  );
}

function PackEditor(props: {
  courseId: string;
  row: PracticePackRowView | null;
  onSave: PracticePacksPanelProps['onSave'];
  onDone: () => void;
  testOptions?: PracticePacksPanelProps['testOptions'];
}) {
  const { t, tDynamic } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      titleBn: props.row?.titleBn ?? '',
      titleEn: props.row?.titleEn ?? '',
      price: poishaToTakaInput(props.row?.listPricePoisha ?? null),
      questionSetIds: props.row?.questionSetIds ?? [],
    } as Draft,
    onSubmit: async ({ value }) => {
      const input: SaveInput = {
        ...(props.row
          ? { practicePackId: props.row.practicePackId, expectedVersion: props.row.version }
          : {}),
        courseId: props.courseId,
        ...value,
      };
      const local = firstErrors(SavePracticePackInput, input);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onSave(input);
      if (outcome) {
        setErrors(firstErrors(SavePracticePackInput, input, outcome.fieldErrors));
        setMessage(tDynamic(outcome.i18nKey));
        return;
      }
      props.onDone();
    },
  });
  return (
    <form
      className="grid gap-4 rounded-sm border border-primary/20 bg-background p-4"
      data-testid="pack-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="titleBn">
        {(f) => (
          <TextField
            label={t('catalog.instructor.field.titleBn')}
            lang="bn"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.titleBn}
            testId="pack-editor-title-bn"
          />
        )}
      </form.Field>
      <form.Field name="titleEn">
        {(f) => (
          <TextField
            label={t('catalog.instructor.field.titleEn')}
            lang="en"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.titleEn}
            testId="pack-editor-title-en"
          />
        )}
      </form.Field>
      <form.Field name="price">
        {(f) => (
          <TextField
            label={t('catalog.product.price')}
            inputMode="decimal"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.price}
            hint={t('catalog.product.priceHint')}
            testId="pack-editor-price"
          />
        )}
      </form.Field>
      <form.Field name="questionSetIds">
        {(f) =>
          props.testOptions ? (
            <MockTestPicker
              options={props.testOptions}
              value={f.state.value}
              onChange={f.handleChange}
              error={errors.questionSetIds}
            />
          ) : (
            <IdListField
              label={t('catalog.product.pack.questionSets')}
              hint={t('catalog.product.pack.questionSetsHint')}
              value={f.state.value}
              onChange={f.handleChange}
              error={errors.questionSetIds}
              testId="pack-editor-question-sets"
            />
          )
        }
      </form.Field>
      {message ? (
        <p role="alert" className="text-sm text-destructive" data-testid="pack-editor-message">
          {message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" data-testid="pack-editor-save">
          {t('catalog.product.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onDone}
          data-testid="pack-editor-cancel"
        >
          {t('catalog.instructor.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function PracticePacksPanel(props: PracticePacksPanelProps) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<PracticePackRowView | 'new' | null>(null);
  return (
    <section
      className="grid gap-3 rounded-sm border border-primary/20 bg-background p-4"
      aria-labelledby="practice-packs-heading"
      data-testid="practice-packs-panel"
    >
      <h2 id="practice-packs-heading" className="text-lg font-semibold">
        {t('catalog.course.practicePacks')}
      </h2>
      {props.isCoursePublished ? null : (
        <p role="note" data-testid="practice-packs-unpublished">
          {t('catalog.product.pack.needsPublishedCourse')}
        </p>
      )}
      {props.rows.length === 0 ? (
        <p data-testid="practice-packs-empty">{t('catalog.product.pack.empty')}</p>
      ) : (
        <ul className="grid gap-2" data-testid="practice-packs-list">
          {props.rows.map((row) => (
            <li
              key={row.practicePackId}
              className="grid gap-2 rounded-sm border border-primary/20 bg-background p-4"
              data-testid="practice-pack-row"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium break-words">{localTitle(row, locale)}</span>
                <span data-testid="practice-pack-row-price">
                  {formatMoney(row.listPricePoisha as MoneyPoisha, locale)}
                </span>
              </div>
              <StatusBadge status={row.status} />
              {props.isCoursePublished && row.status !== 'retired' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(row)}
                    data-testid="practice-pack-row-edit"
                  >
                    {t('catalog.product.edit')}
                  </Button>
                  {row.status === 'published' ? null : (
                    <ProductActions
                      status={row.status}
                      hasUnpublishedChanges={false}
                      onAction={(action) => props.onAction(action, row)}
                      testId="practice-pack-row"
                    />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.isCoursePublished ? (
        editing ? (
          <PackEditor
            key={editing === 'new' ? 'new' : editing.practicePackId}
            courseId={props.courseId}
            row={editing === 'new' ? null : editing}
            onSave={props.onSave}
            {...(props.testOptions ? { testOptions: props.testOptions } : {})}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Button
            type="button"
            className="w-fit"
            onClick={() => setEditing('new')}
            data-testid="practice-packs-new"
          >
            {t('catalog.product.pack.new')}
          </Button>
        )
      ) : null}
    </section>
  );
}
