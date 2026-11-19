// Mistake Vault (FR-ADP-1): the Student's wrong answers, practised until mastered (two correct in a
// row). Drawn as an answer sheet: each option is an OMR bubble; a result is marked with the red pen
// (wrong) or the correct green, and two small bubbles show the run towards mastery.
import { Link } from '@tanstack/react-router';
import { ArrowRight, CircleCheck, RotateCcw, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { MASTERY_STREAK } from '../domain/vault.ts';
import type { VaultAnswerResult, VaultQuestion, VaultSummary } from '../server/vault.server.ts';

const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

type Result<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };

/** Two bubbles: how far this question is on its run towards mastery. */
function MasteryRun(props: { run: number; label: string }) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={props.label}>
      {Array.from({ length: MASTERY_STREAK }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative marks
          key={i}
          className={`size-3 rounded-full border-2 ${i < props.run ? 'border-pass bg-pass' : 'border-ink/25'}`}
        />
      ))}
    </span>
  );
}

function Practice(props: {
  questions: VaultQuestion[];
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Result<VaultAnswerResult>>;
  onDone: () => void;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<VaultAnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [tally, setTally] = useState({ correct: 0, mastered: 0 });
  const total = props.questions.length;
  const q = props.questions[index];
  const letters = LETTERS[locale];

  if (!q) {
    return (
      <section
        className="flex flex-col items-start gap-4 border border-primary/15 bg-background p-6"
        data-testid="vault-finished"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-pass/15 text-pass">
          <CircleCheck aria-hidden="true" className="size-6" />
        </span>
        <h2 className="text-2xl font-extrabold">{t('vault.done.title')}</h2>
        <p className="text-ink/80">
          {t('vault.done.body', {
            correct: formatInteger(tally.correct),
            total: formatInteger(total),
            mastered: formatInteger(tally.mastered),
          })}
        </p>
        <Button onClick={props.onDone} data-testid="vault-back">
          {t('vault.done.back')}
        </Button>
      </section>
    );
  }

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
      mastered: x.mastered + (r.value.status === 'mastered' ? 1 : 0),
    }));
  };
  const next = () => {
    setIndex((i) => i + 1);
    setChosen(null);
    setResult(null);
  };

  return (
    <section
      aria-labelledby="vault-question"
      className="flex flex-col gap-5 border-2 border-omr bg-background p-5 sm:p-7"
      data-testid="vault-practice"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-omr/30 pb-3 text-sm">
        <span className="font-semibold text-omr tabular-nums">
          {t('vault.practice.progress', {
            n: formatInteger(index + 1),
            total: formatInteger(total),
          })}
        </span>
        <span className="text-ink-muted">{pick(q.groupTitleBn, q.groupTitleEn, locale)}</span>
      </div>
      <h2 id="vault-question" className="text-xl leading-snug font-bold sm:text-2xl">
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
              key={option}
              className={`flex min-h-12 cursor-pointer items-center gap-3 border px-3 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${tone}`}
              data-testid="vault-option"
            >
              <input
                type="radio"
                name="vault-option"
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
              {i === q.lastWrongChoice && result === null ? (
                <span className="text-xs font-medium text-omr">{t('vault.practice.lastTime')}</span>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      {result ? (
        <div
          role="status"
          className={`flex flex-col gap-2 border p-4 ${result.isCorrect ? 'border-pass/40 bg-pass/10' : 'border-omr/40 bg-omr-soft'}`}
          data-testid="vault-result"
        >
          <p className={`font-bold ${result.isCorrect ? 'text-pass' : 'text-omr'}`}>
            {t(result.isCorrect ? 'vault.result.correct' : 'vault.result.wrong', {
              answer: letters[result.correctIndex] ?? '',
            })}
          </p>
          {(locale === 'bn' ? result.explanationBn : result.explanationEn) ? (
            <p className="text-ink/80">
              {locale === 'bn' ? result.explanationBn : result.explanationEn}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-sm text-ink/80">
            <MasteryRun
              run={result.status === 'mastered' ? MASTERY_STREAK : result.correctRun}
              label={t('vault.run.label', {
                run: formatInteger(result.correctRun),
                total: formatInteger(MASTERY_STREAK),
              })}
            />
            {t(
              result.status === 'mastered'
                ? 'vault.result.mastered'
                : result.isCorrect
                  ? 'vault.result.oneMore'
                  : 'vault.result.again',
            )}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}

      <div className="flex justify-end">
        {result ? (
          <Button onClick={next} data-testid="vault-next">
            {t(index + 1 < total ? 'vault.practice.next' : 'vault.practice.finish')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={() => void submit()}
            disabled={chosen === null || isSending}
            data-testid="vault-check"
          >
            {t('vault.practice.check')}
          </Button>
        )}
      </div>
    </section>
  );
}

export function VaultView(props: {
  summary: VaultSummary;
  onStart: () => Promise<Result<{ questions: VaultQuestion[] }>>;
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Result<VaultAnswerResult>>;
  onDone: () => void;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [session, setSession] = useState<VaultQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const s = props.summary;

  const start = async () => {
    setIsLoading(true);
    setError(null);
    const r = await props.onStart();
    setIsLoading(false);
    if (r.ok) setSession(r.value.questions);
    else setError(r.error.i18nKey);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="vault-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <RotateCcw aria-hidden="true" className="size-8 text-omr" />
          {t('dashboard.vault.title')}
        </h1>
        <p className="max-w-2xl text-ink/75">{t('vault.subtitle')}</p>
      </header>

      {session ? (
        <Practice
          questions={session}
          onAnswer={props.onAnswer}
          onDone={() => {
            setSession(null);
            props.onDone();
          }}
        />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-px overflow-hidden border border-primary/15 bg-primary/15">
            {(
              [
                ['vault.stat.waiting', s.active, 'text-omr'],
                ['vault.stat.mastered', s.mastered, 'text-pass'],
                ['vault.stat.today', s.answeredToday, 'text-ink'],
              ] as const
            ).map(([label, n, tone]) => (
              <div key={label} className="flex flex-col gap-1 bg-background px-4 py-4">
                <dt className="text-sm text-ink-muted">{t(label)}</dt>
                <dd className={`text-3xl font-extrabold tabular-nums ${tone}`}>
                  {formatInteger(n)}
                </dd>
              </div>
            ))}
          </dl>

          {s.active > 0 ? (
            <section className="flex flex-col items-start gap-3 border-2 border-omr bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">
                {t('vault.start.body', { count: formatInteger(Math.min(s.active, 10)) })}
              </p>
              <Button
                size="lg"
                onClick={() => void start()}
                disabled={isLoading}
                data-testid="vault-start"
              >
                <Target aria-hidden="true" className="size-5" />
                {t('vault.start.button')}
              </Button>
            </section>
          ) : (
            <section
              className="flex flex-col items-center gap-3 border border-dashed border-primary/30 bg-background px-6 py-12 text-center"
              data-testid="vault-empty"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-pass/15 text-pass">
                <Sparkles aria-hidden="true" className="size-6" />
              </span>
              <p className="font-semibold">
                {t(s.mastered > 0 ? 'vault.empty.allMastered' : 'vault.empty.none')}
              </p>
              <Link to="/learn" className="tap-target font-semibold text-primary hover:underline">
                {t('vault.empty.toCourses')}
              </Link>
            </section>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {tDynamic(error)}
            </p>
          ) : null}

          {s.groups.length > 0 ? (
            <section aria-labelledby="vault-by-course" className="flex flex-col gap-3">
              <h2 id="vault-by-course" className="text-lg font-bold">
                {t('vault.byCourse')}
              </h2>
              <ul className="flex flex-col divide-y divide-primary/10 border border-primary/15 bg-background">
                {s.groups.map((c) => {
                  const all = c.active + c.mastered;
                  return (
                    <li
                      key={c.groupId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-semibold break-words">
                          {pick(c.titleBn, c.titleEn, locale)}
                        </span>
                        {c.isCurrentGoal ? (
                          <span className="w-fit rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                            {t('vault.currentGoal')}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="text-omr tabular-nums">
                          {t('vault.course.waiting', { n: formatInteger(c.active) })}
                        </span>
                        <span className="text-pass tabular-nums">
                          {t('vault.course.mastered', { n: formatInteger(c.mastered) })}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="h-2 w-full overflow-hidden rounded-full bg-omr-soft sm:w-40"
                      >
                        <span
                          className="block h-full rounded-full bg-pass"
                          style={{ width: `${all === 0 ? 0 : (c.mastered / all) * 100}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
