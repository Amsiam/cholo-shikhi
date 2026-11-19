// Topic-wise practice from the question bank: the Student picks a topic (or sub-topic) of their
// Goal's subjects, a difficulty and a length, and answers one question at a time. Each answer is
// marked on the server; a wrong one goes to the Mistake Vault.
import { Link } from '@tanstack/react-router';
import { ArrowRight, BookOpenCheck, CircleCheck, Target } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { StudentQuestion } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import type { PracticeAnswerResult, PracticeCatalog } from '../server/practice.server.ts';

const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;
const DIFFICULTIES = ['any', 'easy', 'medium', 'hard'] as const;
const LENGTHS = [5, 10, 20] as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };
type Difficulty = (typeof DIFFICULTIES)[number];
type Pickable = { topicId: string; nameBn: string; nameEn: string; questionCount: number };

function Round(props: {
  title: string;
  questions: StudentQuestion[];
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Result<PracticeAnswerResult>>;
  onDone: () => void;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<PracticeAnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [tally, setTally] = useState({ correct: 0, toVault: 0 });
  const total = props.questions.length;
  const q = props.questions[index];
  const letters = LETTERS[locale];

  if (!q)
    return (
      <section
        className="flex flex-col items-start gap-4 border border-primary/15 bg-background p-6"
        data-testid="practice-finished"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-pass/15 text-pass">
          <CircleCheck aria-hidden="true" className="size-6" />
        </span>
        <h2 className="text-2xl font-extrabold">{t('practice.done.title')}</h2>
        <p className="text-ink/80">
          {t('practice.done.body', {
            correct: formatInteger(tally.correct),
            total: formatInteger(total),
          })}
        </p>
        {tally.toVault > 0 ? (
          <p className="text-ink/80">
            {t('practice.done.vault', { n: formatInteger(tally.toVault) })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button onClick={props.onDone} data-testid="practice-back">
            {t('practice.done.back')}
          </Button>
          {tally.toVault > 0 ? (
            <Button variant="outline" asChild>
              <Link to="/vault">{t('practice.done.toVault')}</Link>
            </Button>
          ) : null}
        </div>
      </section>
    );

  const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
  const submit = async () => {
    if (chosen === null) return;
    setIsSending(true);
    setError(null);
    const r = await props.onAnswer(q.questionId, chosen);
    setIsSending(false);
    if (!r.ok) {
      setError(r.error.i18nKey);
      return;
    }
    setResult(r.value);
    setTally((x) => ({
      correct: x.correct + (r.value.isCorrect ? 1 : 0),
      toVault: x.toVault + (r.value.addedToVault ? 1 : 0),
    }));
  };
  const next = () => {
    setIndex((i) => i + 1);
    setChosen(null);
    setResult(null);
  };
  const explanation = result
    ? locale === 'bn'
      ? result.explanationBn
      : result.explanationEn
    : null;

  return (
    <section
      aria-labelledby="practice-question"
      className="flex flex-col gap-5 border-2 border-primary/40 bg-background p-5 sm:p-7"
      data-testid="practice-round"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/20 pb-3 text-sm">
        <span className="font-semibold text-primary tabular-nums">
          {t('vault.practice.progress', {
            n: formatInteger(index + 1),
            total: formatInteger(total),
          })}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-ink-muted">
          <span>{props.title}</span>
          <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-semibold text-ink">
            {t(`bank.difficulty.${q.difficulty}`)}
          </span>
          {q.isPastPaper ? (
            <span
              className="rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary"
              data-testid="past-paper-label"
            >
              {t('bank.pastPaper')}
            </span>
          ) : null}
          {q.sourceNote ? <span className="text-xs">{q.sourceNote}</span> : null}
        </span>
      </div>
      <h2 id="practice-question" className="text-xl leading-snug font-bold sm:text-2xl">
        {pick(q.promptBn, q.promptEn, locale)}
      </h2>
      <fieldset className="flex flex-col gap-2" disabled={result !== null || isSending}>
        <legend className="sr-only">{t('vault.practice.choose')}</legend>
        {options.map((option, i) => {
          const isChosen = chosen === i;
          const isRight = result !== null && i === result.correctIndex;
          const isWrongPick = result !== null && isChosen && !result.isCorrect;
          const tone = isRight
            ? 'border-pass bg-pass/10'
            : isWrongPick
              ? 'border-omr bg-omr-soft'
              : isChosen
                ? 'border-ink bg-ink/5'
                : 'border-primary/20 hover:border-primary/50';
          return (
            <label
              key={letters[i]}
              className={`flex min-h-12 cursor-pointer items-center gap-3 border px-3 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${tone}`}
              data-testid="practice-option"
            >
              <input
                type="radio"
                name="practice-option"
                className="sr-only"
                checked={isChosen}
                onChange={() => setChosen(i)}
              />
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  isRight
                    ? 'border-pass bg-pass text-white'
                    : isWrongPick
                      ? 'border-omr bg-omr text-white'
                      : isChosen
                        ? 'border-ink bg-ink text-ink-foreground'
                        : 'border-omr text-omr'
                }`}
              >
                {letters[i]}
              </span>
              <span className="flex-1">{option}</span>
            </label>
          );
        })}
      </fieldset>
      {result ? (
        <div
          role="status"
          className={`flex flex-col gap-2 border p-4 ${result.isCorrect ? 'border-pass/40 bg-pass/10' : 'border-omr/40 bg-omr-soft'}`}
          data-testid="practice-result"
        >
          <p className={`font-bold ${result.isCorrect ? 'text-pass' : 'text-omr'}`}>
            {t(result.isCorrect ? 'vault.result.correct' : 'vault.result.wrong', {
              answer: letters[result.correctIndex] ?? '',
            })}
          </p>
          {explanation ? <p className="text-ink/80">{explanation}</p> : null}
          {result.addedToVault ? (
            <p className="text-sm text-ink/80">{t('practice.result.toVault')}</p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex justify-end">
        {result ? (
          <Button onClick={next} data-testid="practice-next">
            {t(index + 1 < total ? 'vault.practice.next' : 'vault.practice.finish')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={() => void submit()}
            disabled={chosen === null || isSending}
            data-testid="practice-check"
          >
            {t('vault.practice.check')}
          </Button>
        )}
      </div>
    </section>
  );
}

function Segmented<T extends string | number>(props: {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">{props.legend}</legend>
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => (
          <label
            key={String(o.value)}
            className={`flex min-h-11 cursor-pointer items-center rounded-sm border px-4 text-sm font-semibold transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
              props.value === o.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-primary/25 hover:border-primary/60'
            }`}
          >
            <input
              type="radio"
              name={props.name}
              className="sr-only"
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PracticeView(props: {
  catalog: PracticeCatalog;
  onStart: (input: {
    topicId: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    count: number;
  }) => Promise<Result<{ questions: StudentQuestion[] }>>;
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Result<PracticeAnswerResult>>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [selected, setSelected] = useState<Pickable | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('any');
  const [count, setCount] = useState<number>(10);
  const [round, setRound] = useState<{ title: string; questions: StudentQuestion[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const hasNoSubjects = props.catalog.subjects.length === 0;
  if (round)
    return (
      <Round
        title={round.title}
        questions={round.questions}
        onAnswer={props.onAnswer}
        onDone={() => setRound(null)}
      />
    );

  const start = async () => {
    if (!selected) return;
    setIsStarting(true);
    setError(null);
    const r = await props.onStart({
      topicId: selected.topicId,
      ...(difficulty === 'any' ? {} : { difficulty }),
      count,
    });
    setIsStarting(false);
    if (!r.ok) {
      setError(r.error.i18nKey);
      return;
    }
    setRound({
      title: pick(selected.nameBn, selected.nameEn, locale),
      questions: r.value.questions,
    });
  };

  const noGoal = (
    <section className="flex flex-col items-start gap-3 border border-primary/15 bg-background p-6">
      <Target aria-hidden="true" className="size-6 text-primary" />
      <p>{t('practice.noGoal')}</p>
      <Button asChild>
        <Link to="/me/goal">{t('practice.chooseGoal')}</Link>
      </Button>
    </section>
  );
  const noSubjects = (
    <p className="border border-primary/15 bg-background p-6 text-ink/80">
      {t('practice.noSubjects')}
    </p>
  );
  let emptyState: ReactNode = null;
  if (!props.catalog.goalId) emptyState = noGoal;
  else if (hasNoSubjects) emptyState = noSubjects;

  const topicButton = (x: Pickable, isSub: boolean) => {
    const isOn = selected?.topicId === x.topicId;
    const isEmpty = x.questionCount === 0;
    return (
      <button
        type="button"
        disabled={isEmpty}
        aria-pressed={isOn}
        onClick={() => setSelected(x)}
        className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:text-ink-muted ${
          isSub ? 'pl-10 text-sm' : 'font-semibold'
        } ${isOn ? 'bg-primary/10 text-primary' : 'hover:bg-primary/5'}`}
        data-testid="practice-topic"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-3.5 shrink-0 rounded-full border-2 ${isOn ? 'border-primary bg-primary' : 'border-omr'}`}
          />
          {pick(x.nameBn, x.nameEn, locale)}
        </span>
        <span className="text-xs text-ink-muted tabular-nums">
          {t('practice.questionCount', { n: formatInteger(x.questionCount) })}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6" data-testid="practice-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <BookOpenCheck aria-hidden="true" className="size-7 text-primary" />
          {t('practice.title')}
        </h1>
        <p className="text-ink/75">{t('practice.subtitle')}</p>
      </header>

      {emptyState ?? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4">
            {props.catalog.subjects.map((s) => (
              <section
                key={s.subjectId}
                aria-labelledby={`subject-${s.subjectId}`}
                className="border border-primary/15 bg-background"
              >
                <h2
                  id={`subject-${s.subjectId}`}
                  className="border-b border-primary/10 px-4 py-3 text-lg"
                >
                  {pick(s.nameBn, s.nameEn, locale)}
                </h2>
                {s.topics.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-ink-muted">{t('practice.noTopics')}</p>
                ) : (
                  <ul className="divide-y divide-primary/10">
                    {s.topics.map((topic) => (
                      <li key={topic.topicId}>
                        {topicButton(topic, false)}
                        {topic.subtopics.length > 0 ? (
                          <ul>
                            {topic.subtopics.map((sub) => (
                              <li key={sub.topicId}>{topicButton(sub, true)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <aside
            aria-labelledby="practice-setup"
            className="flex h-fit flex-col gap-5 border border-primary/15 bg-background p-5 lg:sticky lg:top-20"
          >
            <h2 id="practice-setup" className="text-lg">
              {t('practice.setup')}
            </h2>
            <p className={selected ? 'font-semibold' : 'text-sm text-ink-muted'}>
              {selected ? pick(selected.nameBn, selected.nameEn, locale) : t('practice.pickTopic')}
            </p>
            <Segmented
              legend={t('practice.difficulty')}
              name="practice-difficulty"
              value={difficulty}
              onChange={setDifficulty}
              options={DIFFICULTIES.map((d) => ({
                value: d,
                label: t(d === 'any' ? 'practice.anyDifficulty' : `bank.difficulty.${d}`),
              }))}
            />
            <Segmented
              legend={t('practice.length')}
              name="practice-length"
              value={count}
              onChange={setCount}
              options={LENGTHS.map((n) => ({ value: n, label: formatInteger(n) }))}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {tDynamic(error)}
              </p>
            ) : null}
            <Button
              onClick={() => void start()}
              disabled={!selected || isStarting}
              data-testid="practice-start"
            >
              {t('practice.start')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
