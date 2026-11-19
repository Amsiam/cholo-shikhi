// A9 subscription plans (UC18, US2.8; Admin with two-step only, BR10.11): a server-paged TanStack
// Table of the plans and a TanStack Form editor. The items are picked in a TanStack Table of the
// published courses and exam packages of the plan's Goal (BR10.1, BR10.5); the monthly price is a
// taka string checked against the plan ceiling by the server (BR5.9). Edits of a published plan are
// draft changes until the next publish creates a new version (BR10.6).
import { useForm } from '@tanstack/react-form';
import { useEffect, useState } from 'react';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { SavePlanInput as SaveInput } from '../server/catalog-products.schema.ts';
import { SavePlanInput } from '../server/catalog-products.schema.ts';
import type { PlanAdminRow } from '../server/catalog-products.types.ts';
import type { GoalChoice } from './ExamPackagesAdmin.tsx';
import {
  ChoiceField,
  FieldError,
  firstErrors,
  localTitle,
  type SaveOutcome,
  TextField,
} from './fields.tsx';
import {
  type ProductAction,
  ProductActions,
  poishaToTakaInput,
  StatusBadge,
} from './product-fields.tsx';

export type { PlanAdminRow };

export type PlanCandidate = {
  type: 'course' | 'exam_package';
  id: string;
  titleBn: string;
  titleEn: string;
};

export type PlansAdminProps = {
  rows: PlanAdminRow[];
  total: number;
  paging: { page: number; pages: number; onPage: (page: number) => void };
  goals: GoalChoice[];
  loadCandidates: (goalId: string) => Promise<PlanCandidate[]>;
  onSave: (input: SaveInput) => Promise<SaveOutcome>;
  onAction: (action: ProductAction, row: PlanAdminRow) => Promise<SaveOutcome>;
};

type Draft = {
  goalId: string;
  nameBn: string;
  nameEn: string;
  monthlyPrice: string;
  selected: string[];
};

const key = (item: { type: string; id: string }) => `${item.type}:${item.id}`;

/** The editor's form value as the shared schema's input. */
export function toPlanInput(draft: Draft, row: PlanAdminRow | null): SaveInput {
  const pick = (type: string) =>
    draft.selected.filter((k) => k.startsWith(`${type}:`)).map((k) => k.slice(type.length + 1));
  return {
    ...(row ? { planId: row.planId, expectedVersion: row.version } : {}),
    goalId: draft.goalId,
    nameBn: draft.nameBn,
    nameEn: draft.nameEn,
    monthlyPrice: draft.monthlyPrice,
    courseIds: pick('course'),
    examPackageIds: pick('exam_package'),
  };
}

function ItemPicker(props: {
  candidates: PlanCandidate[] | null;
  selected: string[];
  onChange: (selected: string[]) => void;
  error?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const toggle = (k: string) =>
    props.onChange(
      props.selected.includes(k) ? props.selected.filter((x) => x !== k) : [...props.selected, k],
    );
  const columns: Array<Column<PlanCandidate>> = [
    {
      id: 'include',
      header: () => t('catalog.product.plan.include'),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-5"
          checked={props.selected.includes(key(row.original))}
          onChange={() => toggle(key(row.original))}
          aria-label={t('catalog.product.plan.includeItem', {
            item: localTitle(row.original, locale),
          })}
          data-testid="plan-item-checkbox"
        />
      ),
    },
    {
      id: 'title',
      header: () => t('catalog.product.column.title'),
      cell: ({ row }) => localTitle(row.original, locale),
    },
    {
      id: 'type',
      header: () => t('catalog.product.plan.itemType'),
      cell: ({ row }) =>
        row.original.type === 'course'
          ? t('catalog.browse.tab.courses')
          : t('catalog.browse.tab.exam_packages'),
    },
  ];
  return (
    <fieldset className="grid gap-2" data-testid="plan-items">
      <legend className="text-sm font-medium">{t('catalog.product.plan.items')}</legend>
      {props.candidates === null ? (
        <p role="status">{t('catalog.product.loading')}</p>
      ) : (
        <DataTable
          testId="plan-items-table"
          columns={columns}
          rows={props.candidates}
          emptyText={t('catalog.product.plan.noCandidates')}
        />
      )}
      <FieldError id="plan-items-error" error={props.error} testId="plan-items-error" />
    </fieldset>
  );
}

function PlanEditor(props: {
  row: PlanAdminRow | null;
  goals: GoalChoice[];
  loadCandidates: PlansAdminProps['loadCandidates'];
  onSave: PlansAdminProps['onSave'];
  onDone: () => void;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlanCandidate[] | null>(null);
  const initial: Draft = {
    goalId: props.row?.goalId ?? props.goals[0]?.goalId ?? '',
    nameBn: props.row?.nameBn ?? '',
    nameEn: props.row?.nameEn ?? '',
    monthlyPrice: poishaToTakaInput(props.row?.monthlyPricePoisha ?? null),
    selected: [
      ...(props.row?.courseIds ?? []).map((id) => key({ type: 'course', id })),
      ...(props.row?.examPackageIds ?? []).map((id) => key({ type: 'exam_package', id })),
    ],
  };
  const [goalId, setGoalId] = useState(initial.goalId);
  const { loadCandidates } = props;
  useEffect(() => {
    if (!goalId) return;
    let isCurrent = true;
    setCandidates(null);
    loadCandidates(goalId).then(
      (list) => {
        if (isCurrent) setCandidates(list);
      },
      () => {
        if (isCurrent) setCandidates([]);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [goalId, loadCandidates]);

  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      const input = toPlanInput(value, props.row);
      const local = firstErrors(SavePlanInput, input);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onSave(input);
      if (outcome) {
        const merged = firstErrors(SavePlanInput, input, outcome.fieldErrors);
        // The pricing rules name the field `price`; on this form it is the monthly price.
        if (merged.price) merged.monthlyPrice = merged.price;
        setErrors(merged);
        setMessage(tDynamic(outcome.i18nKey));
        return;
      }
      props.onDone();
    },
  });

  return (
    <form
      className="grid gap-4 rounded-lg border p-4"
      data-testid="plan-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h2 className="text-lg font-semibold">
        {props.row ? t('catalog.product.plan.edit') : t('catalog.product.plan.new')}
      </h2>
      {props.row?.hasCurrentVersion ? (
        <p className="text-sm text-muted-foreground" data-testid="plan-editor-version-note">
          {t('catalog.product.plan.versionNote')}
        </p>
      ) : null}
      {props.row ? null : (
        <form.Field name="goalId">
          {(f) => (
            <ChoiceField
              legend={t('catalog.product.goal')}
              value={f.state.value}
              options={props.goals.map((g) => ({
                value: g.goalId,
                label: locale === 'bn' ? g.nameBn : g.nameEn,
              }))}
              onChange={(value) => {
                f.handleChange(value);
                form.setFieldValue('selected', []);
                setGoalId(value);
              }}
              error={errors.goalId}
              testId="plan-editor-goal"
            />
          )}
        </form.Field>
      )}
      <form.Field name="nameBn">
        {(f) => (
          <TextField
            label={t('catalog.product.plan.nameBn')}
            lang="bn"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.nameBn}
            testId="plan-editor-name-bn"
          />
        )}
      </form.Field>
      <form.Field name="nameEn">
        {(f) => (
          <TextField
            label={t('catalog.product.plan.nameEn')}
            lang="en"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.nameEn}
            testId="plan-editor-name-en"
          />
        )}
      </form.Field>
      <form.Field name="monthlyPrice">
        {(f) => (
          <TextField
            label={t('catalog.product.plan.monthlyPrice')}
            inputMode="decimal"
            value={f.state.value}
            onChange={f.handleChange}
            error={errors.monthlyPrice}
            hint={t('catalog.product.priceHint')}
            testId="plan-editor-price"
          />
        )}
      </form.Field>
      <form.Field name="selected">
        {(f) => (
          <ItemPicker
            candidates={candidates}
            selected={f.state.value}
            onChange={f.handleChange}
            error={errors.items ?? errors.courseIds ?? errors.examPackageIds}
          />
        )}
      </form.Field>
      {message ? (
        <p role="alert" className="text-sm text-destructive" data-testid="plan-editor-message">
          {message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" data-testid="plan-editor-save">
          {t('catalog.product.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onDone}
          data-testid="plan-editor-cancel"
        >
          {t('catalog.instructor.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function PlansAdmin(props: PlansAdminProps) {
  const { t, locale, formatInteger } = useI18n();
  const [editing, setEditing] = useState<PlanAdminRow | 'new' | null>(null);
  const columns: Array<Column<PlanAdminRow>> = [
    {
      id: 'name',
      header: () => t('catalog.product.column.title'),
      cell: ({ row }) => (locale === 'bn' ? row.original.nameBn : row.original.nameEn),
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
      header: () => t('catalog.product.plan.monthlyPrice'),
      cell: ({ row }) =>
        row.original.monthlyPricePoisha === null
          ? t('catalog.instructor.notSet')
          : t('catalog.browse.perMonth', {
              price: formatMoney(row.original.monthlyPricePoisha as MoneyPoisha, locale),
            }),
    },
    {
      id: 'items',
      header: () => t('catalog.product.plan.items'),
      cell: ({ row }) =>
        formatInteger(row.original.courseIds.length + row.original.examPackageIds.length),
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
              data-testid="plan-row-edit"
            >
              {t('catalog.product.edit')}
            </Button>
          )}
          <ProductActions
            status={row.original.status}
            hasUnpublishedChanges={row.original.hasUnpublishedChanges}
            onAction={(action) => props.onAction(action, row.original)}
            testId="plan-row"
          />
        </div>
      ),
    },
  ];
  return (
    <div className="grid gap-4" data-testid="plans-admin">
      {editing ? (
        <PlanEditor
          key={editing === 'new' ? 'new' : editing.planId}
          row={editing === 'new' ? null : editing}
          goals={props.goals}
          loadCandidates={props.loadCandidates}
          onSave={props.onSave}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button
          type="button"
          className="w-fit"
          disabled={props.goals.length === 0}
          onClick={() => setEditing('new')}
          data-testid="plans-new"
        >
          {t('catalog.product.plan.new')}
        </Button>
      )}
      <DataTable
        testId="plans-table"
        columns={columns}
        rows={props.rows}
        emptyText={t('catalog.product.plan.empty')}
        paging={props.paging}
      />
    </div>
  );
}
