// US7.9 and US7.8 per cycle: the instructor's own payout cycles (state as text and icon, held with
// the next step, carry-forward) and a cycle statement to print or save, with a CSV download.
// Usable on a 360 px phone without sideways scrolling.
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, Clock3, Download, FileText, Printer } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { CycleStatement, MyPayoutCycle } from '../server/payouts.server.ts';

function useMoney() {
  const { formatMoney } = useI18n();
  return (v: number) =>
    v < 0 ? `−${formatMoney(-v as MoneyPoisha)}` : formatMoney(v as MoneyPoisha);
}

function monthLong(month: string, locale: 'bn' | 'en') {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-15T00:00:00Z`));
}

function CycleState(props: { cycle: MyPayoutCycle }) {
  const { t } = useI18n();
  const c = props.cycle;
  const Icon = c.state === 'disbursed' ? CircleCheck : c.state === 'held' ? CircleAlert : Clock3;
  const color =
    c.state === 'disbursed' ? 'text-pass' : c.state === 'held' ? 'text-omr' : 'text-primary';
  let text = t('payouts.mine.pending');
  if (c.payout === 0) text = t('payouts.mine.nothing');
  else if (c.state === 'disbursed') text = t('payouts.mine.paid');
  else if (c.state === 'held') text = t('payouts.mine.held');
  return (
    <span className="flex items-start gap-1.5 text-sm font-semibold">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${color}`} />
      {text}
    </span>
  );
}

export function MyPayoutCycles(props: { cycles: readonly MyPayoutCycle[] }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  return (
    <section
      className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      aria-labelledby="my-cycles"
      data-testid="my-payout-cycles"
    >
      <h2 id="my-cycles" className="text-lg font-bold">
        {t('payouts.mine.title')}
      </h2>
      {props.cycles.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('payouts.mine.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-primary/10">
          {props.cycles.map((c) => (
            <li key={c.lineId} className="flex flex-col gap-1.5 py-3" data-testid="my-payout-cycle">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{monthLong(c.month, locale)}</span>
                <span className="text-lg font-extrabold tabular-nums">{money(c.payout)}</span>
              </div>
              <CycleState cycle={c} />
              {c.state === 'held' ? (
                <p className="text-sm">
                  {c.holdNote ? `${c.holdNote} ` : ''}
                  <Link
                    to="/instructor/payouts"
                    className="font-semibold text-primary hover:underline"
                  >
                    {t('payouts.mine.reverify')}
                  </Link>
                </p>
              ) : null}
              {c.carryOut > 0 ? (
                <p className="text-sm text-ink-muted">
                  {t('payouts.mine.carry', { amount: money(c.carryOut) })}
                </p>
              ) : null}
              <Link
                to="/instructor/cycles/$month"
                params={{ month: c.month }}
                className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                <FileText aria-hidden="true" className="size-4" />
                {t('payouts.mine.statement')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function downloadCsv(csv: string, month: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `payout-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CycleStatementView(props: { statement: CycleStatement }) {
  const { t, locale, formatDate } = useI18n();
  const money = useMoney();
  const s = props.statement;
  const course = (l: CycleStatement['lines'][number]) =>
    (locale === 'bn' ? l.titleBn : l.titleEn) || l.titleBn || l.titleEn;
  return (
    <article className="flex flex-col gap-6" data-testid="cycle-statement">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          to="/instructor/earnings"
          className="tap-target text-sm font-semibold text-primary hover:underline"
        >
          {t('statement.back')}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadCsv(s.csv[locale], s.month)}>
            <Download aria-hidden="true" className="size-4" />
            {t('statement.csv')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            {t('statement.print')}
          </Button>
        </div>
      </div>
      <header className="flex flex-col gap-1 border-b border-primary/20 pb-4">
        <p className="text-sm font-semibold text-primary">{t('payouts.statement.kicker')}</p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {t('payouts.statement.title', { month: monthLong(s.month, locale) })}
        </h1>
        <p className="text-ink/80">{s.instructorName}</p>
        <CycleState cycle={s} />
      </header>
      <dl className="grid gap-3 sm:grid-cols-4">
        {(
          [
            ['payouts.col.earned', s.earned],
            ['payouts.col.carryIn', -s.carryIn],
            ['payouts.col.carryOut', s.carryOut],
            ['payouts.col.payout', s.payout],
          ] as const
        ).map(([key, v]) => (
          <div key={key} className="flex flex-col gap-1 border border-primary/15 bg-background p-4">
            <dt className="text-sm text-ink/70">{t(key)}</dt>
            <dd className="text-xl font-extrabold tabular-nums">{money(v)}</dd>
          </div>
        ))}
      </dl>
      {s.lines.length === 0 ? (
        <p className="text-ink-muted">{t('statement.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-primary/10 text-sm">
          {s.lines.map((l, i) => (
            <li
              key={`${l.occurredAt}-${i.toString()}`}
              className="flex items-start justify-between gap-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold break-words">
                  {t(`statement.kind.${l.kind}`)}
                  {course(l) ? ` · ${course(l)}` : ''}
                </span>
                <span className="text-xs text-ink-muted">{formatDate(l.occurredAt)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">{t('payouts.statement.note')}</p>
      <p className="text-xs text-ink-muted" data-testid="cycle-statement-kept">
        {t('payouts.statement.kept', {
          stored: formatDate(s.storedAt),
          until: formatDate(s.retainUntil),
        })}
      </p>
    </article>
  );
}
