// Free trial (FR-DIST-1) on the learning screens: what the trial still allows, what is locked, and
// the way to buy the full course. Drawn with the red pen when it has run out.
import { Link } from '@tanstack/react-router';
import { Gift, Lock } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { TrialView } from '../server/learning.types.ts';

/** A trial's status line with the buy link (course home and My courses). */
export function TrialBanner(props: {
  courseId: string;
  trial: TrialView;
  tone?: 'paper' | 'onPrimary';
}) {
  const { t, formatInteger } = useI18n();
  const tr = props.trial;
  const onPrimary = props.tone === 'onPrimary';
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-3 py-2 text-sm font-semibold ${
        tr.isExpired
          ? onPrimary
            ? 'bg-primary-foreground text-omr'
            : 'bg-omr-soft text-omr'
          : onPrimary
            ? 'bg-primary-foreground/15'
            : 'bg-primary/10 text-primary'
      }`}
      data-testid={tr.isExpired ? 'trial-expired' : 'trial-active'}
    >
      <Gift aria-hidden="true" className="size-4 shrink-0" />
      <span>
        {tr.isExpired
          ? t('trial.expired')
          : t('trial.active', {
              days: formatInteger(tr.daysLeft),
              used: formatInteger(tr.lessonsUsed),
              limit: formatInteger(tr.lessonLimit),
            })}
      </span>
      <Link
        to="/courses/$courseId"
        params={{ courseId: props.courseId }}
        className="underline underline-offset-2"
        data-testid="trial-buy"
      >
        {t('trial.buyFull')}
      </Link>
    </div>
  );
}

/** A lesson outside the trial: shown, but not openable. */
export function LockedLessonMark() {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-muted">
      <Lock aria-hidden="true" className="size-3.5" />
      {t('trial.locked')}
    </span>
  );
}

/** The lesson page when the trial does not open this lesson (or has run out). */
export function TrialLockedPage(props: { courseId: string }) {
  const { t } = useI18n();
  return (
    <section className="min-h-[calc(100dvh-3.5rem)] bg-paper" data-testid="trial-locked">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-omr-soft text-omr">
          <Lock aria-hidden="true" className="size-6" />
        </span>
        <h1 className="text-3xl font-extrabold">{t('trial.lockedPage.title')}</h1>
        <p className="text-ink/80">{t('trial.lockedPage.body')}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/courses/$courseId"
            params={{ courseId: props.courseId }}
            className="inline-flex min-h-11 items-center rounded-sm bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t('trial.buyFull')}
          </Link>
          <Link
            to="/learn/$courseId"
            params={{ courseId: props.courseId }}
            className="inline-flex min-h-11 items-center rounded-sm border border-primary/40 px-5 font-semibold text-primary hover:bg-primary/10"
          >
            {t('trial.backToCourse')}
          </Link>
        </div>
      </div>
    </section>
  );
}
