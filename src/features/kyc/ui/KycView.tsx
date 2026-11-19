// I6 Payout details (US7.19, US7.20): the instructor's KYC (legal name, NID number, NID photos taken
// with the phone camera) and payout account (bKash, Nagad or bank). Usable on a 360 px phone.
// Numbers are shown masked; statuses are text with an icon.
import { useForm } from '@tanstack/react-form';
import { CircleAlert, CircleCheck, Clock3, IdCard, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MyKyc } from '../server/kyc.server.ts';
import { shrinkPhoto } from './shrink-photo.ts';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function StatusLine(props: { tone: 'ok' | 'wait' | 'bad'; text: string; testId: string }) {
  const Icon = props.tone === 'ok' ? CircleCheck : props.tone === 'wait' ? Clock3 : CircleAlert;
  const color =
    props.tone === 'ok' ? 'text-pass' : props.tone === 'wait' ? 'text-primary' : 'text-omr';
  return (
    <p className="flex items-start gap-2 text-sm font-semibold" data-testid={props.testId}>
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${color}`} />
      {props.text}
    </p>
  );
}

function FieldMessage(props: { id: string; error?: string | undefined }) {
  const { tDynamic } = useI18n();
  return props.error ? (
    <p id={props.id} role="alert" className="text-sm text-destructive">
      {tDynamic(props.error)}
    </p>
  ) : null;
}

function KycForm(props: { onSubmit: (input: Record<string, string>) => Promise<Outcome> }) {
  const { t, tDynamic } = useI18n();
  const [photos, setPhotos] = useState<{ front?: string; back?: string }>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pick = async (side: 'front' | 'back', file: File | undefined) => {
    setPhotoError(null);
    if (!file) return;
    try {
      const base64 = await shrinkPhoto(file);
      setPhotos((p) => ({ ...p, [side]: base64 }));
    } catch {
      setPhotoError('errors.kyc.photo.unsupported');
    }
  };
  const form = useForm({
    defaultValues: { legalName: '', nidNumber: '' },
    onSubmit: async ({ value }) => {
      setErrors({});
      setFormError(null);
      if (!photos.front || !photos.back) {
        setPhotoError('errors.kyc.photo.missing');
        return;
      }
      const r = await props.onSubmit({ ...value, front: photos.front, back: photos.back });
      if (!r.ok) {
        const fe = r.error.fieldErrors ?? {};
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
        if (!r.error.fieldErrors) setFormError(r.error.i18nKey);
      }
    },
  });
  const photoField = (side: 'front' | 'back') => (
    <div className="grid gap-1.5">
      <Label htmlFor={`kyc-${side}`}>{t(`kyc.form.${side}`)}</Label>
      <Input
        id={`kyc-${side}`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={(e) => void pick(side, e.target.files?.[0])}
        data-testid={`kyc-${side}`}
      />
      {photos[side] ? (
        <span className="flex items-center gap-1.5 text-xs text-pass">
          <CircleCheck aria-hidden="true" className="size-3.5" />
          {t('kyc.form.photoReady')}
        </span>
      ) : null}
      <FieldMessage id={`kyc-${side}-error`} error={errors[side]} />
    </div>
  );
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="kyc-form"
    >
      <form.Field name="legalName">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor="kyc-name">{t('kyc.form.legalName')}</Label>
            <Input
              id="kyc-name"
              autoComplete="name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <FieldMessage id="kyc-name-error" error={errors.legalName} />
          </div>
        )}
      </form.Field>
      <form.Field name="nidNumber">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor="kyc-nid">{t('kyc.form.nid')}</Label>
            <Input
              id="kyc-nid"
              inputMode="numeric"
              autoComplete="off"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <FieldMessage id="kyc-nid-error" error={errors.nidNumber} />
          </div>
        )}
      </form.Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {photoField('front')}
        {photoField('back')}
      </div>
      <p className="text-xs text-ink-muted">{t('kyc.form.privacy')}</p>
      {photoError ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(photoError)}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(formError)}
        </p>
      ) : null}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-fit" disabled={isSubmitting} data-testid="kyc-submit">
            {t('kyc.form.submit')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function AccountForm(props: { onSave: (input: Record<string, string>) => Promise<Outcome> }) {
  const { t, tDynamic } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const form = useForm({
    defaultValues: {
      rail: 'bkash' as 'bkash' | 'nagad' | 'bank',
      accountName: '',
      accountNumber: '',
      bankName: '',
      branchName: '',
      routingNumber: '',
    },
    onSubmit: async ({ value }) => {
      setErrors({});
      setFormError(null);
      setIsSaved(false);
      const isBank = value.rail === 'bank';
      const r = await props.onSave({
        rail: value.rail,
        accountName: value.accountName,
        accountNumber: value.accountNumber,
        ...(isBank && value.bankName ? { bankName: value.bankName } : {}),
        ...(isBank && value.branchName ? { branchName: value.branchName } : {}),
        ...(isBank && value.routingNumber ? { routingNumber: value.routingNumber } : {}),
      });
      if (r.ok) setIsSaved(true);
      else {
        const fe = r.error.fieldErrors ?? {};
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
        if (!r.error.fieldErrors) setFormError(r.error.i18nKey);
      }
    },
  });
  const text = (
    name: 'accountName' | 'accountNumber' | 'bankName' | 'branchName' | 'routingNumber',
    numeric = false,
  ) => (
    <form.Field name={name}>
      {(field) => (
        <div className="grid gap-1.5">
          <Label htmlFor={`acct-${name}`}>{t(`kyc.account.${name}`)}</Label>
          <Input
            id={`acct-${name}`}
            inputMode={numeric ? 'numeric' : 'text'}
            autoComplete="off"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <FieldMessage id={`acct-${name}-error`} error={errors[name]} />
        </div>
      )}
    </form.Field>
  );
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="account-form"
    >
      <form.Field name="rail">
        {(field) => (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-sm font-medium">{t('kyc.account.rail')}</legend>
            {(['bkash', 'nagad', 'bank'] as const).map((rail) => (
              <label
                key={rail}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm ${field.state.value === rail ? 'border-primary bg-primary/5 font-semibold' : 'border-primary/20'}`}
              >
                <input
                  type="radio"
                  name="rail"
                  className="size-4 accent-primary"
                  checked={field.state.value === rail}
                  onChange={() => field.handleChange(rail)}
                />
                {t(`kyc.rail.${rail}`)}
              </label>
            ))}
          </fieldset>
        )}
      </form.Field>
      {text('accountName')}
      {text('accountNumber', true)}
      <form.Subscribe selector={(s) => s.values.rail}>
        {(rail) =>
          rail === 'bank' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {text('bankName')}
              {text('branchName')}
              {text('routingNumber', true)}
            </div>
          ) : null
        }
      </form.Subscribe>
      <p className="text-xs text-ink-muted">{t('kyc.account.note')}</p>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(formError)}
        </p>
      ) : null}
      {isSaved ? (
        <p role="status" className="text-sm font-semibold text-pass">
          {t('kyc.account.saved')}
        </p>
      ) : null}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type="submit"
            className="w-fit"
            disabled={isSubmitting}
            data-testid="account-save"
          >
            {t('kyc.account.save')}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

export function KycView(props: {
  data: MyKyc;
  onSubmitKyc: (input: Record<string, string>) => Promise<Outcome>;
  onSaveAccount: (input: Record<string, string>) => Promise<Outcome>;
}) {
  const { t, formatDate } = useI18n();
  const { kyc, account, status } = props.data;
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const canSubmitKyc = !kyc || kyc.status === 'rejected';

  let kycStatus: React.ReactNode = null;
  if (kyc?.status === 'submitted')
    kycStatus = (
      <StatusLine
        tone="wait"
        testId="kyc-status"
        text={t('kyc.status.submitted', { date: formatDate(kyc.submittedAt) })}
      />
    );
  else if (kyc?.status === 'verified')
    kycStatus = <StatusLine tone="ok" testId="kyc-status" text={t('kyc.status.verified')} />;
  else if (kyc?.status === 'rejected')
    kycStatus = (
      <StatusLine
        tone="bad"
        testId="kyc-status"
        text={t('kyc.status.rejected', { reason: kyc.reason ?? '' })}
      />
    );

  let accountBody: React.ReactNode;
  if (kyc?.status !== 'verified') {
    accountBody = <p className="text-sm text-ink-muted">{t('kyc.account.needsKyc')}</p>;
  } else if (account && !isEditingAccount) {
    const tone =
      account.status === 'verified' ? 'ok' : account.status === 'pending' ? 'wait' : 'bad';
    accountBody = (
      <div className="flex flex-col gap-3" data-testid="account-current">
        <p className="text-sm">
          <span className="font-semibold">{t(`kyc.rail.${account.rail}`)}</span>
          {' · '}
          <span className="tabular-nums">{account.accountMasked}</span>
          {' · '}
          {account.accountName}
          {account.bankName ? ` · ${account.bankName}` : ''}
        </p>
        <StatusLine
          tone={tone}
          testId="account-status"
          text={t(`kyc.accountStatus.${account.status}`, { reason: account.reason ?? '' })}
        />
        <Button variant="outline" className="w-fit" onClick={() => setIsEditingAccount(true)}>
          {t('kyc.account.change')}
        </Button>
      </div>
    );
  } else {
    accountBody = (
      <AccountForm
        onSave={async (input) => {
          const r = await props.onSaveAccount(input);
          if (r.ok) setIsEditingAccount(false);
          return r;
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="kyc-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('kyc.title')}</h1>
        <p className="text-ink/75">{t('kyc.subtitle')}</p>
      </header>
      <StatusLine
        tone={status === 'verified' ? 'ok' : status === 'rejected' ? 'bad' : 'wait'}
        testId="kyc-overall"
        text={t(`kyc.overall.${status}`)}
      />
      <section className={card} aria-labelledby="kyc-identity">
        <h2 id="kyc-identity" className="flex items-center gap-2 text-xl font-bold">
          <IdCard aria-hidden="true" className="size-5 text-primary" />
          {t('kyc.identity.title')}
        </h2>
        {kyc ? (
          <p className="text-sm">
            {kyc.legalName} · {t('kyc.identity.nid', { nid: kyc.nidMasked })}
          </p>
        ) : null}
        {kycStatus}
        {canSubmitKyc ? <KycForm onSubmit={props.onSubmitKyc} /> : null}
      </section>
      <section className={card} aria-labelledby="kyc-account">
        <h2 id="kyc-account" className="flex items-center gap-2 text-xl font-bold">
          <Wallet aria-hidden="true" className="size-5 text-primary" />
          {t('kyc.account.title')}
        </h2>
        {accountBody}
      </section>
    </div>
  );
}
