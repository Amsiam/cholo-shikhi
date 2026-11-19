// S18 Me → Refer (US8.6, US8.7): the personal link (an opaque code, nothing personal) with a copy
// button, how many friends joined, the share, the referral balance (it can be below 0 after a
// refund of money already withdrawn) and its history.
import { Copy, Share2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MyReferral } from '../server/referral.server.ts';

const card = 'flex flex-col gap-3 border border-primary/15 bg-background p-5';

/** Money that may be negative (a clawback), formatted through the shared formatter. */
function useSignedMoney() {
  const { formatMoney } = useI18n();
  return (n: number) =>
    n < 0 ? `−${formatMoney(-n as MoneyPoisha)}` : formatMoney(n as MoneyPoisha);
}

export function ReferView(props: { data: MyReferral; children?: ReactNode }) {
  const { t, formatInteger, formatDate, formatMarks } = useI18n();
  const money = useSignedMoney();
  const d = props.data;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-6" data-testid="refer-view">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Share2 aria-hidden="true" className="size-7 text-primary" />
          {t('referral.title')}
        </h1>
        <p className="text-ink/75">{t('referral.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="ref-link">
        <h2 id="ref-link" className="text-lg font-bold">
          {t('referral.link')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Input
            readOnly
            value={d.link}
            aria-label={t('referral.link')}
            className="min-w-0 flex-1 font-mono"
            data-testid="referral-link"
          />
          <Button variant="outline" onClick={() => void copy()} data-testid="referral-copy">
            <Copy aria-hidden="true" className="size-4" />
            {copied ? t('referral.copied') : t('referral.copy')}
          </Button>
        </div>
        <p className="text-sm text-ink-muted">
          {t('referral.joined', { count: formatInteger(d.referredCount) })}
        </p>
        <p className="text-sm">
          {d.shareBps === null
            ? t('referral.shareUnset')
            : t('referral.share', { percent: formatMarks(d.shareBps) })}
        </p>
      </section>
      <section className={card} aria-labelledby="ref-balance">
        <h2 id="ref-balance" className="text-lg font-bold">
          {t('referral.balance')}
        </h2>
        <p
          className={`text-3xl font-extrabold tabular-nums ${d.balancePoisha < 0 ? 'text-destructive' : ''}`}
          data-testid="referral-balance"
        >
          {money(d.balancePoisha)}
        </p>
        {d.balancePoisha < 0 ? (
          <p className="text-sm text-ink-muted">{t('referral.negative')}</p>
        ) : null}
        {props.children}
      </section>
      <section className={card} aria-labelledby="ref-history">
        <h2 id="ref-history" className="text-lg font-bold">
          {t('referral.history')}
        </h2>
        {d.lines.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('referral.noHistory')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10 text-sm">
            {d.lines.map((l) => (
              <li
                key={`${l.kind}-${l.occurredAt}-${l.amountPoisha}`}
                className="flex flex-wrap justify-between gap-2 py-2"
              >
                <span>
                  {t(`referral.kind.${l.kind}`)} · {formatDate(l.occurredAt)}
                </span>
                <span className="font-semibold tabular-nums">{money(l.amountPoisha)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
