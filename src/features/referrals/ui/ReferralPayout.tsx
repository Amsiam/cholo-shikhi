// S18 payout part (US8.8, US8.9): the adult declaration ("I am 18 or older"), then KYC and the
// payout account through the shared KYC screen, the threshold, why the balance is not payable
// now, a Withdraw button when it is, and past withdrawals.
import { useState } from 'react';
import type { MyKyc } from '#src/features/kyc/index.ts';
import { KycView } from '#src/features/kyc/ui/KycView.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { MyReferralPayout } from '../server/withdrawal.server.ts';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

export function ReferralPayout(props: {
  data: MyReferralPayout;
  onDeclareAdult: () => Promise<Outcome>;
  onSubmitKyc: (input: Record<string, string>) => Promise<Outcome>;
  onSaveAccount: (input: Record<string, string>) => Promise<Outcome>;
  onWithdraw: () => Promise<Outcome>;
}) {
  const { t, tDynamic, formatMoney, formatDate } = useI18n();
  const d = props.data;
  const [isAdultTicked, setIsAdultTicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<Outcome>) => {
    setError(null);
    const r = await action();
    if (!r.ok) setError(r.error.i18nKey);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="referral-payout">
      <p className="text-sm" data-testid="referral-payable">
        {d.block === null
          ? t('referral.payable')
          : t(`referral.block.${d.block}`, {
              threshold: d.thresholdPoisha ? formatMoney(d.thresholdPoisha as MoneyPoisha) : '',
            })}
      </p>
      {d.block === null ? (
        <Button
          className="w-fit"
          onClick={() => void run(props.onWithdraw)}
          data-testid="referral-withdraw"
        >
          {t('referral.withdraw')}
        </Button>
      ) : null}
      {!d.isAdult ? (
        <div className="flex flex-col gap-2 border border-dashed border-primary/30 p-4">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={isAdultTicked}
              onChange={(e) => setIsAdultTicked(e.target.checked)}
              data-testid="referral-adult"
            />
            {t('referral.adult.label')}
          </label>
          <p className="text-xs text-ink-muted">{t('referral.adult.hint')}</p>
          <Button
            variant="outline"
            className="w-fit"
            disabled={!isAdultTicked}
            onClick={() => void run(props.onDeclareAdult)}
          >
            {t('referral.adult.confirm')}
          </Button>
        </div>
      ) : (
        <KycView
          data={d.kyc as MyKyc}
          onSubmitKyc={props.onSubmitKyc}
          onSaveAccount={props.onSaveAccount}
        />
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      {d.withdrawals.length > 0 ? (
        <ul className="flex flex-col divide-y divide-primary/10 text-sm">
          {d.withdrawals.map((w) => (
            <li key={w.withdrawalId} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {t(`referral.withdrawal.${w.status}`)} · {formatDate(w.requestedAt)}
                {w.reason ? ` · ${w.reason}` : ''}
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(w.amountPoisha as MoneyPoisha)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
