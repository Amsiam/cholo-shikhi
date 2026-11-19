// A1 Payout cycles (US7.2–US7.6): run a dry run for the oldest ended month, commit it behind a
// confirmation, then record each line's payment (Admin with two-step sign-in, once the golden
// payout examples are approved), a failure (held, re-verification flagged) or a release.
// States are text with an icon, never colour alone.
import { CircleAlert, CircleCheck, Clock3, Lock, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DryRun, PayoutLineView, PayoutsOverview } from '../server/payouts.server.ts';

type Outcome = { ok: true; value?: unknown } | { ok: false; error: { i18nKey: string } };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function StateBadge(props: { state: 'pending' | 'held' | 'disbursed'; reason?: string | null }) {
  const { t } = useI18n();
  const Icon =
    props.state === 'disbursed' ? CircleCheck : props.state === 'held' ? CircleAlert : Clock3;
  const color =
    props.state === 'disbursed'
      ? 'text-pass'
      : props.state === 'held'
        ? 'text-omr'
        : 'text-primary';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
      <Icon aria-hidden="true" className={`size-4 ${color}`} />
      {t(`payouts.state.${props.state}`)}
      {props.reason ? ` · ${t(`payouts.holdReason.${props.reason as 'kyc'}`)}` : ''}
    </span>
  );
}

function useMoney() {
  const { formatMoney } = useI18n();
  return (v: number) =>
    v < 0 ? `−${formatMoney(-v as MoneyPoisha)}` : formatMoney(v as MoneyPoisha);
}

function LineActions(props: {
  line: PayoutLineView;
  canPay: boolean;
  onPay: (lineId: string, providerRef: string, key: string) => Promise<Outcome>;
  onFail: (lineId: string, note: string) => Promise<Outcome>;
  onRelease: (lineId: string) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  // One key per payment attempt, kept across retries so a retry never pays twice.
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<Outcome>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error.i18nKey);
  };
  const l = props.line;
  if (l.state === 'disbursed' || l.payout === 0) return null;
  if (l.state === 'held')
    return (
      <div className="flex flex-col gap-2">
        {l.holdNote ? <p className="text-xs text-ink-muted">{l.holdNote}</p> : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => props.onRelease(l.lineId))}
        >
          {t('payouts.release')}
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {props.canPay ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`ref-${l.lineId}`} className="text-xs">
              {t('payouts.providerRef')}
            </Label>
            <Input
              id={`ref-${l.lineId}`}
              className="h-9 w-40"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || ref.trim().length < 3}
            onClick={() => void run(() => props.onPay(l.lineId, ref.trim(), key))}
            data-testid="payout-pay"
          >
            {t('payouts.recordPaid')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`note-${l.lineId}`} className="text-xs">
            {t('payouts.failureNote')}
          </Label>
          <Input
            id={`note-${l.lineId}`}
            className="h-9 w-48"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-omr text-omr"
          disabled={busy || note.trim().length < 3}
          onClick={() => void run(() => props.onFail(l.lineId, note.trim()))}
        >
          {t('payouts.recordFailed')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </div>
  );
}

function LinesTable(props: {
  lines: ReadonlyArray<{
    key: string;
    name: string;
    earned: number;
    salary: number;
    adjustment: number;
    carryIn: number;
    payout: number;
    carryOut: number;
    state: 'pending' | 'held' | 'disbursed';
    reason?: string | null;
    /** AC7.16.3: days of absence without leave, flagged for review. */
    absenceWithoutLeaveDays?: number;
    actions?: React.ReactNode;
  }>;
}) {
  const { t, formatInteger } = useI18n();
  const money = useMoney();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="border-b border-primary/15 text-ink/70">
          <tr>
            {(
              [
                'instructor',
                'earned',
                'salary',
                'adjustment',
                'carryIn',
                'payout',
                'carryOut',
                'state',
              ] as const
            ).map((c) => (
              <th key={c} scope="col" className="px-2 py-2 font-semibold">
                {t(`payouts.col.${c}`)}
              </th>
            ))}
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">{t('payouts.col.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/10">
          {props.lines.map((l) => (
            <tr key={l.key} data-testid="payout-line" className="align-top">
              <th scope="row" className="px-2 py-2 font-semibold">
                {l.name}
                {l.absenceWithoutLeaveDays ? (
                  <span
                    className="block text-xs font-normal text-omr"
                    data-testid="payout-absence-flag"
                  >
                    {t('payouts.absenceFlag', { n: formatInteger(l.absenceWithoutLeaveDays) })}
                  </span>
                ) : null}
              </th>
              <td className="px-2 py-2 tabular-nums">{money(l.earned)}</td>
              <td className="px-2 py-2 tabular-nums">{money(l.salary)}</td>
              <td className="px-2 py-2 tabular-nums">{money(l.adjustment)}</td>
              <td className="px-2 py-2 tabular-nums">{money(l.carryIn)}</td>
              <td className="px-2 py-2 font-bold tabular-nums">{money(l.payout)}</td>
              <td className="px-2 py-2 tabular-nums">{money(l.carryOut)}</td>
              <td className="px-2 py-2">
                <StateBadge state={l.state} reason={l.reason ?? null} />
              </td>
              <td className="px-2 py-2">{l.actions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PayoutCycles(props: {
  data: PayoutsOverview;
  canPay: boolean;
  onDryRun: (
    month: string,
  ) => Promise<{ ok: true; value: DryRun } | { ok: false; error: { i18nKey: string } }>;
  onCommit: (month: string, inputHash: string) => Promise<Outcome>;
  onPay: (lineId: string, providerRef: string, key: string) => Promise<Outcome>;
  onFail: (lineId: string, note: string) => Promise<Outcome>;
  onRelease: (lineId: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatDateTime, formatInteger } = useI18n();
  const money = useMoney();
  const [dry, setDry] = useState<DryRun | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = props.data.openMonths[0] ?? null;
  const monthName = (m: string) =>
    new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${m}-15T00:00:00Z`));

  const dryRun = async (month: string) => {
    setBusy(true);
    setError(null);
    setIsConfirming(false);
    const r = await props.onDryRun(month);
    setBusy(false);
    if (r.ok) setDry(r.value);
    else setError(r.error.i18nKey);
  };
  const commit = async () => {
    if (!dry) return;
    setBusy(true);
    const r = await props.onCommit(dry.month, dry.inputHash);
    setBusy(false);
    if (r.ok) {
      setDry(null);
      setIsConfirming(false);
    } else setError(r.error.i18nKey);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="payout-cycles">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('payouts.title')}</h1>
        <p className="text-ink/75">{t('payouts.subtitle')}</p>
      </header>
      {props.data.isGoldenApproved ? null : (
        <p
          role="note"
          className="flex items-start gap-2 border border-omr/40 bg-omr-soft p-4 text-sm"
          data-testid="golden-unapproved"
        >
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-omr" />
          {t('payouts.goldenUnapproved')}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}

      <section className={card} aria-labelledby="payout-run">
        <h2 id="payout-run" className="text-xl font-bold">
          {t('payouts.run.title')}
        </h2>
        {next ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">{t('payouts.run.next', { month: monthName(next) })}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void dryRun(next)}
              data-testid="payout-dry-run"
            >
              <PlayCircle aria-hidden="true" className="size-4" />
              {t('payouts.run.dry')}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('payouts.run.none')}</p>
        )}
        {dry ? (
          <div className="flex flex-col gap-3" data-testid="payout-dry">
            <p className="text-sm">
              {t('payouts.run.summary', {
                month: monthName(dry.month),
                payout: money(dry.totals.payout),
                carry: money(dry.totals.carryOut),
              })}
            </p>
            {dry.rules.isOn && !dry.rules.isApproved ? (
              <p
                role="alert"
                className="flex items-start gap-2 border border-omr/40 bg-omr-soft p-3 text-sm"
                data-testid="payout-drafts-unapproved"
              >
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-omr" />
                {t('payouts.draftsUnapproved')}
              </p>
            ) : null}
            {dry.missingSalary.length > 0 ? (
              <p
                role="alert"
                className="flex items-start gap-2 border border-omr/40 bg-omr-soft p-3 text-sm"
                data-testid="payout-missing-salary"
              >
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-omr" />
                {t('payouts.missingSalary', {
                  names: dry.missingSalary.map((x) => x.name || x.instructorId).join(', '),
                })}
              </p>
            ) : null}
            {dry.openAttributionCases > 0 ? (
              <p
                role="alert"
                className="flex items-start gap-2 border border-omr/40 bg-omr-soft p-3 text-sm"
                data-testid="payout-attribution-flag"
              >
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-omr" />
                {t('attribution.dryRunFlag', { n: formatInteger(dry.openAttributionCases) })}
              </p>
            ) : null}
            {dry.lines.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('payouts.run.empty')}</p>
            ) : (
              <LinesTable
                lines={dry.lines.map((l) => ({
                  ...l,
                  name: l.isAttributionDisputed
                    ? t('attribution.markedLine', { name: l.name })
                    : l.name,
                  key: l.instructorId,
                  reason: l.state === 'held' ? 'kyc' : null,
                }))}
              />
            )}
            <p className="font-mono text-xs break-all text-ink-muted">
              {t('payouts.run.hash', { hash: dry.inputHash })}
            </p>
            {isConfirming ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3">
                <p className="text-sm font-semibold">{t('payouts.run.confirm')}</p>
                <Button
                  disabled={busy}
                  onClick={() => void commit()}
                  data-testid="payout-commit-confirm"
                >
                  {t('payouts.run.commitYes')}
                </Button>
                <Button variant="outline" onClick={() => setIsConfirming(false)}>
                  {t('payouts.run.cancel')}
                </Button>
              </div>
            ) : (
              <Button
                className="w-fit"
                onClick={() => setIsConfirming(true)}
                data-testid="payout-commit"
              >
                {t('payouts.run.commit')}
              </Button>
            )}
          </div>
        ) : null}
      </section>

      {props.data.cycles.map((c) => (
        <section
          key={c.cycleId}
          className={card}
          aria-labelledby={`cycle-${c.month}`}
          data-testid="payout-cycle"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`cycle-${c.month}`} className="text-xl font-bold">
              {monthName(c.month)}
            </h2>
            <span className="text-xs text-ink-muted">
              {t('payouts.committedAt', { date: formatDateTime(c.committedAt) })}
            </span>
          </div>
          <p className="text-sm">
            {t('payouts.cycleTotals', {
              payout: money(c.totals.payout),
              carry: money(c.totals.carryOut),
            })}
          </p>
          {c.lines.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('payouts.run.empty')}</p>
          ) : (
            <LinesTable
              lines={c.lines.map((l) => ({
                ...l,
                key: l.lineId,
                reason: l.holdReason,
                actions: (
                  <LineActions
                    line={l}
                    canPay={props.canPay && props.data.isGoldenApproved}
                    onPay={props.onPay}
                    onFail={props.onFail}
                    onRelease={props.onRelease}
                  />
                ),
              }))}
            />
          )}
        </section>
      ))}
    </div>
  );
}
