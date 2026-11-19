// [LT] Step 19: I1 builder part 1 with React Testing Library (US3.1–US3.5; BR5.1, BR5.7, BR5.8,
// BR6.9; NFR7.201). Prices are asserted against formatMoney, never a literal (BR5.8).
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { formatDateTime } from '#src/lib/time.ts';
import { CourseEditor, type CourseEditorProps, type EditorSection } from './CourseEditor.tsx';
import { CourseList } from './CourseList.tsx';
import { NewCourseForm } from './NewCourseForm.tsx';

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

function ui(node: React.ReactNode, locale: 'bn' | 'en' = 'en') {
  return render(<I18nProvider locale={locale}>{node}</I18nProvider>);
}

const LEAD = '11111111-1111-4111-8111-111111111111';
const CO = '22222222-2222-4222-8222-222222222222';

function section(overrides: Partial<EditorSection> = {}): EditorSection {
  return {
    sectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    position: 1,
    structureState: 'active',
    titleBn: 'গণিত',
    titleEn: 'Maths',
    ownerId: LEAD,
    ownershipVersion: 1,
    workingVersion: 1,
    isLive: false,
    canEdit: true,
    ...overrides,
  };
}

function props(overrides: Partial<CourseEditorProps> = {}): CourseEditorProps {
  return {
    course: {
      courseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      titleBn: 'বিসিএস প্রস্তুতি',
      titleEn: 'BCS Preparation',
      status: 'draft',
      leadInstructorId: LEAD,
      listPricePoisha: 149950,
      accessDurationMonths: 6,
      durationLockedAt: null,
      version: 3,
    },
    role: 'lead',
    canManageCourse: true,
    viewerId: LEAD,
    sections: [
      section(),
      section({
        sectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        position: 2,
        titleEn: 'English',
        titleBn: 'ইংরেজি',
        ownerId: CO,
        canEdit: false,
      }),
    ],
    onSetPrice: vi.fn(async () => null),
    onSetDuration: vi.fn(async () => null),
    onAddSection: vi.fn(async () => null),
    onReorder: vi.fn(async () => null),
    onRemoveSection: vi.fn(async () => null),
    onCancelRemoval: vi.fn(async () => null),
    onAssign: vi.fn(async () => null),
    onEditTitle: vi.fn(async () => null),
    ...overrides,
  };
}

describe('price field (BR5.1, BR5.8)', () => {
  it('shows the current price exactly as formatMoney formats it, in each language', () => {
    const { unmount } = ui(<CourseEditor {...props()} />);
    expect(screen.getByTestId('course-editor-price-current').textContent).toContain(
      formatMoney(149950 as MoneyPoisha, 'en'),
    );
    unmount();
    ui(<CourseEditor {...props()} />, 'bn');
    expect(screen.getByTestId('course-editor-price-current').textContent).toContain(
      formatMoney(149950 as MoneyPoisha, 'bn'),
    );
  });

  it('accepts Bangla digits and previews the amount through formatMoney', () => {
    ui(<CourseEditor {...props()} />, 'bn');
    fireEvent.change(screen.getByTestId('course-editor-price-input'), {
      target: { value: '১৪৯৯.৫০' },
    });
    expect(screen.getByTestId('course-editor-price-input-hint').textContent).toContain(
      formatMoney(149950 as MoneyPoisha, 'bn'),
    );
  });

  it('announces a malformed price as a field error and never sends it', async () => {
    const p = props();
    ui(<CourseEditor {...p} />);
    fireEvent.change(screen.getByTestId('course-editor-price-input'), {
      target: { value: '1.234' },
    });
    fireEvent.click(screen.getByTestId('course-editor-price-submit'));
    const error = await screen.findByTestId('course-editor-price-input-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('course-editor-price-input').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(p.onSetPrice).not.toHaveBeenCalled();
  });

  it('shows the server field error (out of bounds) and sends the text exactly as typed', async () => {
    const onSetPrice = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { price: ['errors.catalog.priceAboveMax'] },
    }));
    ui(<CourseEditor {...props({ onSetPrice })} />);
    fireEvent.change(screen.getByTestId('course-editor-price-input'), {
      target: { value: '99999' },
    });
    fireEvent.click(screen.getByTestId('course-editor-price-submit'));
    expect((await screen.findByTestId('course-editor-price-input-error')).textContent).toBe(
      'The price is above the allowed maximum.',
    );
    expect(onSetPrice).toHaveBeenCalledWith('99999');
  });
});

describe('access duration (BR5.5, BR5.7)', () => {
  it('lets the Lead choose 4, 6 or 12 months', async () => {
    const p = props();
    ui(<CourseEditor {...p} />);
    fireEvent.click(screen.getByTestId('course-editor-tab-pricing'));
    const radios = within(screen.getByTestId('course-editor-duration')).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    fireEvent.click(screen.getByLabelText('12 months'));
    fireEvent.click(screen.getByTestId('course-editor-duration-submit'));
    await waitFor(() => expect(p.onSetDuration).toHaveBeenCalledWith(12));
  });

  it('is read-only with the lock date once locked', () => {
    const lockedAt = '2026-11-10T04:00:00.000Z';
    ui(<CourseEditor {...props({ course: { ...props().course, durationLockedAt: lockedAt } })} />);
    const text = screen.getByTestId('course-editor-duration-locked').textContent ?? '';
    expect(text).toContain('6 months');
    expect(text).toContain(formatDateTime(lockedAt, 'en'));
    expect(screen.queryByTestId('course-editor-duration-submit')).toBeNull();
  });
});

describe('Lead-only controls (BR6.9, AC3.5.3)', () => {
  it('are not rendered for a Co-instructor, who edits only their own section', () => {
    ui(
      <CourseEditor
        {...props({
          role: 'co_instructor',
          canManageCourse: false,
          viewerId: CO,
          sections: [
            section({ canEdit: false }),
            section({
              sectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              ownerId: CO,
              canEdit: true,
            }),
          ],
        })}
      />,
    );
    expect(screen.queryByTestId('course-editor-price-form')).toBeNull();
    expect(screen.queryByTestId('course-editor-duration-form')).toBeNull();
    expect(screen.queryByTestId('section-row-lead-controls')).toBeNull();
    expect(screen.queryByTestId('section-row-assign-form')).toBeNull();
    expect(screen.queryByTestId('course-editor-add-section')).toBeNull();
    expect(screen.getAllByTestId('section-row-edit')).toHaveLength(1);
    expect(screen.getByTestId('course-editor-duration-readonly')).toBeTruthy();
    // The price is still shown, through formatMoney.
    expect(screen.getByTestId('course-editor-price-current').textContent).toBe(
      formatMoney(149950 as MoneyPoisha, 'en'),
    );
  });

  it('labels the owner of each section for the Lead', () => {
    ui(<CourseEditor {...props()} />);
    const owners = screen.getAllByTestId('section-row-owner').map((n) => n.textContent);
    expect(owners).toEqual(['Owned by you', 'Co-instructor']);
  });
});

describe('sections (UC24, BR8.10–BR8.12)', () => {
  it('moves a section down by sending the full new order', async () => {
    const p = props();
    ui(<CourseEditor {...p} />);
    fireEvent.click(screen.getAllByTestId('section-row-move-down')[0] as HTMLElement);
    await waitFor(() =>
      expect(p.onReorder).toHaveBeenCalledWith([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]),
    );
    expect((screen.getAllByTestId('section-row-move-up')[0] as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows a pending removal and offers to keep the section', async () => {
    const p = props({
      sections: [
        section({ structureState: 'removal_pending', isLive: true }),
        section({ sectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      ],
    });
    ui(<CourseEditor {...p} />);
    expect(screen.getByTestId('section-row-pending-removal').textContent).toBe(
      'Removed at next publish',
    );
    fireEvent.click(screen.getByTestId('section-row-cancel-removal'));
    await waitFor(() =>
      expect(p.onCancelRemoval).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );
  });

  it('announces a refused removal (last section of a published course)', async () => {
    const onRemoveSection = vi.fn(async () => ({
      code: 'INVALID_STATE',
      i18nKey: 'errors.catalog.lastSection',
    }));
    ui(<CourseEditor {...props({ onRemoveSection })} />);
    fireEvent.click(screen.getAllByTestId('section-row-remove')[0] as HTMLElement);
    const error = await screen.findByTestId('section-row-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('A published course needs at least one section.');
  });

  it('refuses an empty section title before sending it', async () => {
    const p = props();
    ui(<CourseEditor {...p} />);
    fireEvent.change(screen.getByTestId('course-editor-add-section-title-en'), {
      target: { value: 'Physics' },
    });
    fireEvent.click(screen.getByTestId('course-editor-add-section-submit'));
    expect(
      (await screen.findByTestId('course-editor-add-section-title-bn-error')).textContent,
    ).toBe('Enter this title.');
    expect(p.onAddSection).not.toHaveBeenCalled();
  });

  it('assigns a section to the account ID typed in, and shows a field error from the server', async () => {
    const onAssign = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { assigneeId: ['errors.catalog.assigneeNotInstructor'] },
    }));
    ui(<CourseEditor {...props({ onAssign })} />);
    const form = screen.getAllByTestId('section-row-assign-form')[0] as HTMLElement;
    fireEvent.change(within(form).getByTestId('section-row-assignee'), {
      target: { value: ` ${CO} ` },
    });
    fireEvent.click(within(form).getByTestId('section-row-assign-submit'));
    expect((await within(form).findByTestId('section-row-assignee-error')).textContent).toBe(
      'Choose someone who is an instructor.',
    );
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ ownershipVersion: 1 }), CO);
  });
});

describe('new-course form (UC7, BR4.2, AC3.1.2)', () => {
  const goals = [
    { goalId: '33333333-3333-4333-8333-333333333333', nameBn: 'বিসিএস', nameEn: 'BCS' },
  ];

  it('refuses an empty Goal with an announced field error, using the shared schema', async () => {
    const onCreate = vi.fn(async () => null);
    ui(<NewCourseForm goals={goals} onCreate={onCreate} />);
    fireEvent.change(screen.getByTestId('new-course-form-title-bn'), { target: { value: 'গণিত' } });
    fireEvent.change(screen.getByTestId('new-course-form-title-en'), {
      target: { value: 'Maths' },
    });
    fireEvent.click(screen.getByTestId('new-course-form-submit'));
    const error = await screen.findByTestId('new-course-form-goal-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a draft with its sections', async () => {
    const onCreate = vi.fn(async () => null);
    ui(<NewCourseForm goals={goals} onCreate={onCreate} />);
    fireEvent.click(screen.getByLabelText('BCS'));
    fireEvent.change(screen.getByTestId('new-course-form-title-bn'), { target: { value: 'গণিত' } });
    fireEvent.change(screen.getByTestId('new-course-form-title-en'), {
      target: { value: 'Maths' },
    });
    fireEvent.click(screen.getByTestId('new-course-form-add-section'));
    fireEvent.change(screen.getByTestId('new-course-form-section-title-bn'), {
      target: { value: 'বীজগণিত' },
    });
    fireEvent.change(screen.getByTestId('new-course-form-section-title-en'), {
      target: { value: 'Algebra' },
    });
    fireEvent.click(screen.getByTestId('new-course-form-submit'));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: goals[0]?.goalId,
          sections: [expect.objectContaining({ titleBn: 'বীজগণিত', titleEn: 'Algebra' })],
        }),
      ),
    );
  });
});

describe('course list (US3.1)', () => {
  it('shows each course with its role and its price through formatMoney', async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <I18nProvider locale="en">
          <CourseList
            rows={[
              {
                courseId: 'c1',
                titleBn: 'গণিত',
                titleEn: 'Maths',
                status: 'draft',
                isLead: true,
                listPricePoisha: 120025,
                accessDurationMonths: 6,
              },
              {
                courseId: 'c2',
                titleBn: 'ইংরেজি',
                titleEn: 'English',
                status: 'published',
                isLead: false,
                listPricePoisha: null,
                accessDurationMonths: null,
              },
            ]}
            paging={{ page: 1, pages: 1, onPage: vi.fn() }}
          />
        </I18nProvider>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={router as never} />);
    const rows = await screen.findAllByTestId('course-list-table-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(formatMoney(120025 as MoneyPoisha, 'en'));
    expect(rows[0]?.textContent).toContain('Lead Instructor');
    expect(rows[1]?.textContent).toContain('Co-instructor');
    expect(rows[1]?.textContent).toContain('Not set');
  });
});

describe('course builder layout', () => {
  it('opens on the curriculum and switches tabs', () => {
    ui(<CourseEditor {...props()} />);
    expect(screen.getByTestId('course-editor-tab-curriculum').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      (screen.getByTestId('course-editor-sections').closest('[role=tabpanel]') as HTMLElement)
        .hidden,
    ).toBe(false);
    fireEvent.click(screen.getByTestId('course-editor-tab-pricing'));
    expect(screen.getByTestId('course-editor-tab-pricing').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      (screen.getByTestId('course-editor-sections').closest('[role=tabpanel]') as HTMLElement)
        .hidden,
    ).toBe(true);
  });

  it('shows the Publish and Practice packs tabs only when the route supplies them', () => {
    ui(<CourseEditor {...props()} publishPanel={<p>publish</p>} />);
    expect(screen.getByTestId('course-editor-tab-publish')).toBeTruthy();
    expect(screen.queryByTestId('course-editor-tab-packs')).toBeNull();
  });
});
