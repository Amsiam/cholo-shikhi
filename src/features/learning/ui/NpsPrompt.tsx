// US7.18: the one "would you recommend" question when the Student completes a course. Eleven
// buttons (0–10) in a radio group, plus Skip; answered or skipped, it is not asked again.
import { PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

/** The eleven NPS answers, 0 to 10. */
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

export function NpsPrompt(props: { onAnswer: (score: number | null) => Promise<Outcome> }) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isThanked, setIsThanked] = useState(false);
  const send = async (value: number | null) => {
    setBusy(true);
    setError(null);
    const r = await props.onAnswer(value);
    setBusy(false);
    if (r.ok) setIsThanked(value !== null);
    else setError(r.error.i18nKey);
  };
  if (isThanked)
    return (
      <p role="status" className="border border-primary/20 bg-background p-4 font-semibold">
        {t('nps.thanks')}
      </p>
    );
  return (
    <section
      aria-labelledby="nps-question"
      className="flex flex-col gap-4 border-2 border-primary bg-background p-5"
      data-testid="nps-prompt"
    >
      <h2 id="nps-question" className="flex items-center gap-2 text-xl font-bold">
        <PartyPopper aria-hidden="true" className="size-5 text-primary" />
        {t('nps.done')}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t('nps.question')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {SCORES.map((n) => (
            <label
              key={n}
              className={`grid size-11 cursor-pointer place-items-center rounded-sm border-2 font-bold tabular-nums focus-within:ring-[3px] focus-within:ring-ring/50 ${score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/25'}`}
            >
              <input
                type="radio"
                name="nps-score"
                className="sr-only"
                checked={score === n}
                onChange={() => setScore(n)}
              />
              {formatInteger(n)}
            </label>
          ))}
        </div>
        <p className="flex justify-between text-xs text-ink-muted">
          <span>{t('nps.low')}</span>
          <span>{t('nps.high')}</span>
        </p>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || score === null}
          onClick={() => void send(score)}
          data-testid="nps-send"
        >
          {t('nps.send')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void send(null)}
          data-testid="nps-skip"
        >
          {t('nps.skip')}
        </Button>
      </div>
    </section>
  );
}
