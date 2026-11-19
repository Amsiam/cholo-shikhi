// [LT] Step 10: S1 picker, S12 change section and A4 forms with React Testing Library (BR2.1–BR2.3,
// BR2.6, AC1.10.2, NFR7.201, NFR7.202).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { ChangeGoalSection } from './ChangeGoalSection.tsx';
import { GoalForm } from './GoalForm.tsx';
import { GoalPicker } from './GoalPicker.tsx';
import { GoalsAdmin, type GoalsAdminProps } from './GoalsAdmin.tsx';
import type { GoalGroup } from './goal-choice.tsx';
import { EMPTY_SEGMENT, SegmentForm } from './SegmentForm.tsx';

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

const GROUPS: GoalGroup[] = [
  {
    segmentId: '11111111-1111-4111-8111-111111111111',
    nameBn: 'চাকরি',
    nameEn: 'Jobs',
    goals: [
      { goalId: '33333333-3333-4333-8333-333333333333', nameBn: 'বিসিএস', nameEn: 'BCS' },
      { goalId: 'g-bank', nameBn: 'ব্যাংক', nameEn: 'Bank' },
    ],
  },
  {
    segmentId: 's-hsc',
    nameBn: 'এইচএসসি',
    nameEn: 'HSC',
    goals: [{ goalId: 'g-sci', nameBn: 'বিজ্ঞান', nameEn: 'Science' }],
  },
];

describe('S1 GoalPicker', () => {
  it('groups the active Goals under their segment headings, in the given order', () => {
    ui(
      <GoalPicker
        state={{ kind: 'loaded', groups: GROUPS }}
        onRetry={vi.fn()}
        onChoose={vi.fn()}
      />,
    );
    const segments = screen.getAllByTestId('goal-picker-list-segment');
    expect(segments).toHaveLength(2);
    expect(within(segments[0] as HTMLElement).getAllByRole('radio')).toHaveLength(2);
    expect(within(segments[0] as HTMLElement).getByRole('heading').textContent).toContain('Jobs');
    expect(within(segments[1] as HTMLElement).getByLabelText('Science')).toBeTruthy();
  });

  it('shows names in the active language (Bangla)', () => {
    ui(
      <GoalPicker
        state={{ kind: 'loaded', groups: GROUPS }}
        onRetry={vi.fn()}
        onChoose={vi.fn()}
      />,
      'bn',
    );
    expect(screen.getByLabelText('বিসিএস')).toBeTruthy();
  });

  it('confirms only after a Goal is picked, then calls onChoose with its ID', async () => {
    const onChoose = vi.fn(async () => null);
    ui(
      <GoalPicker
        state={{ kind: 'loaded', groups: GROUPS }}
        onRetry={vi.fn()}
        onChoose={onChoose}
      />,
    );
    const confirm = screen.getByTestId('goal-picker-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Bank'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('g-bank'));
  });

  it('announces a refused choice', async () => {
    const onChoose = vi.fn(async () => ({ i18nKey: 'errors.goals.goalNotActive' }));
    ui(
      <GoalPicker
        state={{ kind: 'loaded', groups: GROUPS }}
        onRetry={vi.fn()}
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByLabelText('BCS'));
    fireEvent.click(screen.getByTestId('goal-picker-confirm'));
    const alert = await screen.findByTestId('goal-picker-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe('This goal is not available. Choose another.');
  });

  it('BR2.3 shows "No goals are available yet" when none is active', () => {
    ui(<GoalPicker state={{ kind: 'loaded', groups: [] }} onRetry={vi.fn()} onChoose={vi.fn()} />);
    expect(screen.getByTestId('goal-picker-empty').textContent).toBe('No goals are available yet');
  });

  it('BR2.3 offers Retry when the load failed', () => {
    const onRetry = vi.fn();
    ui(<GoalPicker state={{ kind: 'failed' }} onRetry={onRetry} onChoose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load goals.");
    fireEvent.click(screen.getByTestId('goal-picker-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('S12 ChangeGoalSection', () => {
  const current = {
    goalId: '33333333-3333-4333-8333-333333333333',
    nameBn: 'বিসিএস',
    nameEn: 'BCS',
  };

  it('shows the current Goal and does not offer it again', () => {
    ui(<ChangeGoalSection current={current} groups={GROUPS} onChange={vi.fn()} />);
    expect(screen.getByTestId('goal-change-current').textContent).toBe('Current goal: BCS');
    expect(screen.queryByLabelText('BCS')).toBeNull();
    expect(screen.getByLabelText('Bank')).toBeTruthy();
  });

  it('AC1.10.2 moves focus into the warning dialog, and on cancel changes nothing and returns focus', async () => {
    const onChange = vi.fn(async () => null);
    ui(<ChangeGoalSection current={current} groups={GROUPS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Bank'));
    const trigger = screen.getByTestId('goal-change-open');
    fireEvent.click(trigger);
    const dialog = await screen.findByTestId('goal-change-dialog');
    expect(dialog.textContent).toContain('Your goal streak starts again at 0');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.click(screen.getByTestId('goal-change-cancel'));
    await waitFor(() => expect(screen.queryByTestId('goal-change-dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('changes Goal only after the warning is confirmed', async () => {
    const onChange = vi.fn(async () => null);
    ui(<ChangeGoalSection current={current} groups={GROUPS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Science'));
    fireEvent.click(screen.getByTestId('goal-change-open'));
    fireEvent.click(await screen.findByTestId('goal-change-confirm'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('g-sci'));
    expect((await screen.findByTestId('goal-change-done')).textContent).toBe(
      'Your goal is now Science.',
    );
  });

  it('cannot open the dialog before another Goal is picked', () => {
    ui(<ChangeGoalSection current={current} groups={GROUPS} onChange={vi.fn()} />);
    expect((screen.getByTestId('goal-change-open') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('A4 forms (NFR7.201: field errors are linked and announced)', () => {
  it('AC1.15.2 refuses an empty Bangla name with an announced field error and does not save', async () => {
    const onSave = vi.fn(async () => null);
    ui(
      <GoalForm
        initial={{
          segmentId: '11111111-1111-4111-8111-111111111111',
          nameBn: '',
          nameEn: 'BCS',
          status: 'active',
          sortOrder: '0',
        }}
        segments={GROUPS}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('goal-form-submit'));
    const error = await screen.findByTestId('goal-form-name-bn-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('Enter this name.');
    const input = screen.getByTestId('goal-form-name-bn');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a valid segment with numbers parsed from the form', async () => {
    const onSave = vi.fn(async () => null);
    ui(<SegmentForm initial={EMPTY_SEGMENT} onSave={onSave} />);
    fireEvent.change(screen.getByTestId('segment-form-name-bn'), { target: { value: 'ব্যাংক' } });
    fireEvent.change(screen.getByTestId('segment-form-name-en'), { target: { value: 'Bank' } });
    fireEvent.change(screen.getByTestId('segment-form-battle-band'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByTestId('segment-form-sort-order'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('segment-form-submit'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          nameEn: 'Bank',
          battleBand: 'bank',
          sortOrder: 3,
          segmentType: 'academic',
        }),
      ),
    );
  });

  it('AC1.16.3 asks for confirmation before saving a segment type change', async () => {
    const onSave = vi.fn(async () => null);
    ui(
      <SegmentForm
        initial={{
          segmentId: '22222222-2222-4222-8222-222222222222',
          expectedVersion: 2,
          nameBn: 'এইচএসসি',
          nameEn: 'HSC',
          segmentType: 'academic',
          battleBand: 'hsc',
          sortOrder: '0',
        }}
        originalType="academic"
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByLabelText('Job aspirant'));
    fireEvent.click(screen.getByTestId('segment-form-submit'));
    const dialog = await screen.findByTestId('segment-form-type-confirm');
    expect(dialog.textContent).toContain('applies to new purchases and trials only');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('segment-form-type-confirm-confirm'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ segmentType: 'job_aspirant', expectedVersion: 2 }),
      ),
    );
  });

  it('shows a server field error such as a duplicate name', async () => {
    const onSave = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { nameEn: ['errors.goals.nameDuplicate'] },
    }));
    ui(
      <SegmentForm
        initial={{ ...EMPTY_SEGMENT, nameBn: 'ক', nameEn: 'A', battleBand: 'a' }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('segment-form-submit'));
    expect((await screen.findByTestId('segment-form-name-en-error')).textContent).toBe(
      'This name is already used.',
    );
  });
});

describe('A4 GoalsAdmin', () => {
  const props = (overrides: Partial<GoalsAdminProps> = {}): GoalsAdminProps => ({
    segments: {
      rows: [
        {
          segmentId: '11111111-1111-4111-8111-111111111111',
          nameBn: 'চাকরি',
          nameEn: 'Jobs',
          segmentType: 'job_aspirant',
          battleBand: 'jobs',
          sortOrder: 0,
          version: 1,
          goalCount: 2,
        },
      ],
      total: 1,
      page: 1,
      paging: { page: 1, pages: 1, onPage: vi.fn() },
    },
    goals: {
      rows: [
        {
          goalId: '33333333-3333-4333-8333-333333333333',
          segmentId: '11111111-1111-4111-8111-111111111111',
          nameBn: 'বিসিএস',
          nameEn: 'BCS',
          status: 'active',
          sortOrder: 0,
          version: 1,
        },
        {
          goalId: 'g-old',
          segmentId: '11111111-1111-4111-8111-111111111111',
          nameBn: 'পুরোনো',
          nameEn: 'Old',
          status: 'retired',
          sortOrder: 1,
          version: 3,
        },
      ],
      total: 2,
      page: 1,
      paging: { page: 1, pages: 1, onPage: vi.fn() },
    },
    onSaveSegment: vi.fn(async () => null),
    onDeleteSegment: vi.fn(async () => null),
    onSaveGoal: vi.fn(async () => null),
    onRetireGoal: vi.fn(async () => null),
    ...overrides,
  });

  it('lists segments with their Goal counts and Goals with their segment and status', () => {
    ui(<GoalsAdmin {...props()} />);
    const segmentRow = screen.getAllByTestId('segment-table-row')[0] as HTMLElement;
    expect(segmentRow.textContent).toContain('Job aspirant');
    expect(segmentRow.textContent).toContain('2');
    const goalRows = screen.getAllByTestId('goal-table-row');
    expect(goalRows[0]?.textContent).toContain('Jobs');
    expect(goalRows[1]?.textContent).toContain('Retired');
    // A retired Goal offers no edit or retire action (BR1.4: terminal).
    expect(within(goalRows[1] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('AC1.16.2 states the linked Goal count when a delete is refused', async () => {
    const onDeleteSegment = vi.fn(async () => ({
      code: 'CONFLICT',
      i18nKey: 'errors.goals.segmentHasGoals',
    }));
    ui(<GoalsAdmin {...props({ onDeleteSegment })} />);
    fireEvent.click(screen.getByTestId('segment-table-delete'));
    fireEvent.click(await screen.findByTestId('segment-delete-confirm-confirm'));
    const message = await screen.findByTestId('goals-admin-message');
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe(
      'This segment still has 2 goals linked to it. Move or remove them first.',
    );
    expect(onDeleteSegment).toHaveBeenCalledWith({
      segmentId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 1,
    });
  });

  it('AC1.15.3 retires a Goal only after confirmation, with its version', async () => {
    const onRetireGoal = vi.fn(async () => null);
    ui(<GoalsAdmin {...props({ onRetireGoal })} />);
    fireEvent.click(screen.getByTestId('goal-table-retire'));
    const dialog = await screen.findByTestId('goal-retire-confirm');
    expect(dialog.textContent).toContain('Students who follow it keep it');
    fireEvent.click(screen.getByTestId('goal-retire-confirm-confirm'));
    await waitFor(() =>
      expect(onRetireGoal).toHaveBeenCalledWith({
        goalId: '33333333-3333-4333-8333-333333333333',
        expectedVersion: 1,
      }),
    );
  });

  it('opens the edit form with the row values and its version', async () => {
    const onSaveGoal = vi.fn(async () => null);
    ui(<GoalsAdmin {...props({ onSaveGoal })} />);
    fireEvent.click(screen.getByTestId('goal-table-edit'));
    expect((screen.getByTestId('goal-form-name-en') as HTMLInputElement).value).toBe('BCS');
    fireEvent.click(screen.getByTestId('goal-form-submit'));
    await waitFor(() =>
      expect(onSaveGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: '33333333-3333-4333-8333-333333333333',
          expectedVersion: 1,
        }),
      ),
    );
  });
});
