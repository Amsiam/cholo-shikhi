// Shared pieces of the statistics and finance pages: stat tiles, a bar chart drawn with plain
// elements (no chart library), a progress meter and the percent and month formatting. Every chart
// also carries a screen-reader table with the same numbers.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Locale } from '#src/lib/i18n/index.ts';

/** Basis points as a percent with at most one decimal, in the active locale's digits. */
export function formatPercent(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(bps / 10_000);
}

/** "2026-11" as a short month name ("Nov" / "নভে"), with the year on January or when asked. */
export function formatMonth(month: string, locale: Locale, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15));
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    month: 'short',
    ...(withYear || m === 1 ? { year: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

export function StatTile(props: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'primary' | 'pass' | 'omr' | 'ink';
  testId: string;
}) {
  const Icon = props.icon;
  const tone = {
    primary: 'bg-primary/10 text-primary',
    pass: 'bg-pass/15 text-pass',
    omr: 'bg-omr-soft text-omr',
    ink: 'bg-ink/10 text-ink',
  }[props.tone ?? 'primary'];
  return (
    <div
      className="flex min-w-0 flex-col gap-3 border border-primary/15 bg-background p-4 sm:p-5"
      data-testid={props.testId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink/70">{props.label}</span>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-sm ${tone}`}>
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
      </div>
      <span className="text-2xl font-extrabold tracking-tight whitespace-nowrap tabular-nums lg:text-xl xl:text-2xl">
        {props.value}
      </span>
      {props.hint ? <span className="text-xs text-ink-muted">{props.hint}</span> : null}
    </div>
  );
}

export function Panel(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-4 border border-primary/15 bg-background p-4 sm:p-5"
      data-testid={props.testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-bold">{props.title}</h2>
          {props.description ? <p className="text-sm text-ink-muted">{props.description}</p> : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** Vertical bars over months. Values are integers (poisha or counts). */
export function BarChart(props: {
  points: ReadonlyArray<{ month: string; value: number }>;
  format: (value: number) => string;
  locale: Locale;
  label: string;
  testId: string;
}) {
  const max = Math.max(0, ...props.points.map((p) => p.value));
  const last = props.points.length - 1;
  return (
    <figure className="flex flex-col gap-2" data-testid={props.testId}>
      <div
        className="flex h-44 items-end gap-1.5 border-b border-primary/20 sm:gap-2"
        aria-hidden="true"
      >
        {props.points.map((p, i) => {
          const height = max === 0 ? 0 : Math.max(p.value > 0 ? 3 : 0, (p.value / max) * 100);
          return (
            <div key={p.month} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full rounded-t-sm transition-colors ${i === last ? 'bg-primary' : 'bg-primary/35 group-hover:bg-primary/60'}`}
                style={{ height: `${height}%` }}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-sm bg-ink px-2 py-1 text-xs whitespace-nowrap text-ink-foreground group-hover:block">
                {props.format(p.value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex min-w-0 gap-1.5 sm:gap-2" aria-hidden="true">
        {props.points.map((p, i) => (
          // Every other month is labelled (always including the latest), so labels never collide.
          <span
            key={p.month}
            // Phones show every fourth month, wider screens every other one; the latest always shows.
            className={`min-w-0 flex-1 text-center text-xs whitespace-nowrap ${i === last ? 'font-semibold text-primary' : 'text-ink-muted'} ${(last - i) % 4 === 0 ? '' : 'max-sm:invisible'}`}
          >
            {(last - i) % 2 === 0 ? formatMonth(p.month, props.locale) : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{props.label}</caption>
        <tbody>
          {props.points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{formatMonth(p.month, props.locale, true)}</th>
              <td>{props.format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A horizontal meter for a share in basis points. */
export function Meter(props: { bps: number; tone?: 'primary' | 'omr' | 'pass'; label: string }) {
  const color = { primary: 'bg-primary', omr: 'bg-omr', pass: 'bg-pass' }[props.tone ?? 'primary'];
  const width = Math.min(100, Math.max(0, props.bps / 100));
  return (
    <span className="relative block w-full min-w-16">
      {/* The native meter carries the value for assistive technology; the bar is drawn below. */}
      <meter className="sr-only" min={0} max={100} value={width} aria-label={props.label} />
      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-primary/10">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}
