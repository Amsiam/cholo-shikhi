// Public landing page for signed-out visitors on `/`, drawn as an exam OMR answer sheet.
// Every string comes from the i18n catalogue.
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Choice = 'a' | 'b' | 'c' | 'd';
const CHOICES: readonly Choice[] = ['a', 'b', 'c', 'd'];
// Louis I. Kahn designed Jatiya Sangsad Bhaban (completed 1982).
export const CORRECT_CHOICE: Choice = 'b';

const GOAL_ROWS: ReadonlyArray<{ heading: MessageKey; goals: readonly MessageKey[] }> = [
  {
    heading: 'landing.goals.academic',
    goals: ['landing.goals.class68', 'landing.goals.hsc', 'landing.goals.admission'],
  },
  {
    heading: 'landing.goals.jobs',
    goals: ['landing.goals.bcs', 'landing.goals.bank', 'landing.goals.ntrca'],
  },
];

// Example vault rows. A topic clears after two right answers in a row (FR-ADP-1).
const VAULT_ROWS: ReadonlyArray<{
  topic: MessageKey;
  status: MessageKey;
  attempts: readonly boolean[];
  isCleared: boolean;
}> = [
  {
    topic: 'landing.vault.row1.topic',
    status: 'landing.vault.row1.status',
    attempts: [false, true, true],
    isCleared: true,
  },
  {
    topic: 'landing.vault.row2.topic',
    status: 'landing.vault.row2.status',
    attempts: [false, false, true],
    isCleared: false,
  },
  {
    topic: 'landing.vault.row3.topic',
    status: 'landing.vault.row3.status',
    attempts: [false],
    isCleared: false,
  },
];

const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
const ctaClass =
  'inline-flex min-h-12 items-center justify-center rounded-sm bg-primary px-6 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-omr/50 motion-reduce:transition-none';
// Faint answer-sheet ruling behind the hero.
const ruled = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, var(--paper-line) 31px, var(--paper-line) 32px)',
};

export function Landing(props: { verified?: boolean }) {
  const { t } = useI18n();
  return (
    <div data-testid="landing-page" className="bg-paper text-ink">
      {props.verified ? (
        <p role="status" data-testid="home-verified" className={`${container} pt-4`}>
          {t('home.verified')}
        </p>
      ) : null}

      <section aria-labelledby="landing-hero-title" style={ruled}>
        <div
          className={`${container} grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]`}
        >
          <div className="flex min-w-0 flex-col gap-7">
            <h1
              id="landing-hero-title"
              className="text-5xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl"
            >
              <span className="relative inline-block whitespace-nowrap">
                {t('landing.hero.titleMark')}
                <RedPenStroke />
              </span>{' '}
              {t('landing.hero.titleRest')}
            </h1>
            <p className="max-w-[34rem] text-lg leading-relaxed text-ink/80">
              {t('landing.hero.body')}
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link to="/sign-up" className={ctaClass} data-testid="home-sign-up">
                {t('landing.hero.primary')}
              </Link>
              <Link
                to="/catalog"
                search={{}}
                className="inline-flex min-h-12 items-center justify-center rounded-sm border-2 border-primary px-6 text-base font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                data-testid="landing-browse-courses"
              >
                {t('landing.hero.browse')}
              </Link>
              <Link
                to="/sign-in"
                className="tap-target font-medium underline decoration-omr decoration-2 underline-offset-4 hover:text-omr"
                data-testid="home-sign-in"
              >
                {t('landing.hero.signIn')}
              </Link>
            </div>
          </div>
          <QuestionSheet />
        </div>
      </section>

      <section aria-labelledby="landing-goals-title" className="border-y-2 border-omr bg-paper">
        <div
          className={`${container} grid gap-8 py-14 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]`}
        >
          <div className="flex flex-col gap-3">
            <h2 id="landing-goals-title" className="text-3xl font-bold text-balance">
              {t('landing.goals.title')}
            </h2>
            <p className="text-ink/75">{t('landing.goals.body')}</p>
          </div>
          <div className="flex min-w-0 flex-col divide-y divide-omr/30 border border-omr/60 bg-background">
            {GOAL_ROWS.map((row) => (
              <div
                key={row.heading}
                className="grid gap-3 p-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center"
              >
                <h3 className="text-sm font-semibold tracking-wide text-omr uppercase">
                  {t(row.heading)}
                </h3>
                <ul className="flex flex-wrap gap-x-6 gap-y-3">
                  {row.goals.map((goal) => (
                    <li key={goal}>
                      <Link
                        to="/catalog"
                        search={{}}
                        className="group inline-flex min-h-11 items-center gap-3 rounded-sm pr-2 font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-omr/50"
                        data-testid="landing-goal"
                      >
                        <span
                          aria-hidden="true"
                          className="size-6 shrink-0 rounded-full border-2 border-omr transition-colors group-hover:border-ink group-hover:bg-ink"
                        />
                        {t(goal)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="landing-vault-title" className={`${container} py-16`}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <VaultLedger />
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-3 border-t-2 border-omr pt-5">
              <h2 className="text-2xl font-bold text-balance">{t('landing.streak.title')}</h2>
              <p className="leading-relaxed text-ink/80">{t('landing.streak.body')}</p>
            </div>
            <div className="flex flex-col gap-3 border-t-2 border-omr pt-5">
              <h2 className="text-2xl font-bold text-balance">{t('landing.phone.title')}</h2>
              <p className="leading-relaxed text-ink/80">{t('landing.phone.body')}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="landing-teach-title" className="bg-ink text-ink-foreground">
        <div className={`${container} grid gap-6 py-14 md:grid-cols-2 md:items-end`}>
          <h2 id="landing-teach-title" className="text-3xl font-bold text-balance md:text-4xl">
            {t('landing.teach.title')}
          </h2>
          <p className="leading-relaxed text-ink-foreground/85">{t('landing.teach.body')}</p>
        </div>
      </section>

      <section aria-labelledby="landing-final-title" className={`${container} py-16`}>
        <div className="flex flex-col items-start gap-6 border-t-2 border-omr pt-8 md:flex-row md:items-center md:justify-between">
          <h2 id="landing-final-title" className="text-3xl font-bold text-balance md:text-4xl">
            {t('landing.final.title')}
          </h2>
          <Link to="/sign-up" className={ctaClass} data-testid="landing-final-sign-up">
            {t('landing.hero.primary')}
          </Link>
        </div>
      </section>
    </div>
  );
}

// A red-pen underline, the way a teacher marks the line that matters.
function RedPenStroke() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 300 16"
      preserveAspectRatio="none"
      className="absolute -bottom-2 left-0 h-3 w-full text-omr"
    >
      <path
        d="M3 11 C 60 4, 120 5, 180 8 S 270 10, 297 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// One real MCQ, answered by filling a bubble. A wrong answer shows what the Mistake Vault would do.
export function QuestionSheet() {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Choice | null>(null);
  const isAnswered = picked !== null;
  const isCorrect = picked === CORRECT_CHOICE;
  return (
    <div
      className="w-full border-2 border-omr bg-background shadow-[8px_8px_0_var(--omr-soft)]"
      data-testid="landing-question"
    >
      <p className="border-b-2 border-omr bg-omr-soft px-5 py-2 text-sm font-medium text-omr">
        {t('landing.q.meta')}
      </p>
      <fieldset className="flex flex-col gap-4 p-5">
        <legend className="float-left mb-1 w-full text-lg leading-snug font-semibold">
          {t('landing.q.prompt')}
        </legend>
        <p className="clear-both text-sm text-ink-muted">{t('landing.q.hint')}</p>
        <div className="flex flex-col gap-1">
          {CHOICES.map((choice) => {
            const isPicked = picked === choice;
            const isAnswer = isAnswered && choice === CORRECT_CHOICE;
            const bubble = isPicked
              ? 'border-ink bg-ink text-ink-foreground'
              : isAnswer
                ? 'border-pass text-pass ring-2 ring-pass ring-offset-2'
                : 'border-omr text-omr';
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={isPicked}
                disabled={isAnswered}
                onClick={() => setPicked(choice)}
                className="flex min-h-11 items-center gap-4 rounded-sm px-2 text-left hover:bg-omr-soft/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-omr/50 disabled:cursor-default disabled:hover:bg-transparent"
                data-testid={`landing-question-${choice}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${bubble}`}
                >
                  {t(`landing.q.letter.${choice}`)}
                </span>
                <span className={isAnswered && !isPicked && !isAnswer ? 'text-ink-muted' : ''}>
                  {t(`landing.q.option.${choice}`)}
                </span>
              </button>
            );
          })}
        </div>
        <div aria-live="polite" className="min-h-0">
          {isAnswered ? (
            <div className="flex flex-col items-start gap-3 border-t border-dashed border-omr/50 pt-4">
              <p
                className={isCorrect ? 'font-medium text-pass' : 'text-ink'}
                data-testid="landing-question-result"
              >
                {t(isCorrect ? 'landing.q.correct' : 'landing.q.wrong')}
              </p>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-sm font-medium text-omr underline underline-offset-4"
                data-testid="landing-question-clear"
              >
                {t('landing.q.clear')}
              </button>
            </div>
          ) : null}
        </div>
      </fieldset>
    </div>
  );
}

function VaultLedger() {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 id="landing-vault-title" className="text-3xl font-bold text-balance">
        {t('landing.vault.title')}
      </h2>
      <div className="overflow-x-auto border border-omr/60 bg-background">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="bg-omr-soft text-omr">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">
                {t('landing.vault.col.topic')}
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                {t('landing.vault.col.attempts')}
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                {t('landing.vault.col.status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-omr/25">
            {VAULT_ROWS.map((row) => (
              <tr key={row.topic}>
                <td className="px-4 py-3 font-medium">{t(row.topic)}</td>
                <td className="px-4 py-3">
                  <ul className="flex gap-1.5">
                    {row.attempts.map((isRight, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: an ordered attempt history; position is its identity
                      <li key={index}>
                        <span
                          role="img"
                          aria-label={t(isRight ? 'landing.vault.right' : 'landing.vault.wrong')}
                          className={`flex size-6 items-center justify-center rounded-full border-2 text-xs font-bold ${isRight ? 'border-pass bg-pass text-ink-foreground' : 'border-omr text-omr'}`}
                        >
                          {isRight ? '✓' : '×'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td
                  className={`px-4 py-3 ${row.isCleared ? 'font-semibold text-pass' : 'text-ink/75'}`}
                >
                  {t(row.status)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-muted">{t('landing.vault.caption')}</p>
    </div>
  );
}
