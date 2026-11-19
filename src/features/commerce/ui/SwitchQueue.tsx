// A2 switch queue (US2.18): pending requests by time left, each with both refund options worked
// out; approve with a policy or deny with a reason. Near-expiry rows carry an icon and text.
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { SwitchQueueRow } from '../server/switch.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };
type Decide = (input: {
  switchId: string;
  decision: 'approve' | 'deny';
  policy?: 'full' | 'unused';
  reason?: string;
}) => Promise<Outcome>;

function Row(props: { row: SwitchQueueRow; onDecide: Decide }) {
  const { t, tDynamic, locale, formatMoney, formatInteger } = useI18n();
  const r = props.row;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const hours = Math.floor(r.minutesLeft / 60);
  const left = t('switch.queue.left', {
    h: formatInteger(hours),
    m: formatInteger(r.minutesLeft % 60),
  });
  const act = async (input: Parameters<Decide>[0]) => {
    setError(null);
    const res = await props.onDecide(input);
    if (!res.ok) setError(res.error.i18nKey ?? 'errors.switch.generic');
  };
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="switch-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{r.studentName}</span>
        <span className="inline-flex items-center gap-1 text-sm">
          {r.isNearExpiry ? (
            <>
              <AlertTriangle aria-hidden="true" className="size-4 text-omr" />
              <span className="font-semibold">{t('switch.queue.near')}</span>
            </>
          ) : null}
          {left}
        </span>
      </div>
      <p className="text-sm">
        {pick(r.fromTitleBn, r.fromTitleEn)} → {pick(r.toTitleBn, r.toTitleEn)}
      </p>
      <p className="text-xs text-ink-muted">
        {t('switch.queue.paid', { amount: formatMoney(r.paidPoisha as MoneyPoisha) })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void act({ switchId: r.switchId, decision: 'approve', policy: 'unused' })}
          data-testid="switch-approve-unused"
        >
          {t('switch.queue.approveUnused', {
            amount: formatMoney(r.unusedRefundPoisha as MoneyPoisha),
          })}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void act({ switchId: r.switchId, decision: 'approve', policy: 'full' })}
          data-testid="switch-approve-full"
        >
          {t('switch.queue.approveFull', { amount: formatMoney(r.paidPoisha as MoneyPoisha) })}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor={`switch-reason-${r.switchId}`}>{t('switch.queue.reason')}</Label>
          <input
            id={`switch-reason-${r.switchId}`}
            className="min-h-10 rounded-sm border border-input bg-background px-3 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-omr"
          onClick={() => void act({ switchId: r.switchId, decision: 'deny', reason })}
          data-testid="switch-deny"
        >
          {t('switch.queue.deny')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </li>
  );
}

export function SwitchQueue(props: { rows: SwitchQueueRow[]; onDecide: Decide }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="switch-queue">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <ArrowLeftRight aria-hidden="true" className="size-7 text-primary" />
          {t('switch.queue.title')}
        </h1>
        <p className="text-ink/75">{t('switch.queue.subtitle')}</p>
      </header>
      <section className="border border-primary/15 bg-background p-5">
        {props.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('switch.queue.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.rows.map((r) => (
              <Row key={r.switchId} row={r} onDecide={props.onDecide} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
