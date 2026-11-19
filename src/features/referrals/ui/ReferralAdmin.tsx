// A1 referral payouts (US8.7, US8.8), for the owner-operator (an Admin with two-step sign-in): the
// referral share and the payout threshold (10% and ৳500 by default, both changeable), and the
// withdrawal requests to approve (paid through the disbursement stub, never a live rail) or
// reject with a reason.
import { useForm } from '@tanstack/react-form';
import { CircleCheck, Share2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReferralAdmin, WithdrawalQueueRow } from '../server/withdrawal.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };
const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function NumberSetting(props: {
  id: string;
  label: string;
  current: string;
  initial: number;
  min: number;
  max: number;
  onSave: (value: number) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { value: props.initial },
    onSubmit: async ({ value }) => {
      const r = await props.onSave(value.value);
      setError(r.ok ? null : (r.error.i18nKey ?? 'errors.common.INTERNAL_ERROR'));
    },
  });
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="w-full text-sm">{props.current}</p>
      <form.Field name="value">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={props.id}>{props.label}</Label>
            <Input
              id={props.id}
              type="number"
              inputMode="numeric"
              min={props.min}
              max={props.max}
              className="w-40"
              value={field.state.value}
              onChange={(e) => field.handleChange(Math.trunc(Number(e.target.value)))}
            />
          </div>
        )}
      </form.Field>
      <Button type="submit" variant="outline">
        {t('referral.admin.save')}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </form>
  );
}

function RequestRow(props: {
  row: WithdrawalQueueRow;
  onDecide: (
    withdrawalId: string,
    decision: 'approve' | 'reject',
    reason: string,
  ) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatMoney, formatDateTime } = useI18n();
  const w = props.row;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (decision: 'approve' | 'reject') => {
    setError(null);
    const r = await props.onDecide(w.withdrawalId, decision, reason);
    if (!r.ok) setError(r.error.i18nKey ?? 'errors.common.INTERNAL_ERROR');
  };
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="referral-request">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{w.name || w.userId}</span>
        <span className="text-lg font-bold tabular-nums">
          {formatMoney(w.amountPoisha as MoneyPoisha)}
        </span>
      </div>
      <p className="text-sm">
        {t(`kyc.rail.${w.rail}`)} · {w.accountMasked} · {formatDateTime(w.requestedAt)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor={`rw-reason-${w.withdrawalId}`}>{t('referral.admin.reason')}</Label>
          <Input
            id={`rw-reason-${w.withdrawalId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => void act('approve')} data-testid="referral-approve">
          <CircleCheck aria-hidden="true" className="size-4" />
          {t('referral.admin.approve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => void act('reject')}
          data-testid="referral-reject"
        >
          <XCircle aria-hidden="true" className="size-4" />
          {t('referral.admin.reject')}
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

export function ReferralAdminView(props: {
  data: ReferralAdmin;
  onSaveShare: (bps: number) => Promise<Outcome>;
  onSaveThreshold: (poisha: number) => Promise<Outcome>;
  onDecide: (
    withdrawalId: string,
    decision: 'approve' | 'reject',
    reason: string,
  ) => Promise<Outcome>;
}) {
  const { t, formatMoney, formatMarks, formatDate } = useI18n();
  const d = props.data;
  return (
    <div className="flex flex-col gap-6" data-testid="referral-admin">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Share2 aria-hidden="true" className="size-7 text-primary" />
          {t('referral.admin.title')}
        </h1>
        <p className="text-ink/75">{t('referral.admin.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="ra-settings">
        <h2 id="ra-settings" className="text-lg font-bold">
          {t('referral.admin.settings')}
        </h2>
        <NumberSetting
          id="ra-share"
          label={t('referral.admin.shareLabel')}
          current={
            d.shareBps === null
              ? t('referral.admin.shareUnset')
              : t('referral.admin.shareIs', { percent: formatMarks(d.shareBps) })
          }
          initial={d.shareBps ?? 500}
          min={0}
          max={10_000}
          onSave={props.onSaveShare}
        />
        <NumberSetting
          id="ra-threshold"
          label={t('referral.admin.thresholdLabel')}
          current={
            d.thresholdPoisha === null
              ? t('referral.admin.thresholdUnset')
              : t('referral.admin.thresholdIs', {
                  amount: formatMoney(d.thresholdPoisha as MoneyPoisha),
                })
          }
          initial={d.thresholdPoisha ?? 50_000}
          min={1}
          max={100_000_000}
          onSave={props.onSaveThreshold}
        />
      </section>
      <section className={card} aria-labelledby="ra-queue">
        <h2 id="ra-queue" className="text-lg font-bold">
          {t('referral.admin.queue')}
        </h2>
        <p className="text-sm text-ink-muted">{t('referral.admin.stub')}</p>
        {d.open.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="referral-queue-empty">
            {t('referral.admin.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {d.open.map((w) => (
              <RequestRow key={w.withdrawalId} row={w} onDecide={props.onDecide} />
            ))}
          </ul>
        )}
      </section>
      {d.decided.length > 0 ? (
        <section className={card} aria-labelledby="ra-decided">
          <h2 id="ra-decided" className="text-lg font-bold">
            {t('referral.admin.decided')}
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {d.decided.map((w) => (
              <li key={w.withdrawalId}>
                {w.name || w.userId} · {formatMoney(w.amountPoisha as MoneyPoisha)} ·{' '}
                {t(`referral.withdrawal.${w.status}`)}
                {w.decidedAt ? ` · ${formatDate(w.decidedAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
