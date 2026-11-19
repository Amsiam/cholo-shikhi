// [LT] Step 43: the product screens with React Testing Library (US2.28, US2.8, US5.4; BR5.8, BR10.3,
// BR11.2, BR11.8; NFR7.201): plan and exam package cards on S3, Practice Packs on S4, the A12 / A9
// editors with announced field errors, the question-picker slot, the TanStack Table item picker and
// the I1 pack panel. Prices are asserted against formatMoney, never a literal (BR5.8).
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
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import type { CoursePage } from '../server/catalog-browse.types.ts';
import type {
  ExamPackageAdminRow,
  PlanAdminRow,
  PracticePackRowView,
} from '../server/catalog-products.types.ts';
import { CatalogView, type CatalogViewProps } from './CatalogView.tsx';
import { CoursePageView } from './CoursePageView.tsx';
import { ExamPackagesAdmin, toSaveInput } from './ExamPackagesAdmin.tsx';
import { PlansAdmin } from './PlansAdmin.tsx';
import { PracticePacksPanel } from './PracticePacksPanel.tsx';
import { actionsFor, parseIdList, poishaToTakaInput } from './product-fields.tsx';

// jsdom has no ResizeObserver, which Radix uses only to measure the radio indicator. This fills the
// missing browser API with a no-op; no component behaviour is replaced.
if (!('ResizeObserver' in globalThis)) {
  const noOp = (): void => undefined;
  globalThis.ResizeObserver = class {
    observe = noOp;
    unobserve = noOp;
    disconnect = noOp;
  } as unknown as typeof ResizeObserver;
}

const ID = (n: number) => `0f9a5b2e-6d1c-4b8e-9a7f-${String(n).padStart(12, '0')}`;
const GOALS = [
  { goalId: ID(90), nameBn: 'বিসিএস', nameEn: 'BCS' },
  { goalId: ID(91), nameBn: 'ব্যাংক', nameEn: 'Bank' },
];

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
const plain = (node: ReactNode, locale: 'bn' | 'en' = 'en') =>
  render(<I18nProvider locale={locale}>{node}</I18nProvider>);

const money = (poisha: number, locale: 'bn' | 'en' = 'en') =>
  formatMoney(poisha as MoneyPoisha, locale);

const paging = { page: 1, pages: 1, onPage: vi.fn() };

const examRow = (overrides: Partial<ExamPackageAdminRow> = {}): ExamPackageAdminRow => ({
  examPackageId: ID(1),
  goalId: ID(90),
  titleBn: 'বিসিএস মডেল টেস্ট',
  titleEn: 'BCS model test',
  descriptionBn: null,
  descriptionEn: null,
  listPricePoisha: 49_950,
  status: 'published',
  questionIds: [ID(10), ID(11)],
  timeLimitMinutes: 60,
  hasUnpublishedChanges: false,
  hasCurrentVersion: true,
  pinRank: null,
  version: 3,
  ...overrides,
});

describe('helpers', () => {
  it('turns stored poisha into taka text with string arithmetic only', () => {
    expect(poishaToTakaInput(149_950)).toBe('1499.50');
    expect(poishaToTakaInput(5)).toBe('0.05');
    expect(poishaToTakaInput(100)).toBe('1.00');
    expect(poishaToTakaInput(null)).toBe('');
    expect(poishaToTakaInput(-1)).toBe('');
  });

  it('parses an ID list by line, comma or space and keeps the order', () => {
    expect(parseIdList(` ${ID(2)}\n${ID(1)}, ${ID(3)}\n\n`)).toEqual([ID(2), ID(1), ID(3)]);
    expect(parseIdList('')).toEqual([]);
  });

  it('offers the lifecycle actions of each status (§3.5–§3.7)', () => {
    expect(actionsFor('draft', false)).toEqual(['publish']);
    expect(actionsFor('published', false)).toEqual(['unpublish', 'retire']);
    expect(actionsFor('published', true)).toEqual(['publish', 'unpublish', 'retire']);
    expect(actionsFor('unpublished', false)).toEqual(['publish', 'retire']);
    expect(actionsFor('retired', false)).toEqual([]);
  });

  it('keeps a non-number time limit invalid instead of dropping it', () => {
    const draft = { goalId: ID(90), titleBn: 'ক', titleEn: 'A', price: '1', questionIds: [] };
    expect(toSaveInput({ ...draft, timeLimit: '' }, null).timeLimitMinutes).toBeNull();
    expect(toSaveInput({ ...draft, timeLimit: '45' }, null).timeLimitMinutes).toBe(45);
    expect(Number.isNaN(toSaveInput({ ...draft, timeLimit: '4.5' }, null).timeLimitMinutes)).toBe(
      true,
    );
  });
});

describe('S3 product cards (BR11.1, BR11.2)', () => {
  const base: CatalogViewProps = {
    tab: 'courses',
    isBundlesTabEnabled: false,
    goal: { nameBn: 'বিসিএস', nameEn: 'BCS' },
    state: {
      kind: 'loaded',
      items: [
        {
          kind: 'plan',
          planId: ID(5),
          nameBn: 'বিসিএস সব-এক-সাথে',
          nameEn: 'BCS all-in-one',
          monthlyPricePoisha: 39_900,
          isPinned: true,
        },
        {
          kind: 'course',
          courseId: ID(6),
          titleBn: 'গণিত',
          titleEn: 'Maths',
          listPricePoisha: 99_900,
          accessDurationMonths: 6,
          isPinned: false,
        },
      ],
      nextCursor: null,
      tabsWithItems: ['courses'],
    },
    onSelectTab: vi.fn(),
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
  };

  it('shows a plan card first, with its monthly price per month through formatMoney', async () => {
    inRouter(<CatalogView {...base} />);
    const list = await screen.findByTestId('catalog-list');
    const [first] = within(list).getAllByRole('listitem');
    expect(first?.getAttribute('data-testid')).toBe('catalog-plan-card');
    expect(screen.getByTestId('catalog-plan-card-price').textContent).toBe(
      `${money(39_900)} per month`,
    );
    expect(within(first as HTMLElement).getByText('Featured')).toBeTruthy();
  });

  it('renders the plan name and per-month price in Bangla', async () => {
    inRouter(<CatalogView {...base} />, 'bn');
    expect((await screen.findByTestId('catalog-plan-card-name')).textContent).toBe(
      'বিসিএস সব-এক-সাথে',
    );
    expect(screen.getByTestId('catalog-plan-card-price').textContent).toBe(
      `প্রতি মাসে ${money(39_900, 'bn')}`,
    );
  });

  // The human's decision (2026-11-18) replaces FR2.7's 'never expires': six months once bought.
  it('shows an exam package card with its price and six months of access', async () => {
    inRouter(
      <CatalogView
        {...base}
        tab="exam_packages"
        state={{
          kind: 'loaded',
          items: [
            {
              kind: 'exam_package',
              examPackageId: ID(7),
              titleBn: 'মডেল টেস্ট',
              titleEn: 'Model test',
              listPricePoisha: 49_950,
              isPinned: false,
            },
          ],
          nextCursor: null,
          tabsWithItems: ['exam_packages'],
        }}
      />,
    );
    expect((await screen.findByTestId('catalog-exam-card-price')).textContent).toBe(money(49_950));
    expect(screen.getByText('Six months of access')).toBeTruthy();
  });
});

describe('S4 Practice Packs (BR11.8)', () => {
  const page: CoursePage = {
    courseId: ID(20),
    goal: { goalId: ID(90), nameBn: 'বিসিএস', nameEn: 'BCS' },
    isCurrentGoal: true,
    titleBn: 'গণিত',
    titleEn: 'Maths',
    descriptionBn: null,
    descriptionEn: 'About',
    listPricePoisha: 99_900,
    accessDurationMonths: 6,
    hasCoverImage: false,
    instructors: [],
    outline: [],
    practicePacks: [
      { practicePackId: ID(21), titleBn: 'অনুশীলন', titleEn: 'Practice', listPricePoisha: 19_950 },
    ],
  };

  // The course page links back to the catalog, so it renders inside a router.
  it('lists each published pack as a separate item with its own price', async () => {
    inRouter(<CoursePageView page={page} isEnrolled={false} />);
    const packs = await screen.findByTestId('course-page-packs');
    expect(within(packs).getAllByTestId('course-page-pack')).toHaveLength(1);
    expect(screen.getByTestId('course-page-pack-price').textContent).toBe(money(19_950));
    expect(screen.getByRole('heading', { name: 'Practice Packs' })).toBeTruthy();
  });

  it('shows no pack section when the course has none', async () => {
    inRouter(<CoursePageView page={{ ...page, practicePacks: [] }} isEnrolled={false} />);
    expect(await screen.findByTestId('course-page')).toBeTruthy();
    expect(screen.queryByTestId('course-page-packs')).toBeNull();
  });
});

describe('A12 exam packages (US2.28)', () => {
  it('announces the server field errors next to their fields', async () => {
    const onSave = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
    }));
    plain(
      <ExamPackagesAdmin
        rows={[]}
        total={0}
        paging={paging}
        goals={GOALS}
        onSave={onSave}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('exam-packages-new'));
    fireEvent.change(screen.getByTestId('exam-editor-title-bn'), { target: { value: 'মডেল' } });
    fireEvent.change(screen.getByTestId('exam-editor-title-en'), { target: { value: 'Model' } });
    fireEvent.change(screen.getByTestId('exam-editor-price'), { target: { value: '9000' } });
    fireEvent.click(screen.getByTestId('exam-editor-save'));
    const error = await screen.findByTestId('exam-editor-price-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('exam-editor-price').getAttribute('aria-invalid')).toBe('true');
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: ID(90), price: '9000', timeLimitMinutes: null }),
    );
  });

  it('refuses a non-number time limit locally, without calling the server', async () => {
    const onSave = vi.fn(async () => null);
    plain(
      <ExamPackagesAdmin
        rows={[]}
        total={0}
        paging={paging}
        goals={GOALS}
        onSave={onSave}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('exam-packages-new'));
    fireEvent.change(screen.getByTestId('exam-editor-time-limit'), { target: { value: 'ten' } });
    fireEvent.click(screen.getByTestId('exam-editor-save'));
    expect(await screen.findByTestId('exam-editor-time-limit-error')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('fills the question picker slot when the route provides one, instead of the ID list', () => {
    plain(
      <ExamPackagesAdmin
        rows={[examRow()]}
        total={1}
        paging={paging}
        goals={GOALS}
        renderQuestionPicker={(field) => (
          <p data-testid="assessment-picker">{field.value.length}</p>
        )}
        onSave={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('exam-row-edit'));
    expect(screen.getByTestId('assessment-picker').textContent).toBe('2');
    expect(screen.queryByTestId('exam-editor-questions')).toBeNull();
    expect(screen.getByTestId('exam-editor-version-note')).toBeTruthy();
    expect((screen.getByTestId('exam-editor-price') as HTMLInputElement).value).toBe('499.50');
  });

  it('offers retire after confirmation and announces a refusal (BR10.8)', async () => {
    const onAction = vi.fn(async () => ({
      code: 'CONFLICT',
      i18nKey: 'errors.catalog.inCurrentPlan',
    }));
    plain(
      <ExamPackagesAdmin
        rows={[examRow()]}
        total={1}
        paging={paging}
        goals={GOALS}
        onSave={vi.fn()}
        onAction={onAction}
      />,
    );
    expect(screen.queryByTestId('exam-row-publish')).toBeNull();
    expect(screen.getByTestId('exam-packages-table').textContent).toContain(money(49_950));
    fireEvent.click(screen.getByTestId('exam-row-retire'));
    fireEvent.click(await screen.findByTestId('exam-row-confirm-confirm'));
    const message = await screen.findByTestId('exam-row-message');
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe(
      'A published plan includes this item. Remove it from the plan first.',
    );
    expect(onAction).toHaveBeenCalledWith('retire', expect.objectContaining({ version: 3 }));
  });
});

describe('A9 plans (US2.8)', () => {
  const candidates = [
    { type: 'course' as const, id: ID(30), titleBn: 'গণিত', titleEn: 'Maths' },
    { type: 'exam_package' as const, id: ID(31), titleBn: 'মডেল', titleEn: 'Model test' },
  ];

  it('loads the Goal candidates into a TanStack Table and saves the ticked items', async () => {
    const loadCandidates = vi.fn(async () => candidates);
    const onSave = vi.fn(async () => null);
    plain(
      <PlansAdmin
        rows={[]}
        total={0}
        paging={paging}
        goals={GOALS}
        loadCandidates={loadCandidates}
        onSave={onSave}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('plans-new'));
    const boxes = await screen.findAllByTestId('plan-item-checkbox');
    expect(loadCandidates).toHaveBeenCalledWith(ID(90));
    expect(boxes[1]?.getAttribute('aria-label')).toBe('Include Model test');
    fireEvent.click(boxes[1] as HTMLElement);
    fireEvent.change(screen.getByTestId('plan-editor-name-bn'), { target: { value: 'প্ল্যান' } });
    fireEvent.change(screen.getByTestId('plan-editor-name-en'), { target: { value: 'Plan' } });
    fireEvent.change(screen.getByTestId('plan-editor-price'), { target: { value: '৩৯৯' } });
    fireEvent.click(screen.getByTestId('plan-editor-save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        goalId: ID(90),
        nameBn: 'প্ল্যান',
        nameEn: 'Plan',
        monthlyPrice: '৩৯৯',
        courseIds: [],
        examPackageIds: [ID(31)],
      }),
    );
  });

  it('shows the server price and item errors on the monthly price and the item picker', async () => {
    const onSave = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { price: ['errors.catalog.priceTooLow'], items: ['errors.catalog.planNoItems'] },
    }));
    plain(
      <PlansAdmin
        rows={[]}
        total={0}
        paging={paging}
        goals={GOALS}
        loadCandidates={async () => []}
        onSave={onSave}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('plans-new'));
    fireEvent.click(screen.getByTestId('plan-editor-save'));
    expect(await screen.findByTestId('plan-editor-price-error')).toBeTruthy();
    expect(screen.getByTestId('plan-items-error').textContent).toBe(
      'Add at least one course or exam package.',
    );
    expect(await screen.findByTestId('plan-items-table-empty')).toBeTruthy();
  });

  it('lists a published plan with its per-month price and hides the Goal choice when editing', async () => {
    const row: PlanAdminRow = {
      planId: ID(40),
      goalId: ID(90),
      nameBn: 'প্ল্যান',
      nameEn: 'Plan',
      monthlyPricePoisha: 29_900,
      status: 'published',
      courseIds: [ID(30)],
      examPackageIds: [],
      hasUnpublishedChanges: true,
      hasCurrentVersion: true,
      pinRank: null,
      version: 2,
    };
    plain(
      <PlansAdmin
        rows={[row]}
        total={1}
        paging={paging}
        goals={GOALS}
        loadCandidates={async () => candidates}
        onSave={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId('plans-table').textContent).toContain(`${money(29_900)} per month`);
    expect(screen.getByText('Unpublished changes')).toBeTruthy();
    expect(screen.getByTestId('plan-row-publish')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plan-row-edit'));
    expect(screen.queryByTestId('plan-editor-goal')).toBeNull();
    const boxes = (await screen.findAllByTestId('plan-item-checkbox')) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  });
});

describe('I1 Practice Packs (US5.4)', () => {
  const pack: PracticePackRowView = {
    practicePackId: ID(50),
    courseId: ID(20),
    titleBn: 'অনুশীলন',
    titleEn: 'Practice',
    listPricePoisha: 19_900,
    questionSetIds: [ID(51)],
    status: 'draft',
    version: 1,
  };

  it('asks for a published course before any pack can be added', () => {
    plain(
      <PracticePacksPanel
        courseId={ID(20)}
        isCoursePublished={false}
        rows={[]}
        onSave={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId('practice-packs-unpublished')).toBeTruthy();
    expect(screen.queryByTestId('practice-packs-new')).toBeNull();
  });

  it('creates a pack with question sets from the ID list', async () => {
    const onSave = vi.fn(async () => null);
    plain(
      <PracticePacksPanel
        courseId={ID(20)}
        isCoursePublished
        rows={[]}
        onSave={onSave}
        onAction={vi.fn()}
      />,
      'bn',
    );
    fireEvent.click(screen.getByTestId('practice-packs-new'));
    fireEvent.change(screen.getByTestId('pack-editor-title-bn'), { target: { value: 'অনুশীলন' } });
    fireEvent.change(screen.getByTestId('pack-editor-title-en'), { target: { value: 'Practice' } });
    fireEvent.change(screen.getByTestId('pack-editor-price'), { target: { value: '১৯৯' } });
    fireEvent.change(screen.getByTestId('pack-editor-question-sets'), {
      target: { value: `${ID(51)}\n${ID(52)}` },
    });
    fireEvent.click(screen.getByTestId('pack-editor-save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        courseId: ID(20),
        titleBn: 'অনুশীলন',
        titleEn: 'Practice',
        price: '১৯৯',
        questionSetIds: [ID(51), ID(52)],
      }),
    );
  });

  it('offers publish on a draft pack and shows its price through formatMoney', async () => {
    const onAction = vi.fn(async () => ({
      code: 'INVALID_STATE',
      i18nKey: 'errors.catalog.questionCheckUnavailable',
    }));
    plain(
      <PracticePacksPanel
        courseId={ID(20)}
        isCoursePublished
        rows={[pack]}
        onSave={vi.fn()}
        onAction={onAction}
      />,
    );
    expect(screen.getByTestId('practice-pack-row-price').textContent).toBe(money(19_900));
    fireEvent.click(screen.getByTestId('practice-pack-row-publish'));
    fireEvent.click(await screen.findByTestId('practice-pack-row-confirm-confirm'));
    expect((await screen.findByTestId('practice-pack-row-message')).textContent).toBe(
      "Questions can't be checked yet. Try again later.",
    );
    expect(onAction).toHaveBeenCalledWith('publish', pack);
  });
});
