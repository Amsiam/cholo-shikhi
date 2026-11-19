// [LT] Catalog course finder: exam picker, results, search box and page links.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import type { CourseSearchPage } from '../server/catalog-browse.types.ts';
import { CourseResults, ExamPicker, pageWindow } from './CourseFinder.tsx';

const ID = (n: number) => `0f9a5b2e-6d1c-4b8e-9a7f-${String(n).padStart(12, '0')}`;

function inRouter(node: ReactNode, locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => <I18nProvider locale={locale}>{node}</I18nProvider>,
  });
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const router = createRouter({ routeTree: rootRoute, history });
  render(<RouterProvider router={router as never} />);
  return history;
}

function result(overrides: Partial<CourseSearchPage> = {}): CourseSearchPage {
  return {
    goal: { goalId: ID(1), nameBn: 'বিসিএস', nameEn: 'BCS' },
    query: null,
    items: [
      {
        kind: 'course',
        courseId: ID(10),
        titleBn: 'বাংলা',
        titleEn: 'Bangla',
        listPricePoisha: 250_000,
        accessDurationMonths: 6,
        isPinned: false,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 12,
    pageCount: 1,
    ...overrides,
  };
}

describe('pageWindow', () => {
  it('shows every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
  it('keeps first, last and neighbours, with gaps between', () => {
    expect(pageWindow(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
  });
  it('has no gap next to the first page', () => {
    expect(pageWindow(2, 9)).toEqual([1, 2, 3, 'gap', 9]);
  });
});

describe('ExamPicker', () => {
  const groups = [
    {
      segmentId: ID(2),
      nameBn: 'চাকরি',
      nameEn: 'Job exams',
      goals: [
        { goalId: ID(1), nameBn: 'বিসিএস', nameEn: 'BCS' },
        { goalId: ID(3), nameBn: 'ব্যাংক', nameEn: 'Bank' },
      ],
    },
  ];
  it('asks for the exam and links each one to its course list', async () => {
    inRouter(<ExamPicker groups={groups} currentGoalId={ID(1)} />);
    expect(
      await screen.findByRole('heading', { name: 'Which exam are you preparing for?' }),
    ).toBeTruthy();
    const options = screen.getAllByTestId('catalog-exam-option');
    expect(options.map((o) => o.getAttribute('href'))).toEqual([
      `/catalog?goal=${ID(1)}`,
      `/catalog?goal=${ID(3)}`,
    ]);
    expect(options[0]?.textContent).toContain('Your goal');
    expect(options[1]?.textContent).not.toContain('Your goal');
  });
  it('says so when no exam is open', async () => {
    inRouter(<ExamPicker groups={[]} />);
    expect((await screen.findByTestId('catalog-no-goals')).textContent).toContain('No exams');
  });
});

describe('CourseResults', () => {
  it('shows the exam, the count and the course cards linking to their pages', async () => {
    inRouter(<CourseResults result={result()} />);
    expect((await screen.findByTestId('catalog-goal')).textContent).toBe('BCS');
    expect(screen.getByTestId('catalog-result-count').textContent).toBe('Courses: 1');
    expect(screen.getByTestId('catalog-card-link').getAttribute('href')).toBe(`/courses/${ID(10)}`);
    expect(screen.getByTestId('catalog-change-exam').getAttribute('href')).toBe(
      '/catalog?choose=true',
    );
    expect(screen.queryByTestId('catalog-pagination')).toBeNull();
  });

  it('explains an empty search and offers to clear it', async () => {
    inRouter(<CourseResults result={result({ query: 'zzz', items: [], total: 0 })} />);
    expect((await screen.findByTestId('catalog-empty')).textContent).toContain(
      'No courses match "zzz"',
    );
    expect(screen.getByTestId('catalog-empty-clear').getAttribute('href')).toBe(
      `/catalog?goal=${ID(1)}`,
    );
  });

  it('submits the trimmed search text into the address, back on page 1', async () => {
    const history = inRouter(
      <CourseResults result={result({ page: 2, pageCount: 3, total: 30 })} />,
    );
    const input = await screen.findByTestId('catalog-search-input');
    fireEvent.change(input, { target: { value: '  math  ' } });
    fireEvent.click(screen.getByTestId('catalog-search-submit'));
    await waitFor(() => expect(history.location.search).toBe(`?goal=${ID(1)}&q=math`));
  });

  it('numbers the pages, marks the current one and keeps the search in every link', async () => {
    inRouter(
      <CourseResults result={result({ query: 'math', page: 2, pageCount: 3, total: 30 })} />,
    );
    const numbers = await screen.findAllByTestId('catalog-page-number');
    expect(numbers.map((n) => n.textContent)).toEqual(['1', '2', '3']);
    expect(numbers[1]?.getAttribute('aria-current')).toBe('page');
    expect(numbers[0]?.getAttribute('href')).toBe(`/catalog?goal=${ID(1)}&q=math`);
    expect(screen.getByTestId('catalog-page-prev').getAttribute('href')).toBe(
      `/catalog?goal=${ID(1)}&q=math`,
    );
    expect(screen.getByTestId('catalog-page-next').getAttribute('href')).toBe(
      `/catalog?goal=${ID(1)}&q=math&page=3`,
    );
  });

  it('uses Bangla digits in Bangla', async () => {
    inRouter(<CourseResults result={result({ total: 12 })} />, 'bn');
    expect((await screen.findByTestId('catalog-result-count')).textContent).toBe('কোর্স: ১২টি');
  });
});
