// Small shared pieces of the question bank screens.
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { BankStatus, Difficulty } from '../domain/bank.ts';
import type { BankQuestionView } from '../server/bank.server.ts';

const STATUS_TONE: Record<BankStatus, string> = {
  draft: 'bg-ink/10 text-ink',
  in_review: 'bg-primary/10 text-primary',
  published: 'bg-pass/15 text-pass',
  rejected: 'bg-omr-soft text-omr',
  retired: 'bg-ink/5 text-ink-muted',
};

export function StatusBadge(props: { status: BankStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONE[props.status]}`}
    >
      {t(`bank.status.${props.status}`)}
    </span>
  );
}

/** Difficulty as one to three filled marks, with the word for screen readers and sighted users. */
export function DifficultyMark(props: { difficulty: Difficulty }) {
  const { t } = useI18n();
  const n = props.difficulty === 'easy' ? 1 : props.difficulty === 'medium' ? 2 : 3;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`size-2 rounded-full ${i <= n ? 'bg-ink' : 'border border-ink/30'}`}
          />
        ))}
      </span>
      {t(`bank.difficulty.${props.difficulty}`)}
    </span>
  );
}

/** Set difficulty, and the measured one when real attempts moved it. */
export function MeasuredDifficulty(props: { q: BankQuestionView }) {
  const { t, formatInteger } = useI18n();
  const { q } = props;
  const percent = q.firstCorrectRate === null ? null : Math.round(q.firstCorrectRate * 100);
  const hasMoved = q.effectiveDifficulty !== q.difficulty;
  return (
    <span className="flex flex-col gap-1">
      <DifficultyMark difficulty={q.effectiveDifficulty} />
      <span className="text-xs text-ink-muted">
        {hasMoved
          ? t('bank.measured.movedFrom', { set: t(`bank.difficulty.${q.difficulty}`) })
          : null}
        {percent === null
          ? t('bank.measured.none')
          : t('bank.measured.stats', {
              n: formatInteger(q.firstAttempts),
              percent: formatInteger(percent),
            })}
      </span>
    </span>
  );
}
