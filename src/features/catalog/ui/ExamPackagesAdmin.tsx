// A12 exam packages (UC17, US2.28; Admin with two-step only, BR10.11): a server-paged TanStack Table
// of the packages and a TanStack Form editor validated with the shared schema, then the server's
// rules. The question picker is a slot the A12 route fills with Assessment's picker once U4 ships;
// until then it is a list of question IDs. Edits of a published package are draft changes until the
// next publish creates a new version (BR10.3). Prices go through formatMoney (BR5.8).
import { useForm } from '@tanstack/react-form';
import { type ReactNode, useState } from 'react';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { SaveExamPackageInput as SaveInput } from '../server/catalog-products.schema.ts';
import { SaveExamPackageInput } from '../server/catalog-products.schema.ts';
import type { ExamPackageAdminRow } from '../server/catalog-products.types.ts';
import { ChoiceField, firstErrors, localTitle, type SaveOutcome, TextField } from './fields.tsx';
import {
  IdListField,
  type ProductAction,
  ProductActions,
  poishaToTakaInput,
  StatusBadge,
} from './product-fields.tsx';

export type { ExamPackageAdminRow };
export type GoalChoice = { goalId: string; nameBn: string; nameEn: string };

export type QuestionPickerSlot = (field: {
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string | undefined;
}) => ReactNode;

export type ExamPackagesAdminProps = {
  rows: ExamPackageAdminRow[];
  total: number;
  paging: { page: number; pages: number; onPage: (page: number) => void };
  goals: GoalChoice[];
  /** Assessment's question picker (U4); the ID list is the fallback. */
  renderQuestionPicker?: QuestionPickerSlot;
  onSave: (input: SaveInput) => Promise<SaveOutcome>;
  onAction: (action: ProductAction, row: ExamPackageAdminRow) => Promise<SaveOutcome>;
};

type Draft = {
  goalId: string;
  titleBn: string;
  titleEn: string;
  price: string;
  timeLimit: string;
  questionIds: string[];
};

function draftOf(row: ExamPackageAdminRow | null, goals: GoalChoice[]): Draft {
  return {
    goalId: row?.goalId ?? goals[0]?.goalId ?? '',
    titleBn: row?.titleBn ?? '',
    titleEn: row?.titleEn ?? '',
    price: poishaToTakaInput(row?.listPricePoisha ?? null),
    timeLimit: row?.timeLimitMinutes ? String(row.timeLimitMinutes) : '',
    questionIds: row?.questionIds ?? [],
  };
}

/** The editor's form value as the shared schema's input; a non-number time limit stays invalid. */
export function toSaveInput(draft: Draft, row: ExamPackageAdminRow | null): SaveInput {
  const limit = draft.timeLimit.trim();
  return {
    ...(row ? { examPackageId: row.examPackageId, expectedVersion: row.version } : {}),
    goalId: draft.goalId,
    titleBn: draft.titleBn,
    titleEn: draft.titleEn,
    price: draft.price,
    questionIds: draft.questionIds,
    timeLimitMinutes: limit === '' ? null : /^[0-9]+$/.test(limit) ? Number(limit) : Number.NaN,
  };
}

function ExamEditor(props: {
  row: ExamPackageAdminRow | null;
  goals: GoalChoice[];
  renderQuestionPicker?: QuestionPickerSlot;
  onSave: ExamPackagesAdminProps['onSave'];
  onDone: () => void;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({
    defaultValues: draftOf(props.row, props.goals),
    onSubmit: async ({ value }) => {
      const input = toSaveInput(value, props.row);
      const local = firstErrors(SaveExamPackageInput, input);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onSave(input);
      if (outcome) {
        setErrors(firstErrors(SaveExamPackageInput, input, outcome.fieldErrors));
        setMessage(tDynamic(outcome.i18nKey));
        return;
      }
      props.onDone();
    },
  });
  const picker: QuestionPickerSlot =
    props.renderQuestionPicker ??
    ((field) => (
      <IdListField
        label={t('catalog.product.exam.questions')}
        hint={t('catalog.product.exam.questionsHint')}
        value={field.value}
        onChange={field.onChange}
        error={field.error}
        testId="exam-editor-questions"
      />
    ));
  return (
    <form
      className="grid gap-4 rounded-lg border p-4"
      data-testid="exam-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h2 className="text-lg font-semibold">
        {props.row ? t('catalog.product.exam.edit') : t('catalog.product.exam.new')}
      </h2>
      {props.row?.hasCurrentVersion ? (
        <p className="text-sm text-muted-foreground" data-testid="exam-editor-version-note">
          {t('catalog.product.versionNote')}
        </p>
      ) : null}
      <form.Field name="goalId">
        {(f) => (
          <ChoiceField
            legend={t('catalog.product.goal')}
            value={f.state.value}
            options={props.goals.map((g) => ({
              value: g.goalId,
              label: locale === 'bn' ? g.nameBn : g.nameEn,
            }))}
            onChange={f.handleChange}
            error={errors.goalId}
            testId="exam-editor-goal"
          />
        )}
      </form.Field>
      <form.Field name="titleBn">
        {(f) => (
          <TextField
            label={t('catalog.instructor.field.titleBn')}
            lang="bn"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.titleBn}
            testId="exam-editor-title-bn"
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
            testId="exam-editor-title-en"
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
            testId="exam-editor-price"
          />
        )}
      </form.Field>
      <form.Field name="timeLimit">
        {(f) => (
          <TextField
            label={t('catalog.product.exam.timeLimit')}
            inputMode="decimal"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.timeLimitMinutes}
            testId="exam-editor-time-limit"
          />
        )}
      </form.Field>
      <form.Field name="questionIds">
        {(f) =>
          picker({ value: f.state.value, onChange: f.handleChange, error: errors.questionIds })
        }
      </form.Field>
      {message ? (
        <p role="alert" className="text-sm text-destructive" data-testid="exam-editor-message">
          {message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" data-testid="exam-editor-save">
          {t('catalog.product.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onDone}
          data-testid="exam-editor-cancel"
        >
          {t('catalog.instructor.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function ExamPackagesAdmin(props: ExamPackagesAdminProps) {
  const { t, locale, formatInteger } = useI18n();
  const [editing, setEditing] = useState<ExamPackageAdminRow | 'new' | null>(null);
  const columns: Array<Column<ExamPackageAdminRow>> = [
    {
      id: 'title',
      header: () => t('catalog.product.column.title'),
      cell: ({ row }) => localTitle(row.original, locale),
    },
    {
      id: 'status',
      header: () => t('catalog.product.column.status'),
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          hasUnpublishedChanges={row.original.hasUnpublishedChanges}
        />
      ),
    },
    {
      id: 'price',
      header: () => t('catalog.product.column.price'),
      cell: ({ row }) => formatMoney(row.original.listPricePoisha as MoneyPoisha, locale),
    },
    {
      id: 'questions',
      header: () => t('catalog.product.column.questions'),
      cell: ({ row }) => formatInteger(row.original.questionIds.length),
    },
    {
      id: 'actions',
      header: () => t('catalog.product.column.actions'),
      cell: ({ row }) => (
        <div className="grid gap-2">
          {row.original.status === 'retired' ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setEditing(row.original)}
              data-testid="exam-row-edit"
            >
              {t('catalog.product.edit')}
            </Button>
          )}
          <ProductActions
            status={row.original.status}
            hasUnpublishedChanges={row.original.hasUnpublishedChanges}
            onAction={(action) => props.onAction(action, row.original)}
            testId="exam-row"
          />
        </div>
      ),
    },
  ];
  return (
    <div className="grid gap-4" data-testid="exam-packages-admin">
      {editing ? (
        <ExamEditor
          key={editing === 'new' ? 'new' : editing.examPackageId}
          row={editing === 'new' ? null : editing}
          goals={props.goals}
          {...(props.renderQuestionPicker
            ? { renderQuestionPicker: props.renderQuestionPicker }
            : {})}
          onSave={props.onSave}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button
          type="button"
          className="w-fit"
          disabled={props.goals.length === 0}
          onClick={() => setEditing('new')}
          data-testid="exam-packages-new"
        >
          {t('catalog.product.exam.new')}
        </Button>
      )}
      <DataTable
        testId="exam-packages-table"
        columns={columns}
        rows={props.rows}
        emptyText={t('catalog.product.exam.empty')}
        paging={props.paging}
      />
    </div>
  );
}
