// Sitting an exam: one question at a time, an answer sheet of numbered bubbles to jump around, and
// a clock synced to the server. Every choice saves at once; when time runs out the sheet submits
// itself. Nothing here knows the correct answers.
import { ChevronLeft, ChevronRight, CircleAlert, Clock, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptSheet } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };
const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

/** Milliseconds left, ticking every second, against the server's clock. */
function useRemaining(deadlineAt: string, serverNow: string): number {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const deadline = new Date(deadlineAt).getTime();
  const [left, setLeft] = useState(() => deadline - (Date.now() + offset.current));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(deadline - (Date.now() + offset.current)), 1000);
    return () => window.clearInterval(id);
  }, [deadline]);
  return Math.max(0, left);
}

function ExamClock(props: { ms: number }) {
  const { t, formatInteger } = useI18n();
  const total = Math.ceil(props.ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => formatInteger(n).padStart(2, formatInteger(0));
  const text = h > 0 ? `${formatInteger(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  const isLow = props.ms < 60_000;
  const isWarn = props.ms < 5 * 60_000;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-bold tabular-nums ${
        isLow ? 'bg-omr text-white' : isWarn ? 'bg-omr-soft text-omr' : 'bg-ink/5 text-ink'
      }`}
      role="timer"
      aria-label={t('exams.sheet.timeLeft', { time: text })}
      data-testid="exam-clock"
    >
      <Clock aria-hidden="true" className="size-4" />
      {text}
    </span>
  );
}

export function ExamSheet(props: {
  sheet: AttemptSheet;
  onSave: (questionId: string, chosenIndex: number | null) => Promise<Outcome>;
  onSubmit: () => Promise<void>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const s = props.sheet;
  const letters = LETTERS[locale];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>(s.answers);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const left = useRemaining(s.deadlineAt, s.serverNow);
  const submitted = useRef(false);
  const total = s.questions.length;
  const answered = Object.keys(answers).length;
  const q = s.questions[index];

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setIsSubmitting(true);
    await props.onSubmit();
  }, [props.onSubmit]);

  useEffect(() => {
    if (left === 0) void submit();
  }, [left, submit]);

  const choose = async (questionId: string, chosen: number | null) => {
    const before = answers[questionId];
    setAnswers((a) => {
      const next = { ...a };
      if (chosen === null) delete next[questionId];
      else next[questionId] = chosen;
      return next;
    });
    setSaving((x) => new Set(x).add(questionId));
    setError(null);
    const r = await props.onSave(questionId, chosen);
    setSaving((x) => {
      const next = new Set(x);
      next.delete(questionId);
      return next;
    });
    if (r.ok) return;
    // Put the previous choice back; a closed attempt goes straight to the result.
    setAnswers((a) => {
      const next = { ...a };
      if (before === undefined) delete next[questionId];
      else next[questionId] = before;
      return next;
    });
    setError(r.error.i18nKey);
    if (r.error.i18nKey === 'errors.exam.closed') void submit();
  };

  if (!q) return null;
  const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
  const chosen = answers[q.questionId];

  return (
    <div className="flex flex-col gap-5" data-testid="exam-sheet">
      <header className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-primary/15 bg-paper/95 px-4 py-3 backdrop-blur-none sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-extrabold sm:text-xl">
            {pick(s.titleBn, s.titleEn, locale)}
          </h1>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {t('exams.sheet.answered', {
              n: formatInteger(answered),
              total: formatInteger(total),
            })}
            {saving.size > 0 ? ` · ${t('exams.sheet.saving')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExamClock ms={left} />
          <Button
            onClick={() => setIsConfirming(true)}
            disabled={isSubmitting}
            data-testid="exam-submit-open"
          >
            <Send aria-hidden="true" className="size-4" />
            {t('exams.sheet.submit')}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        <section
          aria-labelledby="exam-question"
          className="flex flex-col gap-5 border border-primary/15 bg-background p-5 sm:p-7"
        >
          <p className="text-sm font-semibold text-primary tabular-nums">
            {t('vault.practice.progress', {
              n: formatInteger(index + 1),
              total: formatInteger(total),
            })}
          </p>
          <h2 id="exam-question" className="text-xl leading-snug font-bold sm:text-2xl">
            {pick(q.promptBn, q.promptEn, locale)}
          </h2>
          <fieldset className="flex flex-col gap-2" disabled={isSubmitting}>
            <legend className="sr-only">{t('vault.practice.choose')}</legend>
            {options.map((option, i) => {
              const isChosen = chosen === i;
              return (
                <label
                  key={letters[i]}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 border px-3 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                    isChosen ? 'border-ink bg-ink/5' : 'border-primary/20 hover:border-primary/50'
                  }`}
                  data-testid="exam-option"
                >
                  <input
                    type="radio"
                    name={`exam-${q.questionId}`}
                    className="sr-only"
                    checked={isChosen}
                    onChange={() => void choose(q.questionId, i)}
                  />
                  <span
                    aria-hidden="true"
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                      isChosen ? 'border-ink bg-ink text-ink-foreground' : 'border-omr text-omr'
                    }`}
                  >
                    {letters[i]}
                  </span>
                  <span className="flex-1">{option}</span>
                </label>
              );
            })}
          </fieldset>
          {error ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <CircleAlert aria-hidden="true" className="size-4" />
              {tDynamic(error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => setIndex((i) => i - 1)}
              disabled={index === 0}
              data-testid="exam-prev"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {t('exams.sheet.prev')}
            </Button>
            {chosen !== undefined ? (
              <Button
                variant="ghost"
                onClick={() => void choose(q.questionId, null)}
                data-testid="exam-clear"
              >
                {t('exams.sheet.clear')}
              </Button>
            ) : null}
            <Button
              variant={index + 1 < total ? 'default' : 'outline'}
              onClick={() => (index + 1 < total ? setIndex((i) => i + 1) : setIsConfirming(true))}
              data-testid="exam-next"
            >
              {t(index + 1 < total ? 'exams.sheet.next' : 'exams.sheet.review')}
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </section>

        <nav
          aria-label={t('exams.sheet.navigator')}
          className="flex h-fit flex-col gap-3 border border-primary/15 bg-background p-4 lg:sticky lg:top-36"
        >
          <p className="text-sm font-semibold">{t('exams.sheet.navigator')}</p>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
            {s.questions.map((x, i) => {
              const isDone = answers[x.questionId] !== undefined;
              const isHere = i === index;
              return (
                <li key={x.questionId}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={isHere ? 'step' : undefined}
                    aria-label={t(isDone ? 'exams.sheet.goAnswered' : 'exams.sheet.goOpen', {
                      n: formatInteger(i + 1),
                    })}
                    className={`flex size-11 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                      isDone
                        ? 'border-ink bg-ink text-ink-foreground'
                        : 'border-omr text-omr hover:bg-omr-soft'
                    } ${isHere ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                    data-testid="exam-nav-bubble"
                  >
                    {formatInteger(i + 1)}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('exams.sheet.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {total - answered > 0
                ? t('exams.sheet.confirmUnanswered', { n: formatInteger(total - answered) })
                : t('exams.sheet.confirmAll')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirming(false)}>
              {t('exams.sheet.keepGoing')}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={isSubmitting || saving.size > 0}
              data-testid="exam-submit-confirm"
            >
              {t('exams.sheet.submitNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
