// Two-panel frame for the sign-in and sign-up pages: a teal answer-sheet panel beside the form.
import type { ReactNode } from 'react';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Choice = 'a' | 'b' | 'c' | 'd';
const LETTERS: readonly Choice[] = ['a', 'b', 'c', 'd'];
// Decorative answer strip: one filled bubble per question.
const ANSWERS: ReadonlyArray<{ question: number; answer: Choice }> = [
  { question: 1, answer: 'b' },
  { question: 2, answer: 'd' },
  { question: 3, answer: 'a' },
  { question: 4, answer: 'c' },
  { question: 5, answer: 'b' },
];
const SIGN_UP_STEPS: readonly MessageKey[] = [
  'auth.signUp.step1',
  'auth.signUp.step2',
  'auth.signUp.step3',
];

// Faint white ruling, like the lines on an answer sheet.
const ruled = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 35px, oklch(1 0 0 / 0.08) 35px, oklch(1 0 0 / 0.08) 36px)',
};

export function AuthShell(props: {
  variant: 'signIn' | 'signUp';
  title: string;
  subtitle: string;
  testId: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="grid min-h-[calc(100dvh-3.5rem)] bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
      data-testid={props.testId}
    >
      <aside className="relative overflow-hidden bg-primary text-primary-foreground" style={ruled}>
        <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-8 px-6 py-10 lg:py-16">
          {props.variant === 'signIn' ? <SignInSide /> : <SignUpSide />}
        </div>
      </aside>
      <div className="flex items-start justify-center px-4 py-10 sm:px-6 lg:items-center lg:py-16">
        <section className="flex w-full max-w-md flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-ink text-balance sm:text-4xl">
              {props.title}
            </h1>
            <p className="text-ink/70">{props.subtitle}</p>
          </header>
          {props.children}
          <div className="border-t border-primary/20 pt-6">{props.footer}</div>
        </section>
      </div>
    </div>
  );
}

function SignInSide() {
  const { t, formatInteger } = useI18n();
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-2xl leading-snug font-bold text-balance lg:text-4xl">
          {t('auth.signIn.sideTitle')}
        </p>
        <p className="max-w-sm text-primary-foreground/85">{t('auth.signIn.sideBody')}</p>
      </div>
      <ol aria-hidden="true" className="hidden flex-col gap-3 sm:flex">
        {ANSWERS.map(({ question, answer }) => (
          <li key={question} className="flex items-center gap-3">
            <span className="w-6 text-right text-sm font-semibold tabular-nums opacity-80">
              {formatInteger(question)}
            </span>
            {LETTERS.map((letter) => (
              <span
                key={letter}
                className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                  letter === answer
                    ? 'border-primary-foreground bg-primary-foreground text-primary'
                    : 'border-primary-foreground/50 text-primary-foreground/70'
                }`}
              >
                {t(`landing.q.letter.${letter}`)}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function SignUpSide() {
  const { t, formatInteger } = useI18n();
  return (
    <>
      <p className="text-2xl leading-snug font-bold text-balance lg:text-4xl">
        {t('auth.signUp.sideTitle')}
      </p>
      <ol className="flex flex-col gap-5">
        {SIGN_UP_STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-4">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-bold tabular-nums ${
                index === 0
                  ? 'border-primary-foreground bg-primary-foreground text-primary'
                  : 'border-primary-foreground/60'
              }`}
            >
              {formatInteger(index + 1)}
            </span>
            <span className={index === 0 ? 'font-semibold' : 'text-primary-foreground/85'}>
              {t(step)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
