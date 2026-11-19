// Admin: refund requests. Each shows the purchase, the Student's reason and what each policy would
// pay back now; the Admin approves (full, unused share, or a partial amount) or rejects with a note.
// The refund window is set here too, since refunds stay closed until it is, and so is how long an
// unpaid checkout stays open (its promo use is then given back).
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { RefundQueueRow } from '../server/refund.server.ts';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };
type Policy = 'full' | 'unused' | 'partial';
type Status = 'pending' | 'approved' | 'rejected';
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

function WindowForm(props: { days: number | null; onSave: (days: number) => Promise<Outcome> }) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { days: props.days ?? 7 },
    onSubmit: async ({ value }) => {
      const r = await props.onSave(value.days);
      setError(r.ok ? null : r.error.i18nKey);
    },
  });
  return (
    <form
      noValidate
      className={`flex flex-wrap items-end gap-3 border p-4 ${props.days === null ? 'border-omr bg-omr-soft' : 'border-primary/15 bg-background'}`}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="refund-window"
    >
      <p className="w-full text-sm">
        {props.days === null
          ? t('refund.admin.windowUnset')
          : t('refund.admin.windowIs', { days: formatInteger(props.days) })}
      </p>
      <form.Field name="days">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor="refund-window-days">{t('refund.admin.windowDays')}</Label>
            <Input
              id="refund-window-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              className="w-32"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
            />
          </div>
        )}
      </form.Field>
      <Button type="submit" variant="outline">
        {t('refund.admin.windowSave')}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </form>
  );
}

/** How long an unpaid checkout stays open before its promo use is given back. */
function ExpiryForm(props: { minutes: number; onSave: (minutes: number) => Promise<Outcome> }) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { minutes: props.minutes },
    onSubmit: async ({ value }) => {
      const r = await props.onSave(value.minutes);
      setError(r.ok ? null : r.error.i18nKey);
    },
  });
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3 border border-primary/15 bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="checkout-expiry"
    >
      <p className="w-full text-sm">
        {t('checkout.expiry.is', { minutes: formatInteger(props.minutes) })}
      </p>
      <form.Field name="minutes">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor="checkout-expiry-minutes">{t('checkout.expiry.label')}</Label>
            <Input
              id="checkout-expiry-minutes"
              type="number"
              inputMode="numeric"
              min={15}
              max={1440}
              className="w-32"
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
            />
          </div>
        )}
      </form.Field>
      <Button type="submit" variant="outline">
        {t('refund.admin.windowSave')}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </form>
  );
}

function Decision(props: {
  row: RefundQueueRow;
  onDecide: (input: {
    refundId: string;
    decision: 'approve' | 'reject';
    policy?: Policy;
    partialPoisha?: number;
    note?: string;
  }) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatMoney } = useI18n();
  const r = props.row;
  const [policy, setPolicy] = useState<Policy>('unused');
  const [partialTaka, setPartialTaka] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    setIsBusy(true);
    setError(null);
    const partial = Math.round(Number(partialTaka) * 100);
    const res = await props.onDecide({
      refundId: r.refundId,
      decision,
      ...(decision === 'approve' ? { policy } : {}),
      ...(decision === 'approve' && policy === 'partial' && Number.isFinite(partial) && partial > 0
        ? { partialPoisha: partial }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setIsBusy(false);
    if (!res.ok) {
      const field = res.error.fieldErrors
        ? Object.values(res.error.fieldErrors)[0]?.[0]
        : undefined;
      setError(field ?? res.error.i18nKey);
    }
  };
  const options: Array<{ value: Policy; label: string }> = [
    {
      value: 'full',
      label: t('refund.policy.full', { amount: formatMoney(r.options.full as MoneyPoisha) }),
    },
    {
      value: 'unused',
      label: t('refund.policy.unused', { amount: formatMoney(r.options.unused as MoneyPoisha) }),
    },
    { value: 'partial', label: t('refund.policy.partial') },
  ];
  return (
    <div
      className="flex flex-col gap-3 border-t border-primary/10 pt-3"
      data-testid="refund-decision"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">{t('refund.admin.policy')}</legend>
        {options.map((o) => (
          <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`policy-${r.refundId}`}
              className="size-4 accent-primary"
              checked={policy === o.value}
              onChange={() => setPolicy(o.value)}
            />
            {o.label}
          </label>
        ))}
        {policy === 'partial' ? (
          <div className="grid max-w-48 gap-1.5 pl-6">
            <Label htmlFor={`partial-${r.refundId}`}>{t('refund.admin.partialTaka')}</Label>
            <Input
              id={`partial-${r.refundId}`}
              inputMode="decimal"
              value={partialTaka}
              onChange={(e) => setPartialTaka(e.target.value)}
            />
          </div>
        ) : null}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor={`note-${r.refundId}`}>{t('refund.admin.note')}</Label>
        <textarea
          id={`note-${r.refundId}`}
          className="min-h-20 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isBusy}
          onClick={() => void decide('approve')}
          data-testid="refund-approve"
        >
          {t('refund.admin.approve')}
        </Button>
        <Button
          variant="outline"
          className="border-omr text-omr"
          disabled={isBusy}
          onClick={() => void decide('reject')}
          data-testid="refund-reject"
        >
          {t('refund.admin.reject')}
        </Button>
      </div>
    </div>
  );
}

export function RefundQueue(props: {
  rows: RefundQueueRow[];
  status: Status | undefined;
  windowDays: number | null;
  pendingExpiryMinutes: number;
  page: number;
  pageCount: number;
  onStatus: (status: Status | undefined) => void;
  onPage: (page: number) => void;
  onDecide: Parameters<typeof Decision>[0]['onDecide'];
  onSaveWindow: (days: number) => Promise<Outcome>;
  onSaveExpiry: (minutes: number) => Promise<Outcome>;
}) {
  const { t, locale, formatMoney, formatDate, formatDateTime } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="refund-queue">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('refund.admin.title')}
        </h1>
        <p className="text-ink/75">{t('refund.admin.subtitle')}</p>
      </header>
      <WindowForm days={props.windowDays} onSave={props.onSaveWindow} />
      <ExpiryForm minutes={props.pendingExpiryMinutes} onSave={props.onSaveExpiry} />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t('bank.filter.status')}</legend>
        {([undefined, 'pending', 'approved', 'rejected'] as const).map((s) => (
          <Button
            key={s ?? 'all'}
            size="sm"
            variant={props.status === s ? 'default' : 'outline'}
            aria-pressed={props.status === s}
            onClick={() => props.onStatus(s)}
          >
            {s ? t(`refund.state.${s}`) : t('bank.filter.all')}
          </Button>
        ))}
      </fieldset>
      {props.rows.length === 0 ? (
        <p className="border border-dashed border-primary/25 bg-background p-6 text-ink-muted">
          {t('refund.admin.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {props.rows.map((r) => (
            <li
              key={r.refundId}
              className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
              data-testid="refund-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-bold break-words">
                    {pick(r.titleBn, r.titleEn, locale)}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {t('refund.admin.by', {
                      name: r.studentName || '—',
                      date: formatDateTime(r.requestedAt),
                    })}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-bold tabular-nums">
                    {formatMoney(r.paidPoisha as MoneyPoisha)}
                  </span>
                  {r.paidAt ? (
                    <span className="text-xs text-ink-muted">
                      {t('refund.admin.paidOn', { date: formatDate(r.paidAt) })}
                    </span>
                  ) : null}
                </span>
              </div>
              <blockquote className="border-l-2 border-primary/30 pl-3 text-sm whitespace-pre-line">
                {r.reason}
              </blockquote>
              {r.accessStartsAt && r.accessEndsAt ? (
                <p className="text-xs text-ink-muted">
                  {t('refund.admin.access', {
                    start: formatDate(r.accessStartsAt),
                    end: formatDate(r.accessEndsAt),
                  })}
                </p>
              ) : null}
              {r.status === 'pending' ? (
                <Decision row={r} onDecide={props.onDecide} />
              ) : (
                <p className="text-sm">
                  <span
                    className={`font-semibold ${r.status === 'approved' ? 'text-pass' : 'text-omr'}`}
                  >
                    {t(`refund.state.${r.status}`)}
                  </span>
                  {r.refundPoisha ? ` · ${formatMoney(r.refundPoisha as MoneyPoisha)}` : ''}
                  {r.policy ? ` · ${t(`refund.policyName.${r.policy}`)}` : ''}
                  {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.pageCount > 1 ? (
        <nav className="flex justify-between gap-3" aria-label={t('explore.pages')}>
          <Button
            variant="outline"
            disabled={props.page <= 1}
            onClick={() => props.onPage(props.page - 1)}
          >
            {t('exams.sheet.prev')}
          </Button>
          <Button
            variant="outline"
            disabled={props.page >= props.pageCount}
            onClick={() => props.onPage(props.page + 1)}
          >
            {t('exams.sheet.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
