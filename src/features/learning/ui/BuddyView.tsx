// S12 Me → Study buddy (US5.12–US5.14): invite a friend with a code, accept a friend's code, see
// who studied today, and end the pair. Statuses are text with an icon, never colour alone.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleDashed, Copy, HeartHandshake, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MyBuddy } from '../server/buddy.server.ts';

type Outcome<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

const card = 'flex flex-col gap-3 border border-primary/15 bg-background p-5';

function TodayRow(props: { label: string; done: boolean }) {
  const { t } = useI18n();
  const Icon = props.done ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-center gap-2">
      <Icon
        aria-hidden="true"
        className={`size-5 ${props.done ? 'text-pass' : 'text-ink-muted'}`}
      />
      <span className="font-semibold">{props.label}</span>
      <span className="text-ink/80">
        {props.done ? t('buddy.today.studied') : t('buddy.today.notYet')}
      </span>
    </li>
  );
}

export function BuddyView(props: {
  data: MyBuddy;
  onInvite: () => Promise<Outcome>;
  onCancelInvite: () => Promise<Outcome>;
  onPreview: (code: string) => Promise<Outcome<{ inviterName: string }>>;
  onAccept: (code: string) => Promise<Outcome>;
  onEnd: () => Promise<Outcome>;
}) {
  const { t, tDynamic, formatInteger, formatDate, formatDateTime } = useI18n();
  const d = props.data;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ code: string; inviterName: string } | null>(null);
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const dayLabel = (day: string) => formatDate(`${day}T06:00:00Z`);

  const run = async (fn: () => Promise<Outcome>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error.i18nKey);
    return r;
  };
  const codeForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      const r = (await run(() => props.onPreview(value.code))) as Outcome<{ inviterName: string }>;
      if (r.ok && r.value) setPreview({ code: value.code, inviterName: r.value.inviterName });
    },
  });

  const bonusNote = t('buddy.bonus', {
    base: formatInteger(d.dailyTokens),
    buddy: formatInteger(d.buddyDayTokens),
  });

  let body: React.ReactNode;
  if (d.pair) {
    const p = d.pair;
    const isBuddyDay = p.today.me && p.today.buddy;
    let endControl: React.ReactNode;
    if (p.endsDay) {
      endControl = (
        <p role="status" className="text-sm font-semibold" data-testid="buddy-ending">
          {t('buddy.pair.ending', { date: dayLabel(p.endsDay) })}
        </p>
      );
    } else if (isConfirmingEnd) {
      endControl = (
        <div className="flex flex-col gap-2 border-t border-primary/10 pt-3">
          <p className="text-sm">{t('buddy.end.confirm')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-omr text-omr"
              disabled={busy}
              onClick={() => void run(props.onEnd)}
              data-testid="buddy-end-confirm"
            >
              {t('buddy.end.yes')}
            </Button>
            <Button variant="outline" onClick={() => setIsConfirmingEnd(false)}>
              {t('buddy.end.no')}
            </Button>
          </div>
        </div>
      );
    } else {
      endControl = (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => setIsConfirmingEnd(true)}
          data-testid="buddy-end"
        >
          {t('buddy.end.button')}
        </Button>
      );
    }
    body = (
      <section className={card} aria-labelledby="buddy-pair" data-testid="buddy-pair">
        <h2 id="buddy-pair" className="flex items-center gap-2 text-xl font-bold">
          <HeartHandshake aria-hidden="true" className="size-5 text-primary" />
          {t('buddy.pair.title', { name: p.buddyName })}
        </h2>
        <p className="text-sm text-ink/80">
          {t('buddy.pair.since', { date: dayLabel(p.sinceDay) })}
        </p>
        <ul className="flex flex-col gap-2 text-sm" aria-label={t('buddy.today.title')}>
          <TodayRow label={t('buddy.today.you')} done={p.today.me} />
          <TodayRow label={p.buddyName} done={p.today.buddy} />
        </ul>
        <p className="border-l-2 border-primary/30 pl-3 text-sm">
          {isBuddyDay ? t('buddy.today.bonusEarned') : bonusNote}
        </p>
        {endControl}
      </section>
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-labelledby="buddy-invite" data-testid="buddy-invite">
          <h2 id="buddy-invite" className="flex items-center gap-2 text-xl font-bold">
            <UserPlus aria-hidden="true" className="size-5 text-primary" />
            {t('buddy.invite.title')}
          </h2>
          <p className="text-sm text-ink/80">{t('buddy.invite.body')}</p>
          {d.invite ? (
            <div className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-3">
                <span
                  className="border-2 border-dashed border-primary px-3 py-1 font-mono text-2xl font-bold tracking-[0.3em]"
                  data-testid="buddy-code"
                >
                  {d.invite.code}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(d.invite?.code ?? '').then(() => {
                      setIsCopied(true);
                    });
                  }}
                >
                  <Copy aria-hidden="true" className="size-4" />
                  {isCopied ? t('buddy.invite.copied') : t('buddy.invite.copy')}
                </Button>
              </p>
              <p className="text-xs text-ink-muted">
                {t('buddy.invite.expires', { date: formatDateTime(d.invite.expiresAt) })}
              </p>
              <Button
                variant="ghost"
                className="w-fit"
                disabled={busy}
                onClick={() => void run(props.onCancelInvite)}
              >
                {t('buddy.invite.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              className="w-fit"
              disabled={busy || !d.hasGoal}
              onClick={() => void run(props.onInvite)}
              data-testid="buddy-invite-create"
            >
              {t('buddy.invite.create')}
            </Button>
          )}
        </section>

        <section className={card} aria-labelledby="buddy-join" data-testid="buddy-join">
          <h2 id="buddy-join" className="flex items-center gap-2 text-xl font-bold">
            <HeartHandshake aria-hidden="true" className="size-5 text-primary" />
            {t('buddy.join.title')}
          </h2>
          {preview ? (
            <div className="flex flex-col gap-3">
              <p>{t('buddy.join.confirm', { name: preview.inviterName })}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void run(() => props.onAccept(preview.code))}
                  data-testid="buddy-accept"
                >
                  {t('buddy.join.accept')}
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)}>
                  {t('buddy.end.no')}
                </Button>
              </div>
            </div>
          ) : (
            <form
              noValidate
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void codeForm.handleSubmit();
              }}
            >
              <codeForm.Field name="code">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="buddy-code-input">{t('buddy.join.code')}</Label>
                    <Input
                      id="buddy-code-input"
                      className="w-40 font-mono uppercase tracking-widest"
                      autoComplete="off"
                      maxLength={12}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </codeForm.Field>
              <Button type="submit" variant="outline" disabled={busy || !d.hasGoal}>
                {t('buddy.join.check')}
              </Button>
            </form>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="buddy-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <HeartHandshake aria-hidden="true" className="size-8 text-primary" />
          {t('buddy.title')}
        </h1>
        <p className="text-ink/75">{t('buddy.subtitle')}</p>
      </header>
      {!d.hasGoal ? (
        <p className="border border-primary/15 bg-background p-4">
          {t('errors.buddy.noGoal')}{' '}
          <Link to="/me/goal" className="tap-target font-semibold text-primary hover:underline">
            {t('practice.chooseGoal')}
          </Link>
        </p>
      ) : null}
      {d.ended ? (
        <p
          role="status"
          className="border border-primary/15 bg-background p-4"
          data-testid="buddy-ended"
        >
          {t('buddy.ended', { name: d.ended.buddyName, date: dayLabel(d.ended.lastDay) })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      {body}
      {d.pair ? null : <p className="text-sm text-ink/80">{bonusNote}</p>}
    </div>
  );
}
