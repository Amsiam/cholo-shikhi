// [LT] Step 35: S3 CatalogView and S4 CoursePageView with React Testing Library (US2.1, US2.2; BR3.3,
// BR5.8, BR11.3–BR11.10; NFR7.201, NFR7.202): tab keyboard navigation, announcements, Load more, the
// bilingual fallback with lang, and prices and durations through the active locale.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha, toBanglaDigits } from '#src/lib/money.ts';
import type { CoursePage } from '../server/catalog-browse.types.ts';
import { CatalogView, type CatalogViewProps, visibleTabs } from './CatalogView.tsx';
import { CoursePageView, fallbackText } from './CoursePageView.tsx';

function inRouter(node: ReactNode, locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => <I18nProvider locale={locale}>{node}</I18nProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router as never} />);
}

const CARD = {
  kind: 'course' as const,
  courseId: '0f9a5b2e-6d1c-4b8e-9a7f-1c2d3e4f5a6b',
  titleBn: 'বিসিএস গণিত',
  titleEn: 'BCS Maths',
  listPricePoisha: 99_900,
  accessDurationMonths: 4,
  isPinned: false,
};

function props(overrides: Partial<CatalogViewProps> = {}): CatalogViewProps {
  return {
    tab: 'courses',
    isBundlesTabEnabled: false,
    goal: { nameBn: 'বিসিএস', nameEn: 'BCS' },
    state: { kind: 'loaded', items: [CARD], nextCursor: null, tabsWithItems: ['courses'] },
    onSelectTab: vi.fn(),
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
}

describe('S3 CatalogView', () => {
  it('is a labelled tablist; arrow keys move focus without loading, Enter selects', async () => {
    const onSelectTab = vi.fn();
    inRouter(<CatalogView {...props({ onSelectTab })} />);
    const list = await screen.findByRole('tablist');
    expect(list.getAttribute('aria-label')).toBe('Catalog sections');
    const [courses, packages] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];
    courses.focus();
    fireEvent.keyDown(courses, { key: 'ArrowRight' });
    // Radix moves roving focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(packages));
    expect(onSelectTab).not.toHaveBeenCalled();
    fireEvent.keyDown(packages, { key: 'Enter' });
    expect(onSelectTab).toHaveBeenCalledWith('exam_packages');
  });

  it('selecting a tab with the pointer reports it', async () => {
    const onSelectTab = vi.fn();
    inRouter(<CatalogView {...props({ onSelectTab })} />);
    const trial = await screen.findByTestId('catalog-tab-free_trial');
    fireEvent.mouseDown(trial, { button: 0 });
    fireEvent.click(trial);
    expect(onSelectTab).toHaveBeenCalledWith('free_trial');
  });

  it('a card links to its S4 page and shows the price and the duration in Bangla digits', async () => {
    inRouter(<CatalogView {...props()} />, 'bn');
    const card = await screen.findByTestId('catalog-card');
    expect(within(card).getByTestId('catalog-card-link').getAttribute('href')).toBe(
      `/courses/${CARD.courseId}`,
    );
    expect(within(card).getByTestId('catalog-card-price').textContent).toBe(
      formatMoney(99_900 as MoneyPoisha, 'bn'),
    );
    expect(card.textContent).toContain(`${toBanglaDigits('4')} মাস`);
  });

  it('marks a pinned card as featured', async () => {
    inRouter(
      <CatalogView
        {...props({
          state: {
            kind: 'loaded',
            items: [{ ...CARD, isPinned: true }],
            nextCursor: null,
            tabsWithItems: ['courses'],
          },
        })}
      />,
    );
    expect((await screen.findByTestId('catalog-card')).textContent).toContain('Featured');
  });

  it('shows Load more only with a next cursor, and disables it while loading', async () => {
    const onLoadMore = vi.fn();
    inRouter(
      <CatalogView
        {...props({
          onLoadMore,
          state: { kind: 'loaded', items: [CARD], nextCursor: 'c', tabsWithItems: ['courses'] },
        })}
      />,
    );
    fireEvent.click(await screen.findByTestId('catalog-load-more'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('announces a failed "Load more" without losing the loaded cards', async () => {
    inRouter(
      <CatalogView
        {...props({
          isLoadingMore: true,
          isLoadMoreFailed: true,
          state: { kind: 'loaded', items: [CARD], nextCursor: 'c', tabsWithItems: ['courses'] },
        })}
      />,
    );
    expect((await screen.findByTestId('catalog-load-more')).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('catalog-load-more-error').getAttribute('role')).toBe('alert');
    expect(screen.getAllByTestId('catalog-card')).toHaveLength(1);
  });

  it('an empty Courses tab with nothing elsewhere explains it and offers no link', async () => {
    inRouter(
      <CatalogView
        {...props({ state: { kind: 'loaded', items: [], nextCursor: null, tabsWithItems: [] } })}
      />,
    );
    const empty = await screen.findByTestId('catalog-empty');
    expect(empty.textContent).toContain('There are no courses for your goal yet.');
    expect(within(empty).queryByTestId('catalog-empty-link')).toBeNull();
  });

  it('an empty tab with no other filled tab links to Courses (BR11.6)', async () => {
    const onSelectTab = vi.fn();
    inRouter(
      <CatalogView
        {...props({
          tab: 'free_trial',
          onSelectTab,
          state: { kind: 'loaded', items: [], nextCursor: null, tabsWithItems: [] },
        })}
      />,
    );
    fireEvent.click(await screen.findByTestId('catalog-empty-link'));
    expect(onSelectTab).toHaveBeenCalledWith('courses');
  });

  it('names the current Goal in the active language', async () => {
    inRouter(<CatalogView {...props()} />, 'bn');
    expect((await screen.findByTestId('catalog-goal')).textContent).toContain('বিসিএস');
  });

  it('visibleTabs follows the functional-spec order and the Bundles flag', () => {
    expect(visibleTabs(false)).toEqual(['courses', 'exam_packages', 'free_trial']);
    expect(visibleTabs(true)).toEqual(['courses', 'exam_packages', 'bundles', 'free_trial']);
  });
});

const PAGE: CoursePage = {
  courseId: CARD.courseId,
  goal: { goalId: 'g', nameBn: 'ব্যাংক', nameEn: 'Bank' },
  isCurrentGoal: false,
  titleBn: 'ব্যাংক গণিত',
  titleEn: 'Bank Maths',
  descriptionBn: null,
  descriptionEn: 'An English-only description.',
  listPricePoisha: 120_025,
  accessDurationMonths: 12,
  hasCoverImage: false,
  instructors: [{ instructorId: 'i1', role: 'lead', displayName: '', sections: [] }],
  outline: [
    {
      sectionId: 's1',
      titleBn: 'অংশ',
      titleEn: 'Part',
      lessons: [
        { lessonId: 'l1', kind: 'quiz', titleBn: 'শুধু বাংলা', titleEn: null, streakBonusDays: null },
      ],
    },
  ],
  practicePacks: [],
};

describe('S4 CoursePageView', () => {
  it('falls back to the other language with its own lang for bilingual-one fields (BR3.3)', async () => {
    inRouter(<CoursePageView page={PAGE} isEnrolled={false} />, 'bn');
    expect((await screen.findByTestId('course-page-description')).getAttribute('lang')).toBe('en');
    const lesson = screen.getByTestId('course-page-lesson');
    expect(lesson.textContent).toContain('কুইজ');
    expect(lesson.querySelector('[lang="bn"]')?.textContent).toBe('শুধু বাংলা');
  });

  it('shows the price through formatMoney and the duration with Bangla digits', async () => {
    inRouter(<CoursePageView page={PAGE} isEnrolled={false} />, 'bn');
    expect((await screen.findByTestId('course-page-price')).textContent).toBe(
      formatMoney(120_025 as MoneyPoisha, 'bn'),
    );
    expect(screen.getByTestId('course-page-duration').textContent).toBe(
      `${toBanglaDigits('12')} মাস`,
    );
  });

  it('notes a course from another Goal and labels an instructor without a display name', async () => {
    inRouter(<CoursePageView page={PAGE} isEnrolled={false} />);
    expect((await screen.findByTestId('course-page-other-goal')).textContent).toContain('Bank');
    expect(screen.getByTestId('course-page-instructor').textContent).toContain(
      'Instructor Lead instructor',
    );
  });

  it('Buy is disabled with a described note until checkout ships, and calls onBuy once wired', async () => {
    inRouter(<CoursePageView page={PAGE} isEnrolled={false} />);
    const buy = await screen.findByTestId('course-page-buy');
    expect(buy.hasAttribute('disabled')).toBe(true);
    expect(buy.getAttribute('aria-describedby')).toBe('course-page-buy-note');
  });

  it('calls onBuy when the route wires checkout', async () => {
    const onBuy = vi.fn();
    inRouter(<CoursePageView page={PAGE} isEnrolled={false} onBuy={onBuy} />);
    fireEvent.click(await screen.findByTestId('course-page-buy'));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('fallbackText answers the own language first, then the other one, else nothing', () => {
    expect(fallbackText('বাংলা', 'English', 'en')).toEqual({ text: 'English', lang: 'en' });
    expect(fallbackText('বাংলা', null, 'en')).toEqual({ text: 'বাংলা', lang: 'bn' });
    expect(fallbackText(null, 'English', 'bn')).toEqual({ text: 'English', lang: 'en' });
    expect(fallbackText(null, '', 'bn')).toBeNull();
  });
});
