// X1 TwoStepScreen: enrolment (manual key in groups of 4, BR5.5) with recovery codes shown once, or
// a challenge with a recovery-code alternative (BR5.3, BR5.7).
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { FormField } from './FormField.tsx';

type Call<I, O> = (input: {
  data: I;
}) => Promise<{ ok: true; value: O } | { ok: false; error: { i18nKey: string } }>;

export type TwoStepActions = {
  startEnrolment: Call<Record<string, never>, { setupKeyGroups: string[]; otpauthUri: string }>;
  confirmEnrolment: Call<{ code: string }, { recoveryCodes: string[] }>;
  verifyCode: Call<{ code: string }, unknown>;
  redeemRecoveryCode: Call<{ code: string }, unknown>;
};

export function TwoStepPanel(props: {
  state: string;
  actions: TwoStepActions;
  onDone: () => void | Promise<void>;
}) {
  const { t, tDynamic } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[] | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [isRecovery, setIsRecovery] = useState(false);

  if (recoveryCodes) {
    return (
      <section className="grid gap-4" data-testid="two-step-recovery-codes">
        <p>{t('twoStep.recoveryCodes.title')}</p>
        <ul className="grid grid-cols-2 gap-2 font-mono">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button size="lg" onClick={() => props.onDone()} data-testid="two-step-recovery-saved">
          {t('twoStep.recoveryCodes.saved')}
        </Button>
      </section>
    );
  }

  if (props.state === 'pending_enrolment') {
    return (
      <section className="grid gap-4" data-testid="two-step-enrol">
        <p>{t('twoStep.enrol.intro')}</p>
        {groups ? (
          <>
            <p>{t('twoStep.enrol.manualKey')}</p>
            <p className="font-mono text-lg tracking-widest" data-testid="two-step-setup-key">
              {groups.join(' ')}
            </p>
            <FormField
              id="two-step-code"
              label={t('twoStep.code')}
              testId="two-step-code"
              error={error ? tDynamic(error) : undefined}
              inputProps={{
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                value: code,
                onChange: (e) => setCode(e.target.value),
              }}
            />
            <Button
              size="lg"
              data-testid="two-step-confirm"
              onClick={async () => {
                const r = await props.actions.confirmEnrolment({ data: { code } });
                if (r.ok) setRecoveryCodes(r.value.recoveryCodes);
                else setError(r.error.i18nKey);
              }}
            >
              {t('twoStep.enrol.confirm')}
            </Button>
          </>
        ) : (
          <Button
            size="lg"
            data-testid="two-step-start"
            onClick={async () => {
              const r = await props.actions.startEnrolment({ data: {} });
              if (r.ok) setGroups(r.value.setupKeyGroups);
              else setError(r.error.i18nKey);
            }}
          >
            {t('twoStep.enrol.start')}
          </Button>
        )}
      </section>
    );
  }

  if (props.state === 'pending_challenge') {
    return (
      <section className="grid gap-4" data-testid="two-step-challenge">
        <p>{t('twoStep.challenge.intro')}</p>
        <FormField
          id="two-step-challenge-code"
          label={isRecovery ? t('twoStep.recovery.label') : t('twoStep.code')}
          testId="two-step-challenge-code"
          error={error ? tDynamic(error) : undefined}
          inputProps={{
            inputMode: isRecovery ? 'text' : 'numeric',
            autoComplete: 'one-time-code',
            value: code,
            onChange: (e) => setCode(e.target.value),
          }}
        />
        <Button
          size="lg"
          data-testid="two-step-verify"
          onClick={async () => {
            const r = isRecovery
              ? await props.actions.redeemRecoveryCode({ data: { code } })
              : await props.actions.verifyCode({ data: { code } });
            if (r.ok) await props.onDone();
            else setError(r.error.i18nKey);
          }}
        >
          {isRecovery ? t('twoStep.recovery.submit') : t('twoStep.challenge.submit')}
        </Button>
        <Button
          variant="link"
          data-testid="two-step-recovery-toggle"
          onClick={() => setIsRecovery(!isRecovery)}
        >
          {t('twoStep.recovery.toggle')}
        </Button>
      </section>
    );
  }

  return <p data-testid="two-step-not-pending">{t('twoStep.notPending')}</p>;
}
