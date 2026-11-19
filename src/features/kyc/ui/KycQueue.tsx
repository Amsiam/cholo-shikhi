// A6 KYC review (US7.21): KYC submissions and payout accounts waiting for Finance, oldest first.
// NID photos load only when asked. Approve, or reject with a reason the instructor will see.
import { CircleCheck, IdCard, ImageIcon, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { KycQueueItem } from '../server/kyc.server.ts';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

const DETAIL_KEYS = [
  'party',
  'legalName',
  'nid',
  'rail',
  'accountName',
  'account',
  'bank',
  'routing',
] as const;

function QueueRow(props: {
  item: KycQueueItem;
  onDecide: (decision: 'approve' | 'reject', reason?: string) => Promise<Outcome>;
  onPhoto: (side: 'front' | 'back') => Promise<string | null>;
}) {
  const { t, tDynamic, formatDateTime } = useI18n();
  const it = props.item;
  const [photos, setPhotos] = useState<{ front?: string; back?: string } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    const r = await props.onDecide(decision, reason.trim() || undefined);
    setBusy(false);
    if (!r.ok) setError(r.error.fieldErrors?.reason?.[0] ?? r.error.i18nKey);
  };
  const loadPhotos = async () => {
    const [front, back] = await Promise.all([props.onPhoto('front'), props.onPhoto('back')]);
    setPhotos({ ...(front ? { front } : {}), ...(back ? { back } : {}) });
  };
  const Icon = it.kind === 'kyc' ? IdCard : Wallet;
  return (
    <li
      className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      data-testid="kyc-queue-row"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <Icon aria-hidden="true" className="size-5 text-primary" />
          {t(`kyc.queue.kind.${it.kind}`)} · {it.displayName}
        </h2>
        <span className="text-xs text-ink-muted">{formatDateTime(it.submittedAt)}</span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {DETAIL_KEYS.filter((k) => it.details[k]).map((k) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{t(`kyc.queue.field.${k}`)}</dt>
            <dd className="font-medium tabular-nums">
              {k === 'rail'
                ? t(`kyc.rail.${it.details[k] as 'bkash'}`)
                : k === 'party'
                  ? t(`kyc.party.${it.details[k] as 'instructor'}`)
                  : it.details[k]}
            </dd>
          </div>
        ))}
      </dl>
      {it.kind === 'kyc' ? (
        photos ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['front', 'back'] as const).map((side) =>
              photos[side] ? (
                <figure key={side} className="flex flex-col gap-1">
                  <img
                    src={photos[side]}
                    alt={t(`kyc.form.${side}`)}
                    className="max-h-72 w-full border border-primary/15 object-contain"
                  />
                  <figcaption className="text-xs text-ink-muted">
                    {t(`kyc.form.${side}`)}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
        ) : (
          <Button variant="outline" className="w-fit" onClick={() => void loadPhotos()}>
            <ImageIcon aria-hidden="true" className="size-4" />
            {t('kyc.queue.showPhotos')}
          </Button>
        )
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`reason-${it.id}`}>{t('kyc.queue.reason')}</Label>
        <textarea
          id={`reason-${it.id}`}
          className="min-h-16 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void decide('approve')} data-testid="kyc-approve">
          {t('kyc.queue.approve')}
        </Button>
        <Button
          variant="outline"
          className="border-omr text-omr"
          disabled={busy}
          onClick={() => void decide('reject')}
          data-testid="kyc-reject"
        >
          {t('kyc.queue.reject')}
        </Button>
      </div>
    </li>
  );
}

export function KycQueue(props: {
  items: KycQueueItem[];
  onDecide: (
    item: KycQueueItem,
    decision: 'approve' | 'reject',
    reason?: string,
  ) => Promise<Outcome>;
  onPhoto: (item: KycQueueItem, side: 'front' | 'back') => Promise<string | null>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="kyc-queue">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('kyc.queue.title')}
        </h1>
        <p className="text-ink/75">{t('kyc.queue.subtitle')}</p>
      </header>
      {props.items.length === 0 ? (
        <p className="flex items-center gap-2 border border-dashed border-primary/25 bg-background p-6 text-ink-muted">
          <CircleCheck aria-hidden="true" className="size-5 text-pass" />
          {t('kyc.queue.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {props.items.map((item) => (
            <QueueRow
              key={`${item.kind}-${item.id}`}
              item={item}
              onDecide={(decision, reason) => props.onDecide(item, decision, reason)}
              onPhoto={(side) => props.onPhoto(item, side)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
