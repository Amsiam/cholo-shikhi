// A3 fraud review (US4.9, US8.11; review queues only, no detector), for Admins with two-step
// sign-in: flag an account by hand for Vault gaming, live-quiz collusion or referral fraud with a
// reason; each open flag can be cleared (its hold is lifted) or banned (the account is suspended).
// A ban is reversible: a banned account can be reinstated with a reason.
// The kind filter lives in the page address. An empty queue says "Nothing to review".
import { useForm } from '@tanstack/react-form';
import { Ban, CircleCheck, RotateCcw, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FlagView, FraudQueue } from '../server/fraud.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };
export type FraudKind = 'vault_gaming' | 'quiz_collusion' | 'referral_fraud';
export const FRAUD_KINDS: readonly FraudKind[] = [
  'vault_gaming',
  'quiz_collusion',
  'referral_fraud',
];
type DecideAction = 'clear' | 'ban' | 'reinstate';
const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function FlagForm(props: {
  onFlag: (v: { kind: FraudKind; user: string; reason: string }) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: { kind: 'vault_gaming' as FraudKind, user: '', reason: '' },
    onSubmit: async ({ value }) => {
      const r = await props.onFlag(value);
      setMessage(
        r.ok
          ? { ok: true, key: 'fraud.flagged' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.fraud.invalid' },
      );
      if (r.ok) form.reset();
    },
  });
  return (
    <section className={card} aria-labelledby="fr-flag">
      <h2 id="fr-flag" className="text-xl font-bold">
        {t('fraud.flag.title')}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="kind">
          {(f) => (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-medium">{t('fraud.flag.kind')}</legend>
              {FRAUD_KINDS.map((k) => (
                <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="fr-kind"
                    className="size-4 accent-primary"
                    checked={f.state.value === k}
                    onChange={() => f.handleChange(k)}
                  />
                  {t(`fraud.kind.${k}`)}
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="user">
            {(f) => (
              <div className="grid gap-1.5">
                <Label htmlFor="fr-user">{t('fraud.flag.user')}</Label>
                <Input
                  id="fr-user"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="reason">
            {(f) => (
              <div className="grid gap-1.5">
                <Label htmlFor="fr-reason">{t('fraud.reason')}</Label>
                <Input
                  id="fr-reason"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              </div>
            )}
          </form.Field>
        </div>
        <Button type="submit" className="w-fit" data-testid="fraud-flag-submit">
          {t('fraud.flag.submit')}
        </Button>
      </form>
      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`text-sm ${message.ok ? '' : 'text-destructive'}`}
        >
          {tDynamic(message.key)}
        </p>
      ) : null}
    </section>
  );
}

function FlagRowView(props: {
  flag: FlagView;
  onDecide: (flagId: string, action: DecideAction, reason: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatDateTime } = useI18n();
  const f = props.flag;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'clear' | 'ban') => {
    setError(null);
    const r = await props.onDecide(f.flagId, action, reason);
    if (!r.ok) setError(r.error.i18nKey ?? 'errors.fraud.invalid');
  };
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="fraud-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{f.name || f.userId}</span>
        <span className="text-sm">{t(`fraud.kind.${f.kind}`)}</span>
      </div>
      <p className="text-sm">{f.reason}</p>
      <p className="text-xs text-ink-muted">{formatDateTime(f.flaggedAt)}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor={`fr-decide-${f.flagId}`}>{t('fraud.reason')}</Label>
          <Input
            id={`fr-decide-${f.flagId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void act('clear')}
          data-testid="fraud-clear"
        >
          <CircleCheck aria-hidden="true" className="size-4" />
          {t('fraud.clear')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => void act('ban')}
          data-testid="fraud-ban"
        >
          <Ban aria-hidden="true" className="size-4" />
          {t('fraud.ban')}
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

function BannedRowView(props: {
  flag: FlagView;
  onDecide: (flagId: string, action: DecideAction, reason: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatDateTime } = useI18n();
  const f = props.flag;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reinstate = async () => {
    setError(null);
    const r = await props.onDecide(f.flagId, 'reinstate', reason);
    if (!r.ok) setError(r.error.i18nKey ?? 'errors.fraud.invalid');
  };
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="fraud-banned-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{f.name || f.userId}</span>
        <span className="text-sm">{t(`fraud.kind.${f.kind}`)}</span>
      </div>
      <p className="text-sm">{f.decisionReason}</p>
      {f.decidedAt ? <p className="text-xs text-ink-muted">{formatDateTime(f.decidedAt)}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor={`fr-reinstate-${f.flagId}`}>{t('fraud.reason')}</Label>
          <Input
            id={`fr-reinstate-${f.flagId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void reinstate()}
          data-testid="fraud-reinstate"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t('fraud.reinstate')}
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

export function FraudReview(props: {
  queue: FraudQueue;
  kind: FraudKind | undefined;
  onKind: (kind: FraudKind | undefined) => void;
  onFlag: (v: { kind: FraudKind; user: string; reason: string }) => Promise<Outcome>;
  onDecide: (flagId: string, action: DecideAction, reason: string) => Promise<Outcome>;
}) {
  const { t, formatDateTime } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="fraud-review">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <ShieldQuestion aria-hidden="true" className="size-7 text-primary" />
          {t('fraud.title')}
        </h1>
        <p className="text-ink/75">{t('fraud.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="fr-queue">
        <h2 id="fr-queue" className="text-lg font-bold">
          {t('fraud.queue')}
        </h2>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('fraud.filter')}</legend>
          <Button
            size="sm"
            variant={props.kind ? 'outline' : 'default'}
            aria-pressed={!props.kind}
            onClick={() => props.onKind(undefined)}
          >
            {t('fraud.all')}
          </Button>
          {FRAUD_KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={props.kind === k ? 'default' : 'outline'}
              aria-pressed={props.kind === k}
              onClick={() => props.onKind(k)}
            >
              {t(`fraud.kind.${k}`)}
            </Button>
          ))}
        </fieldset>
        {props.queue.open.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="fraud-empty">
            {props.queue.lastReviewAt
              ? t('fraud.emptySince', { at: formatDateTime(props.queue.lastReviewAt) })
              : t('fraud.empty')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.queue.open.map((f) => (
              <FlagRowView key={f.flagId} flag={f} onDecide={props.onDecide} />
            ))}
          </ul>
        )}
      </section>
      {props.queue.banned.length > 0 ? (
        <section className={card} aria-labelledby="fr-banned">
          <h2 id="fr-banned" className="text-lg font-bold">
            {t('fraud.banned')}
          </h2>
          <p className="text-sm text-ink-muted">{t('fraud.bannedHint')}</p>
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.queue.banned.map((f) => (
              <BannedRowView key={f.flagId} flag={f} onDecide={props.onDecide} />
            ))}
          </ul>
        </section>
      ) : null}
      <FlagForm onFlag={props.onFlag} />
      {props.queue.decided.length > 0 ? (
        <section className={card} aria-labelledby="fr-decided">
          <h2 id="fr-decided" className="text-lg font-bold">
            {t('fraud.decided')}
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {props.queue.decided.map((f) => (
              <li key={f.flagId}>
                {f.name || f.userId} · {t(`fraud.kind.${f.kind}`)} · {t(`fraud.state.${f.state}`)} ·{' '}
                {f.state === 'reinstated' ? f.reinstateReason : f.decisionReason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
