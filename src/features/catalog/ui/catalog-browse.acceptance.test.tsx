// [AT] Step 30 (screen part): Given/When/Then acceptance tests for the S3 and S4 behaviour of US2.1
// and US2.2, written before the screens exist: prices through formatMoney in the active locale, the
// tab order and the Bundles flag (BR11.3), the empty tab with its link (AC2.1.2), Retry keeping the
// tab (AC2.1.3), S4's contents above Buy (AC2.2.1), text before images (AC2.2.2) and Buy becoming
// Continue against the route-level stub of the contract 7 Entitlements read (AC2.2.3, functional-spec
// assumption 13). The server-side halves are in catalog-browse.acceptance.int.test.ts.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';

type Module = Record<string, unknown>;
const screens = import.meta.glob('./*.tsx') as Record<string, () => Promise<Module>>;

/** The screen component, looked up at call time so a missing screen fails its own test only. */
async function component(file: string, name: string) {
  const load = screens[`./${file}.tsx`];
  if (!load) throw new Error(`${file}.tsx does not exist yet`);
  const mod = await load();
  const found = mod[name];
  if (typeof found !== 'function') throw new Error(`${name} is not exported from ${file}.tsx`);
  return found as (props: Record<string, unknown>) => ReactNode;
}

async function inRouter(node: ReactNode, locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => <I18nProvider locale={locale}>{node}</I18nProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router as never} />);
}

const COURSE_A = {
  kind: 'course' as const,
  courseId: '0f9a5b2e-6d1c-4b8e-9a7f-1c2d3e4f5a6b',
  titleBn: 'বিসিএস গণিত',
  titleEn: 'BCS Maths',
  listPricePoisha: 149_950,
  accessDurationMonths: 6,
  isPinned: true,
};
const COURSE_B = {
  ...COURSE_A,
  courseId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  titleBn: 'বিসিএস বাংলা',
  titleEn: 'BCS Bangla',
  listPricePoisha: 250_000,
  accessDurationMonths: 12,
  isPinned: false,
};

const loaded = (items: unknown[], tabsWithItems: string[] = ['courses']) => ({
  kind: 'loaded',
  items,
  nextCursor: null,
  tabsWithItems,
});

const catalogProps = (overrides: Record<string, unknown> = {}) => ({
  tab: 'courses',
  isBundlesTabEnabled: false,
  goal: { nameBn: 'বিসিএস প্রিলিমিনারি', nameEn: 'BCS Preliminary' },
  state: loaded([COURSE_A, COURSE_B]),
  onSelectTab: vi.fn(),
  onRetry: vi.fn(),
  onLoadMore: vi.fn(),
  ...overrides,
});

describe('US2.1 on S3', () => {
  it('AC2.1.1 Given my Goal, When S3 shows the Courses tab, Then each card shows its title and its price through formatMoney in the active locale', async () => {
    const CatalogView = await component('CatalogView', 'CatalogView');
    await inRouter(<CatalogView {...catalogProps()} />, 'bn');
    const cards = await screen.findAllByTestId('catalog-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('বিসিএস গণিত');
    expect(cards[0]?.textContent).toContain(formatMoney(149_950 as MoneyPoisha, 'bn'));
    expect(cards[1]?.textContent).toContain(formatMoney(250_000 as MoneyPoisha, 'bn'));
  });

  it('BR11.3 Given catalog.bundlesTab is off, Then the tabs are Courses, Exam packages and Free trial; with it on, Bundles is third', async () => {
    const CatalogView = await component('CatalogView', 'CatalogView');
    await inRouter(<CatalogView {...catalogProps()} />);
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual([
      'Courses',
      'Exam packages',
      'Free trial',
    ]);
  });

  it('BR11.3 with the flag on, Bundles appears between Exam packages and Free trial', async () => {
    const CatalogView = await component('CatalogView', 'CatalogView');
    await inRouter(<CatalogView {...catalogProps({ isBundlesTabEnabled: true })} />);
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual([
      'Courses',
      'Exam packages',
      'Bundles',
      'Free trial',
    ]);
  });

  it('AC2.1.2 Given a tab with no items for my Goal, When I open it, Then an announced empty state explains it and links to a tab that has items', async () => {
    const CatalogView = await component('CatalogView', 'CatalogView');
    const onSelectTab = vi.fn();
    await inRouter(
      <CatalogView
        {...catalogProps({
          tab: 'exam_packages',
          state: loaded([], ['courses']),
          onSelectTab,
        })}
      />,
    );
    const empty = await screen.findByTestId('catalog-empty');
    expect(empty.getAttribute('role')).toBe('status');
    fireEvent.click(within(empty).getByTestId('catalog-empty-link'));
    expect(onSelectTab).toHaveBeenCalledWith('courses');
  });

  it('AC2.1.3 Given the catalog fails to load, When I tap Retry, Then it reloads and keeps the tab I had selected', async () => {
    const CatalogView = await component('CatalogView', 'CatalogView');
    const onRetry = vi.fn();
    await inRouter(
      <CatalogView {...catalogProps({ tab: 'free_trial', state: { kind: 'failed' }, onRetry })} />,
    );
    const failed = await screen.findByTestId('catalog-error');
    expect(failed.getAttribute('role')).toBe('alert');
    fireEvent.click(within(failed).getByTestId('catalog-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Free trial');
  });
});

const PAGE = {
  courseId: COURSE_A.courseId,
  goal: { goalId: 'g', nameBn: 'বিসিএস প্রিলিমিনারি', nameEn: 'BCS Preliminary' },
  isCurrentGoal: true,
  titleBn: 'বিসিএস গণিত',
  titleEn: 'BCS Maths',
  descriptionBn: 'বিসিএস প্রস্তুতির কোর্স',
  descriptionEn: null,
  listPricePoisha: 149_950,
  accessDurationMonths: 6,
  hasCoverImage: true,
  instructors: [
    {
      instructorId: 'lead-1',
      role: 'lead',
      displayName: 'Lead Teacher',
      sections: [{ sectionId: 's2', titleBn: 'দ্বিতীয় অংশ', titleEn: 'Second part' }],
    },
    {
      instructorId: 'co-1',
      role: 'co_instructor',
      displayName: 'Co Teacher',
      sections: [{ sectionId: 's1', titleBn: 'প্রথম অংশ', titleEn: 'First part' }],
    },
  ],
  outline: [
    {
      sectionId: 's1',
      titleBn: 'প্রথম অংশ',
      titleEn: 'First part',
      lessons: [{ lessonId: 'l1', kind: 'text', titleBn: 'ভূমিকা', titleEn: 'Introduction' }],
    },
    {
      sectionId: 's2',
      titleBn: 'দ্বিতীয় অংশ',
      titleEn: 'Second part',
      lessons: [{ lessonId: 'l2', kind: 'video', titleBn: 'ভিডিও', titleEn: 'Video' }],
    },
  ],
  practicePacks: [],
};

describe('US2.2 on S4', () => {
  it('AC2.2.1 Given a published course, When I open it, Then the Lead and Co-instructors with their sections, the duration and the price all come before Buy', async () => {
    const CoursePageView = await component('CoursePageView', 'CoursePageView');
    await inRouter(<CoursePageView page={PAGE} isEnrolled={false} />);
    const pageNode = await screen.findByTestId('course-page');
    const text = pageNode.textContent ?? '';
    const buyAt = text.indexOf('Buy');
    expect(buyAt).toBeGreaterThan(0);
    for (const expected of [
      'Lead Teacher',
      'Co Teacher',
      'Second part',
      'First part',
      '6 months',
      formatMoney(149_950 as MoneyPoisha, 'en'),
    ]) {
      expect(text.indexOf(expected)).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(expected)).toBeLessThan(buyAt);
    }
    // BR3.3: the description has no English text, so the Bangla one is shown, marked lang="bn".
    expect(screen.getByTestId('course-page-description').getAttribute('lang')).toBe('bn');
  });

  it('AC2.2.2 Given a slow network, When S4 renders, Then the text and price are in the first render and no image blocks it', async () => {
    const CoursePageView = await component('CoursePageView', 'CoursePageView');
    await inRouter(<CoursePageView page={PAGE} isEnrolled={false} />);
    await screen.findByTestId('course-page');
    expect(screen.getByTestId('course-page-price').textContent).toContain(
      formatMoney(149_950 as MoneyPoisha, 'en'),
    );
    // Images stay placeholders while catalog.imageUploads is off; any image is lazy.
    expect(screen.getByTestId('course-page-cover-placeholder')).toBeTruthy();
    for (const img of document.querySelectorAll('img'))
      expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('AC2.2.3 Given I have an active enrolment, When I open the course, Then Buy is replaced by Continue', async () => {
    const CoursePageView = await component('CoursePageView', 'CoursePageView');
    await inRouter(<CoursePageView page={PAGE} isEnrolled />);
    await screen.findByTestId('course-page');
    expect(screen.queryByTestId('course-page-buy')).toBeNull();
    expect(screen.getByTestId('course-page-continue').textContent).toBe('Continue');
  });

  it('AC2.2.3 The route-level Entitlements adapter answers from the commerce enrolment read, and "not enrolled" (Buy) on any failure', async () => {
    const status = vi.fn();
    vi.doMock('#src/features/commerce/server/commerce.functions.ts', () => ({
      getMyEnrolmentStatus: status,
    }));
    vi.resetModules();
    const { isEnrolledInCourse } = (await import('#src/routes/-adapters/entitlements.ts')) as {
      isEnrolledInCourse: (courseId: string) => Promise<boolean>;
    };
    status.mockResolvedValueOnce({ ok: true, value: { isEnrolled: true } });
    expect(await isEnrolledInCourse(COURSE_A.courseId)).toBe(true);
    expect(status).toHaveBeenCalledWith({ data: { courseId: COURSE_A.courseId } });
    status.mockResolvedValueOnce({ ok: true, value: { isEnrolled: false } });
    expect(await isEnrolledInCourse(COURSE_A.courseId)).toBe(false);
    status.mockResolvedValueOnce({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await isEnrolledInCourse(COURSE_A.courseId)).toBe(false);
    vi.doUnmock('#src/features/commerce/server/commerce.functions.ts');
  });
});
