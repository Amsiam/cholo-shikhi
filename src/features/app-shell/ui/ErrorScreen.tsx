import { Link } from '@tanstack/react-router';
import { LockKeyhole, SearchX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';

// Error, not-found and access-denied screens, drawn as one row of an exam OMR answer sheet (the
// landing page's visual world): no bubble marked for a missing page, an ink smudge for a failure,
// sealed bubbles for a page the account cannot open. The state is always named in text and an
// icon as well, never by colour alone.

export type ErrorKind = 'notFound' | 'error' | 'denied';

const HTTP_CODE: Record<ErrorKind, number> = { notFound: 404, error: 500, denied: 403 };

const ICON: Record<ErrorKind, typeof SearchX> = {
  notFound: SearchX,
  error: TriangleAlert,
  denied: LockKeyhole,
};

const RULED_PAPER =
  'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, color-mix(in oklab, var(--paper-line) 70%, transparent) 31px, color-mix(in oklab, var(--paper-line) 70%, transparent) 32px)';

export const errorPrimaryAction =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-primary px-6 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-omr/50 motion-reduce:transition-none';

export const errorSecondaryAction =
  'tap-target rounded-sm px-1 font-medium text-ink underline decoration-omr decoration-2 underline-offset-4 hover:text-omr focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-omr/50';

export function ErrorScreen(props: {
  kind: ErrorKind;
  title: string;
  body: string;
  /** Buttons and links; defaults to a link home. */
  actions?: ReactNode;
  /** Extra content under the actions, such as technical details in development. */
  footer?: ReactNode;
  /** Draws the wordmark bar, for screens that render without the app header. */
  standalone?: boolean;
  testId?: string;
}) {
  const { t, formatInteger } = useI18n();
  const Icon = ICON[props.kind];
  const isAlert = props.kind !== 'notFound';
  return (
    <div
      className={`flex w-full flex-col bg-paper text-ink ${props.standalone ? 'min-h-dvh' : 'min-h-[60dvh]'}`}
      style={{ backgroundImage: RULED_PAPER }}
    >
      {props.standalone ? (
        <header className="flex min-h-14 items-center border-b border-primary/15 bg-background px-2 sm:px-4">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-sm px-2 text-lg font-extrabold tracking-tight text-ink hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span aria-hidden="true" className="size-4 rounded-full border-2 border-omr bg-ink" />
            {t('app.name')}
          </a>
        </header>
      ) : null}
      <section
        className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12 sm:py-20"
        role={isAlert ? 'alert' : undefined}
        aria-labelledby="error-screen-title"
        data-testid={props.testId}
        data-error-kind={props.kind}
      >
        <div className="border-2 border-omr bg-background shadow-[8px_8px_0_var(--omr-soft)]">
          <p className="flex items-center gap-2 border-b-2 border-omr bg-omr-soft px-5 py-2 text-sm font-semibold text-omr">
            <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
            {t('errorPage.code', { code: formatInteger(HTTP_CODE[props.kind]) })}
          </p>
          <div className="flex flex-col gap-6 p-5 sm:p-8">
            <BubbleRow kind={props.kind} />
            <div className="flex flex-col gap-3">
              <h1
                id="error-screen-title"
                className="text-2xl leading-tight font-extrabold tracking-tight text-balance sm:text-3xl"
              >
                {props.title}
              </h1>
              <p className="max-w-[60ch] text-base leading-relaxed text-ink-muted">{props.body}</p>
            </div>
            <div className="flex flex-col items-start gap-x-6 gap-y-3 border-t border-dashed border-omr/50 pt-5 sm:flex-row sm:items-center">
              {props.actions ?? (
                <Link to="/" className={errorPrimaryAction}>
                  {t('errorPage.home')}
                </Link>
              )}
            </div>
            {props.footer}
          </div>
        </div>
      </section>
    </div>
  );
}

/** A staff page the signed-in account may not open; `reason` names the role it needs. */
export function AccessDenied(props: { reason: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <ErrorScreen
      kind="denied"
      testId={props.testId}
      title={t('shell.denied.title')}
      body={props.reason}
    />
  );
}

/** Four answer bubbles; decorative, since the heading and the code strip carry the meaning. */
function BubbleRow({ kind }: { kind: ErrorKind }) {
  const { t } = useI18n();
  const letters = Array.from(t('errorPage.options')).slice(0, 4);
  return (
    <div aria-hidden="true" className="relative isolate flex w-fit items-center gap-3 sm:gap-4">
      {kind === 'denied' ? (
        <span className="absolute inset-x-0 top-1/2 -z-10 h-0.5 -translate-y-1/2 bg-ink-muted/40" />
      ) : null}
      {letters.map((letter, i) => {
        const base =
          'relative flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold sm:size-11';
        if (kind === 'notFound')
          return (
            <span key={letter} className={`${base} border-dashed border-omr/70 text-omr/80`}>
              {letter}
            </span>
          );
        if (kind === 'denied')
          return (
            <span key={letter} className={`${base} border-ink-muted/60 bg-paper text-ink-muted`}>
              <LockKeyhole className="size-4" strokeWidth={2.25} />
            </span>
          );
        // error: the third bubble is filled, and the ink has run.
        if (i === 2)
          return (
            <span key={letter} className={`${base} isolate border-ink bg-ink text-ink-foreground`}>
              <span className="error-smudge absolute -inset-1.5 -z-10 translate-x-2 translate-y-1 rounded-[45%_55%_60%_40%] bg-ink/30" />
              <span className="relative">{letter}</span>
            </span>
          );
        return (
          <span key={letter} className={`${base} border-omr text-omr`}>
            {letter}
          </span>
        );
      })}
    </div>
  );
}
