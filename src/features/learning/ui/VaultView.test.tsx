// [LT] Mistake Vault screen: summary, an empty vault, and one practice round that marks right and
// wrong answers, shows the run towards mastery and ends with a tally.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import type { VaultSummary } from '../server/vault.server.ts';
import { VaultView } from './VaultView.tsx';

function inRouter(node: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <I18nProvider locale="en">{node}</I18nProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router as never} />);
}

const summary = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  active: 2,
  mastered: 1,
  answeredToday: 0,
  currentGoalId: 'g1',
  groups: [
    {
      groupId: 'c1',
      kind: 'course',
      titleBn: 'কোর্স',
      titleEn: 'Course one',
      isCurrentGoal: true,
      active: 2,
      mastered: 1,
    },
  ],
  ...over,
});

const question = (id: string) => ({
  questionId: id,
  groupTitleBn: 'কোর্স',
  groupTitleEn: 'Course one',
  promptBn: 'প্রশ্ন',
  promptEn: `Prompt ${id}?`,
  optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
  optionsEn: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  correctRun: 0,
  wrongCount: 1,
  lastWrongChoice: 0,
});

describe('VaultView', () => {
  it('shows the counts and the course list', async () => {
    inRouter(
      <VaultView summary={summary()} onStart={vi.fn()} onAnswer={vi.fn()} onDone={vi.fn()} />,
    );
    expect((await screen.findByTestId('vault-page')).textContent).toContain('Course one');
    expect(screen.getByTestId('vault-start')).toBeTruthy();
  });

  it('shows an empty state instead of a start button when nothing waits', async () => {
    inRouter(
      <VaultView
        summary={summary({ active: 0, groups: [] })}
        onStart={vi.fn()}
        onAnswer={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect((await screen.findByTestId('vault-empty')).textContent).toContain('mastered');
    expect(screen.queryByTestId('vault-start')).toBeNull();
  });

  it('runs a round: marks a wrong answer, then a mastering one, and tallies', async () => {
    const onStart = vi.fn(async () => ({
      ok: true as const,
      value: { questions: [question('q1'), question('q2')] },
    }));
    const onAnswer = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          isCorrect: false,
          correctIndex: 2,
          explanationBn: null,
          explanationEn: 'Because.',
          status: 'active',
          correctRun: 0,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          isCorrect: true,
          correctIndex: 1,
          explanationBn: null,
          explanationEn: null,
          status: 'mastered',
          correctRun: 2,
        },
      });
    const onDone = vi.fn();
    inRouter(
      <VaultView summary={summary()} onStart={onStart} onAnswer={onAnswer} onDone={onDone} />,
    );

    fireEvent.click(await screen.findByTestId('vault-start'));
    await screen.findByTestId('vault-practice');
    expect((screen.getByTestId('vault-check') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByTestId('vault-option')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('vault-check'));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('q1', 0));
    expect((await screen.findByTestId('vault-result')).textContent).toContain(
      'The right answer is C',
    );

    fireEvent.click(screen.getByTestId('vault-next'));
    fireEvent.click(screen.getAllByTestId('vault-option')[1] as HTMLElement);
    fireEvent.click(screen.getByTestId('vault-check'));
    expect((await screen.findByTestId('vault-result')).textContent).toContain('Mastered');

    fireEvent.click(screen.getByTestId('vault-next'));
    expect((await screen.findByTestId('vault-finished')).textContent).toContain(
      '1 of 2 correct, 1 mastered',
    );
    fireEvent.click(screen.getByTestId('vault-back'));
    expect(onDone).toHaveBeenCalled();
  });
});
