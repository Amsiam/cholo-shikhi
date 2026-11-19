// A4 Goals and segments (UC3, UC4; US1.15, US1.16): two server-paged TanStack Tables with edit,
// delete and retire actions, and the segment and Goal forms. Delete and retire ask first; a refused
// delete states how many Goals are still linked (AC1.16.2).
import { useState } from 'react';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, type SaveOutcome } from './admin-fields.tsx';
import { type GoalDraft, GoalForm } from './GoalForm.tsx';
import { localName } from './goal-choice.tsx';
import { EMPTY_SEGMENT, type SegmentDraft, SegmentForm } from './SegmentForm.tsx';

export type SegmentAdminRow = {
  segmentId: string;
  nameBn: string;
  nameEn: string;
  segmentType: 'academic' | 'job_aspirant';
  battleBand: string;
  sortOrder: number;
  version: number;
  goalCount: number;
};
export type GoalAdminRow = {
  goalId: string;
  segmentId: string;
  nameBn: string;
  nameEn: string;
  status: 'inactive' | 'active' | 'retired';
  sortOrder: number;
  version: number;
};
type Page<T> = { rows: T[]; total: number; page: number };
type Paging = { page: number; pages: number; onPage: (page: number) => void };

export type GoalsAdminProps = {
  segments: Page<SegmentAdminRow> & { paging: Paging };
  goals: Page<GoalAdminRow> & { paging: Paging };
  onSaveSegment: (input: Record<string, unknown>) => Promise<SaveOutcome>;
  onDeleteSegment: (input: { segmentId: string; expectedVersion: number }) => Promise<SaveOutcome>;
  onSaveGoal: (input: Record<string, unknown>) => Promise<SaveOutcome>;
  onRetireGoal: (input: { goalId: string; expectedVersion: number }) => Promise<SaveOutcome>;
};

type Editing =
  | { kind: 'segment'; draft: SegmentDraft; originalType?: SegmentDraft['segmentType'] }
  | { kind: 'goal'; draft: GoalDraft }
  | null;

export function GoalsAdmin(props: GoalsAdminProps) {
  const { t, tDynamic, locale } = useI18n();
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<SegmentAdminRow | null>(null);
  const [toRetire, setToRetire] = useState<GoalAdminRow | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const segmentName = new Map(props.segments.rows.map((s) => [s.segmentId, localName(s, locale)]));

  function report(outcome: SaveOutcome, context?: { goalCount?: number }) {
    if (!outcome) {
      setMessage({ text: t('goals.admin.saved'), isError: false });
      return;
    }
    const text =
      outcome.i18nKey === 'errors.goals.segmentHasGoals' && context?.goalCount !== undefined
        ? t('errors.goals.segmentHasGoalsCount', { count: context.goalCount })
        : tDynamic(outcome.i18nKey);
    setMessage({ text, isError: true });
  }

  const segmentColumns: Array<Column<SegmentAdminRow>> = [
    {
      id: 'name',
      header: () => t('goals.admin.field.nameEn'),
      cell: ({ row }) => localName(row.original, locale),
    },
    {
      id: 'type',
      header: () => t('goals.admin.segments.type'),
      cell: ({ row }) => t(`goals.admin.segments.type.${row.original.segmentType}`),
    },
    { accessorKey: 'battleBand', header: () => t('goals.admin.segments.battleBand') },
    { accessorKey: 'goalCount', header: () => t('goals.admin.segments.goalCount') },
    {
      id: 'actions',
      header: () => '',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="segment-table-edit"
            onClick={() =>
              setEditing({
                kind: 'segment',
                originalType: row.original.segmentType,
                draft: {
                  segmentId: row.original.segmentId,
                  expectedVersion: row.original.version,
                  nameBn: row.original.nameBn,
                  nameEn: row.original.nameEn,
                  segmentType: row.original.segmentType,
                  battleBand: row.original.battleBand,
                  sortOrder: String(row.original.sortOrder),
                },
              })
            }
          >
            {t('goals.admin.edit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="segment-table-delete"
            onClick={() => setToDelete(row.original)}
          >
            {t('goals.admin.segments.delete')}
          </Button>
        </div>
      ),
    },
  ];

  const goalColumns: Array<Column<GoalAdminRow>> = [
    {
      id: 'name',
      header: () => t('goals.admin.field.nameEn'),
      cell: ({ row }) => localName(row.original, locale),
    },
    {
      id: 'segment',
      header: () => t('goals.admin.goals.segment'),
      cell: ({ row }) => segmentName.get(row.original.segmentId) ?? '',
    },
    {
      id: 'status',
      header: () => t('goals.admin.goals.status'),
      cell: ({ row }) => t(`goals.admin.goals.status.${row.original.status}`),
    },
    {
      id: 'actions',
      header: () => '',
      cell: ({ row }) =>
        row.original.status === 'retired' ? null : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="goal-table-edit"
              onClick={() =>
                setEditing({
                  kind: 'goal',
                  draft: {
                    goalId: row.original.goalId,
                    expectedVersion: row.original.version,
                    segmentId: row.original.segmentId,
                    nameBn: row.original.nameBn,
                    nameEn: row.original.nameEn,
                    status: row.original.status === 'active' ? 'active' : 'inactive',
                    sortOrder: String(row.original.sortOrder),
                  },
                })
              }
            >
              {t('goals.admin.edit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="goal-table-retire"
              onClick={() => setToRetire(row.original)}
            >
              {t('goals.admin.goals.retire')}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="grid gap-8" data-testid="goals-admin">
      {message ? (
        <p
          role={message.isError ? 'alert' : 'status'}
          className={message.isError ? 'text-sm text-destructive' : 'text-sm'}
          data-testid="goals-admin-message"
        >
          {message.text}
        </p>
      ) : null}
      <section className="grid gap-3" aria-labelledby="goals-admin-segments">
        <div className="flex items-center justify-between gap-2">
          <h2 id="goals-admin-segments" className="font-medium">
            {t('goals.admin.segments.title')}
          </h2>
          <Button
            variant="outline"
            data-testid="segment-table-new"
            onClick={() => setEditing({ kind: 'segment', draft: EMPTY_SEGMENT })}
          >
            {t('goals.admin.segments.new')}
          </Button>
        </div>
        <DataTable
          testId="segment-table"
          columns={segmentColumns}
          rows={props.segments.rows}
          emptyText={t('goals.admin.segments.empty')}
          paging={props.segments.paging}
        />
      </section>
      <section className="grid gap-3" aria-labelledby="goals-admin-goals">
        <div className="flex items-center justify-between gap-2">
          <h2 id="goals-admin-goals" className="font-medium">
            {t('goals.admin.goals.title')}
          </h2>
          <Button
            variant="outline"
            data-testid="goal-table-new"
            disabled={props.segments.rows.length === 0}
            onClick={() =>
              setEditing({
                kind: 'goal',
                draft: {
                  segmentId: props.segments.rows[0]?.segmentId ?? '',
                  nameBn: '',
                  nameEn: '',
                  status: 'inactive',
                  sortOrder: '0',
                },
              })
            }
          >
            {t('goals.admin.goals.new')}
          </Button>
        </div>
        <DataTable
          testId="goal-table"
          columns={goalColumns}
          rows={props.goals.rows}
          emptyText={t('goals.admin.goals.empty')}
          paging={props.goals.paging}
        />
      </section>
      {editing?.kind === 'segment' ? (
        <section className="grid gap-3" aria-labelledby="goals-admin-segment-form">
          <h2 id="goals-admin-segment-form" className="font-medium">
            {t('goals.admin.segments.formTitle')}
          </h2>
          <SegmentForm
            key={editing.draft.segmentId ?? 'new'}
            initial={editing.draft}
            {...(editing.originalType ? { originalType: editing.originalType } : {})}
            onSave={async (input) => {
              const outcome = await props.onSaveSegment(input);
              if (!outcome) setEditing(null);
              report(outcome);
              return outcome;
            }}
          />
        </section>
      ) : null}
      {editing?.kind === 'goal' ? (
        <section className="grid gap-3" aria-labelledby="goals-admin-goal-form">
          <h2 id="goals-admin-goal-form" className="font-medium">
            {t('goals.admin.goals.formTitle')}
          </h2>
          <GoalForm
            key={editing.draft.goalId ?? 'new'}
            initial={editing.draft}
            segments={props.segments.rows}
            onSave={async (input) => {
              const outcome = await props.onSaveGoal(input);
              if (!outcome) setEditing(null);
              report(outcome);
              return outcome;
            }}
          />
        </section>
      ) : null}
      <ConfirmDialog
        isOpen={toDelete !== null}
        onOpenChange={(isOpen) => (isOpen ? undefined : setToDelete(null))}
        title={t('goals.admin.segments.deleteConfirm')}
        description={toDelete ? localName(toDelete, locale) : ''}
        confirmLabel={t('goals.admin.segments.delete')}
        testId="segment-delete-confirm"
        onConfirm={async () => {
          const row = toDelete;
          setToDelete(null);
          if (!row) return;
          report(
            await props.onDeleteSegment({ segmentId: row.segmentId, expectedVersion: row.version }),
            { goalCount: row.goalCount },
          );
        }}
      />
      <ConfirmDialog
        isOpen={toRetire !== null}
        onOpenChange={(isOpen) => (isOpen ? undefined : setToRetire(null))}
        title={t('goals.admin.goals.retire')}
        description={t('goals.admin.goals.retireConfirm')}
        confirmLabel={t('goals.admin.goals.retire')}
        testId="goal-retire-confirm"
        onConfirm={async () => {
          const row = toRetire;
          setToRetire(null);
          if (!row) return;
          report(await props.onRetireGoal({ goalId: row.goalId, expectedVersion: row.version }));
        }}
      />
    </div>
  );
}
