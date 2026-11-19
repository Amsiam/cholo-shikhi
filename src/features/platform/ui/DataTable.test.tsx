import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { DataTable, type DisplayColumn, displayColumns } from './DataTable.tsx';

type Row = { id: string; n: number };
const columns = displayColumns<Row>([
  { id: 'name', header: 'Name', cell: (r) => r.id },
  { id: 'n', header: 'Count', cell: (r) => r.n, isNumeric: true },
]);
const display: DisplayColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.id },
  { id: 'n', header: 'Count', cell: (r) => r.n, isNumeric: true },
];
const ui = (rows: Row[]) =>
  render(
    <I18nProvider locale="en">
      <DataTable
        testId="t"
        columns={columns}
        rows={rows}
        rowId={(r) => r.id}
        emptyText="none"
        caption="Counts"
      />
    </I18nProvider>,
  );

describe('DataTable', () => {
  it('renders one row per item with numeric columns right-aligned and a caption', () => {
    ui([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
    const table = screen.getByTestId('t');
    expect(screen.getAllByTestId('t-row')).toHaveLength(2);
    expect(table.querySelector('caption')?.textContent).toBe('Counts');
    expect(table.querySelector('th:last-child')?.className).toContain('text-right');
    expect(table.querySelector('tbody td:last-child')?.className).toContain('tabular-nums');
  });
  it('accepts a compact display spec', () => {
    render(
      <I18nProvider locale="en">
        <DataTable testId="d" display={display} rows={[{ id: 'x', n: 3 }]} emptyText="none" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('d-row').textContent).toBe('x3');
  });
  it('shows the empty message in place of rows', () => {
    ui([]);
    expect(screen.getByTestId('t-empty').textContent).toBe('none');
  });
});
