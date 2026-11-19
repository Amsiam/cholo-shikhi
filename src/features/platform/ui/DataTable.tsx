// The one data table (project.md: data tables use TanStack Table), drawn as a ruled sheet per
// DESIGN.md: square white box, teal hairlines, tinted header, numbers right-aligned and tabular. Paging
// is server-side: the parent passes one page of rows and the page controls (validateSearch params in
// the route). Wide tables scroll inside their own box on a phone.
import {
  type ColumnDef,
  createColumnHelper,
  type RowData,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

const features = tableFeatures({});

export type Column<T extends RowData> = ColumnDef<typeof features, T>;

/** Column meta read by the table: numeric columns line up on the right. */
export type ColumnMeta = { isNumeric?: boolean };

/** A compact column spec for display-only tables (no sorting or accessors needed). */
export type DisplayColumn<T extends RowData> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  isNumeric?: boolean;
};

/** Turns compact display columns into TanStack column definitions. */
export function displayColumns<T extends RowData>(
  specs: readonly DisplayColumn<T>[],
): Array<Column<T>> {
  const helper = createColumnHelper<typeof features, T>();
  return specs.map((c) =>
    helper.display({
      id: c.id,
      header: () => c.header,
      cell: (ctx) => c.cell(ctx.row.original),
      meta: { isNumeric: c.isNumeric === true } satisfies ColumnMeta,
    }),
  ) as Array<Column<T>>;
}

const isNumeric = (meta: unknown) => (meta as ColumnMeta | undefined)?.isNumeric === true;

export function DataTable<T extends RowData>(props: {
  testId: string;
  /** Full TanStack column definitions, or `display` for a compact display-only spec. */
  columns?: Array<Column<T>>;
  display?: readonly DisplayColumn<T>[];
  rows: T[];
  emptyText: ReactNode;
  /** A stable row ID (defaults to the row index). */
  rowId?: (row: T) => string;
  /** A screen-reader caption naming the table. */
  caption?: string;
  paging?: { page: number; pages: number; onPage: (page: number) => void };
}) {
  const { t, formatInteger } = useI18n();
  const rowId = props.rowId;
  const columns = props.columns ?? displayColumns(props.display ?? []);
  const table = useTable({
    features,
    columns,
    data: props.rows,
    ...(rowId ? { getRowId: (row: T) => rowId(row) } : {}),
  });
  const rows = table.getRowModel().rows;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto border border-primary/15 bg-background">
        <table className="w-full min-w-[36rem] border-collapse text-sm" data-testid={props.testId}>
          {props.caption ? <caption className="sr-only">{props.caption}</caption> : null}
          <thead className="bg-primary/5">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={`border-b border-primary/15 px-4 py-3 text-xs font-semibold tracking-wide text-ink-muted uppercase ${isNumeric(header.column.columnDef.meta) ? 'text-right whitespace-nowrap' : 'text-left'}`}
                  >
                    <table.FlexRender header={header} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-ink-muted"
                  data-testid={`${props.testId}-empty`}
                >
                  {props.emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-primary/10 last:border-0 hover:bg-paper"
                  data-testid={`${props.testId}-row`}
                >
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-4 py-3 align-middle ${isNumeric(cell.column.columnDef.meta) ? 'text-right whitespace-nowrap tabular-nums' : ''}`}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {props.paging && props.paging.pages > 1 ? (
        <nav
          aria-label={t('admin.pager.label')}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span className="text-ink-muted">
            {t('admin.pager.page', {
              page: formatInteger(props.paging.page),
              pages: formatInteger(props.paging.pages),
            })}
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              disabled={props.paging.page <= 1}
              data-testid={`${props.testId}-previous`}
              onClick={() => props.paging?.onPage((props.paging?.page ?? 1) - 1)}
            >
              {t('admin.pager.previous')}
            </Button>
            <Button
              variant="outline"
              disabled={props.paging.page >= props.paging.pages}
              data-testid={`${props.testId}-next`}
              onClick={() => props.paging?.onPage((props.paging?.page ?? 1) + 1)}
            >
              {t('admin.pager.next')}
            </Button>
          </span>
        </nav>
      ) : null}
    </div>
  );
}
