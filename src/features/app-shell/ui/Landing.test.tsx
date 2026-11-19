// [LT] Public landing page: the OMR question demo and the sign-up entry points.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { Landing, QuestionSheet } from './Landing.tsx';

function inRouter(locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale={locale}>
        <Landing />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router as never} />);
}

const sheet = (locale: 'bn' | 'en' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <QuestionSheet />
    </I18nProvider>,
  );

describe('QuestionSheet', () => {
  it('confirms a correct answer and locks the other bubbles', () => {
    sheet();
    fireEvent.click(screen.getByTestId('landing-question-b'));
    expect(screen.getByTestId('landing-question-result').textContent).toContain('Correct');
    expect(screen.getByTestId('landing-question-b').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('landing-question-a') as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains the Mistake Vault on a wrong answer and names the right one', () => {
    sheet();
    fireEvent.click(screen.getByTestId('landing-question-d'));
    const result = screen.getByTestId('landing-question-result').textContent ?? '';
    expect(result).toContain('Mistake Vault');
    expect(result).toContain('Louis I. Kahn');
  });

  it('clears the answer so the visitor can try again', () => {
    sheet();
    fireEvent.click(screen.getByTestId('landing-question-a'));
    fireEvent.click(screen.getByTestId('landing-question-clear'));
    expect(screen.queryByTestId('landing-question-result')).toBeNull();
    expect((screen.getByTestId('landing-question-a') as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses Bangla option letters in Bangla', () => {
    sheet('bn');
    expect(screen.getByTestId('landing-question-a').textContent).toContain('ক');
  });
});

describe('Landing', () => {
  it('sends the goals and "Browse courses" to the catalog and the sign-up buttons to sign-up', async () => {
    inRouter();
    expect(await screen.findByTestId('landing-page')).toBeTruthy();
    const goals = screen.getAllByTestId('landing-goal');
    expect(goals).toHaveLength(6);
    for (const link of [...goals, screen.getByTestId('landing-browse-courses')]) {
      expect(link.getAttribute('href')).toBe('/catalog');
    }
    for (const link of [
      screen.getByTestId('home-sign-up'),
      screen.getByTestId('landing-final-sign-up'),
    ]) {
      expect(link.getAttribute('href')).toBe('/sign-up');
    }
    expect(screen.getByTestId('home-sign-in').getAttribute('href')).toBe('/sign-in');
  });
});
