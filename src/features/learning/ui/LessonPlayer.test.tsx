// [LT] Lesson player: quiz answers reach the server call, results show the right answers, video
// loads only on tap, and reading and done states render.
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
import type { LessonView, QuizResult } from '../server/learning.types.ts';
import { LessonPlayer, nativeChoice } from './LessonPlayer.tsx';

const ID = (n: number) => `0f9a5b2e-6d1c-4b8e-9a7f-${String(n).padStart(12, '0')}`;

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

const question = (n: number) => ({
  questionId: ID(n),
  position: n,
  promptBn: `প্রশ্ন ${n}`,
  promptEn: `Question ${n}?`,
  optionsBn: ['ক১', 'খ১', 'গ১', 'ঘ১'],
  optionsEn: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
});

function lesson(overrides: Partial<LessonView> = {}): LessonView {
  return {
    courseId: ID(1),
    courseTitleBn: 'কোর্স',
    courseTitleEn: 'Course',
    lessonId: ID(2),
    kind: 'quiz',
    titleBn: 'কুইজ',
    titleEn: 'Practice quiz',
    sectionTitleBn: 'অংশ',
    sectionTitleEn: 'Section',
    number: 3,
    lessonCount: 9,
    bodyBn: null,
    bodyEn: null,
    youtubeVideoId: null,
    isCompleted: false,
    previousLessonId: ID(3),
    nextLessonId: ID(4),
    questions: [question(10), question(11)],
    lastResult: null,
    progress: { completed: 2, total: 9, percent: 22, nextLessonId: ID(2) },
    bonusLock: null,
    viewer: null,
    ...overrides,
  };
}

const result: QuizResult = {
  score: 1,
  total: 2,
  submittedAt: '2026-11-18T00:00:00.000Z',
  answers: [
    {
      questionId: ID(10),
      chosenIndex: 1,
      correctIndex: 1,
      isCorrect: true,
      explanationBn: null,
      explanationEn: 'Because B.',
    },
    {
      questionId: ID(11),
      chosenIndex: 0,
      correctIndex: 2,
      isCorrect: false,
      explanationBn: null,
      explanationEn: null,
    },
  ],
};

describe('LessonPlayer quiz', () => {
  it('sends each chosen option (and null for a skipped one) and shows the graded result', async () => {
    const onSubmitQuiz = vi.fn(async () => result);
    inRouter(<LessonPlayer lesson={lesson()} onComplete={vi.fn()} onSubmitQuiz={onSubmitQuiz} />);
    const options = await screen.findAllByTestId('quiz-option');
    fireEvent.click(options[1] as HTMLElement); // question 1, option B
    fireEvent.click(screen.getByTestId('quiz-submit'));
    await waitFor(() =>
      expect(onSubmitQuiz).toHaveBeenCalledWith([
        { questionId: ID(10), chosenIndex: 1 },
        { questionId: ID(11), chosenIndex: null },
      ]),
    );
    expect((await screen.findByTestId('quiz-score')).textContent).toBe('1/2');
    expect(screen.getByText('Because B.')).toBeTruthy();
  });

  it('opens on the last result and lets the Student try again', async () => {
    inRouter(
      <LessonPlayer
        lesson={lesson({ lastResult: result })}
        onComplete={vi.fn()}
        onSubmitQuiz={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('quiz-result')).toBeTruthy();
    fireEvent.click(screen.getByTestId('quiz-retake'));
    expect(await screen.findByTestId('quiz-form')).toBeTruthy();
  });

  it('keeps the form open when the submission fails', async () => {
    inRouter(
      <LessonPlayer
        lesson={lesson()}
        onComplete={vi.fn()}
        onSubmitQuiz={vi.fn(async () => null)}
      />,
    );
    fireEvent.click(await screen.findByTestId('quiz-submit'));
    await waitFor(() => expect(screen.getByTestId('quiz-form')).toBeTruthy());
    expect(screen.queryByTestId('quiz-result')).toBeNull();
  });
});

describe('LessonPlayer video and reading', () => {
  it('loads the YouTube embed only after the Student taps play', async () => {
    inRouter(
      <LessonPlayer
        lesson={lesson({ kind: 'video', questions: [], youtubeVideoId: 'RGqj9z65P3Y' })}
        onComplete={vi.fn()}
        onSubmitQuiz={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('lesson-video-play')).toBeTruthy();
    expect(screen.queryByTestId('lesson-video-frame')).toBeNull();
    fireEvent.click(screen.getByTestId('lesson-video-play'));
    expect(screen.getByTestId('lesson-video-frame').getAttribute('src')).toContain(
      'https://www.youtube-nocookie.com/embed/RGqj9z65P3Y',
    );
  });

  it('US3.12: draws the viewer badge (aria-hidden) and explains it once', async () => {
    const onDismiss = vi.fn(async () => undefined);
    inRouter(
      <LessonPlayer
        lesson={lesson({
          kind: 'video',
          questions: [],
          youtubeVideoId: 'RGqj9z65P3Y',
          viewer: { badge: 'CS-0F9A5B2E', badgeSeconds: 45, showNotice: true },
        })}
        onComplete={vi.fn()}
        onSubmitQuiz={vi.fn()}
        onDismissBadgeNotice={onDismiss}
      />,
    );
    fireEvent.click(await screen.findByTestId('lesson-video-play'));
    const badge = screen.getByTestId('lesson-video-badge');
    expect(badge.textContent).toBe('CS-0F9A5B2E');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    // The Student's ID never goes to the video service, and YouTube's own full screen is off.
    const src = screen.getByTestId('lesson-video-frame').getAttribute('src') ?? '';
    expect(src).not.toContain('CS-');
    expect(src).toContain('fs=0');
    expect(screen.getByTestId('lesson-video-fullscreen')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lesson-video-notice-ok'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('lesson-video-notice')).toBeNull();
  });

  it('renders a reading and marks it done', async () => {
    const onComplete = vi.fn(async () => undefined);
    inRouter(
      <LessonPlayer
        lesson={lesson({
          kind: 'text',
          questions: [],
          bodyEn: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Key idea.' }] }],
          },
        })}
        onComplete={onComplete}
        onSubmitQuiz={vi.fn()}
      />,
    );
    expect((await screen.findByTestId('lesson-body')).textContent).toContain('Key idea.');
    fireEvent.click(screen.getByTestId('lesson-complete'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });
});

describe('nativeChoice', () => {
  it('reads a checked radio from the form and ignores bad values', () => {
    const form = document.createElement('form');
    form.innerHTML =
      '<input type="radio" name="q-a" value="2" checked /><input type="radio" name="q-b" value="9" checked />';
    expect(nativeChoice(form, 'a')).toBe(2);
    expect(nativeChoice(form, 'b')).toBeNull();
    expect(nativeChoice(form, 'c')).toBeNull();
    expect(nativeChoice(null, 'a')).toBeNull();
  });
});
