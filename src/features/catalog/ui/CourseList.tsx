// I1 course list (US3.1): the instructor's courses with their role, status, price and duration.
// TanStack Table over the Platform DataTable, paged on the server. Prices are shown only through
// formatMoney (BR5.8).
import { Link } from '@tanstack/react-router';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { localTitle } from './fields.tsx';

export type CourseListRow = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  status: 'draft' | 'published' | 'unpublished' | 'hidden' | 'retired';
  isLead: boolean;
  listPricePoisha: number | null;
  accessDurationMonths: number | null;
};

export function CourseList(props: {
  rows: CourseListRow[];
  paging: { page: number; pages: number; onPage: (page: number) => void };
}) {
  const { t, locale } = useI18n();
  const columns: Array<Column<CourseListRow>> = [
    {
      id: 'title',
      header: () => t('catalog.instructor.list.title'),
      cell: ({ row }) => (
        <Link
          to="/instructor/courses/$courseId"
          params={{ courseId: row.original.courseId }}
          className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
          data-testid="course-list-open-link"
        >
          {localTitle(row.original, locale)}
        </Link>
      ),
    },
    {
      id: 'role',
      header: () => t('catalog.instructor.list.role'),
      cell: ({ row }) =>
        row.original.isLead ? t('catalog.instructor.role.lead') : t('catalog.instructor.role.co'),
    },
    {
      id: 'status',
      header: () => t('catalog.instructor.list.status'),
      cell: ({ row }) => t(`catalog.instructor.status.${row.original.status}`),
    },
    {
      id: 'price',
      header: () => t('catalog.instructor.list.price'),
      cell: ({ row }) =>
        row.original.listPricePoisha === null
          ? t('catalog.instructor.notSet')
          : formatMoney(row.original.listPricePoisha as MoneyPoisha, locale),
    },
  ];
  return (
    <DataTable
      testId="course-list-table"
      columns={columns}
      rows={props.rows}
      emptyText={t('catalog.instructor.list.empty')}
      paging={props.paging}
    />
  );
}
