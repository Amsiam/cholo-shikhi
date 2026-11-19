// A11 Copyright takedowns (US9.7): log a notice against a published course, section or lesson; then
// honour (hides it), reject, or reverse an honoured one (restores it), always with a reason.
// States are text with an icon.
import { useForm } from '@tanstack/react-form';
import { CircleAlert, CircleCheck, CircleSlash, FileWarning, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TakedownTargets, TakedownView } from '../server/takedown.server.ts';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };
type Content = { type: 'course' | 'section' | 'lesson'; id: string; label: string };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';
const textarea =
  'min-h-20 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

function LogNotice(props: {
  onTargets: (course: string) => Promise<Outcome<TakedownTargets>>;
  onLog: (input: Record<string, string>) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [targets, setTargets] = useState<TakedownTargets | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const pick = (bn: string | null, en: string | null) =>
    (locale === 'bn' ? bn : en) || bn || en || '';
  const find = useForm({
    defaultValues: { course: '' },
    onSubmit: async ({ value }) => {
      setMessage(null);
      setContent(null);
      const r = await props.onTargets(value.course);
      if (r.ok && r.value) setTargets(r.value);
      else setMessage({ ok: false, key: (!r.ok && r.error.i18nKey) || 'errors.takedown.noCourse' });
    },
  });
  const details = useForm({
    defaultValues: { claimant: '', claimantContact: '', claim: '', evidence: '' },
    onSubmit: async ({ value }) => {
      if (!targets || !content) return;
      const r = await props.onLog({
        courseId: targets.courseId,
        contentType: content.type,
        contentId: content.id,
        ...value,
      });
      setMessage(
        r.ok
          ? { ok: true, key: 'takedown.logged' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.takedown.invalid' },
      );
      if (r.ok) {
        setTargets(null);
        setContent(null);
        details.reset();
      }
    },
  });
  const options: Content[] = targets
    ? [
        {
          type: 'course',
          id: targets.courseId,
          label: `${t('takedown.whole')} · ${pick(targets.titleBn, targets.titleEn)}`,
        },
        ...targets.sections.flatMap((s) => [
          {
            type: 'section' as const,
            id: s.sectionId,
            label: `${t('takedown.section')} · ${pick(s.titleBn, s.titleEn)}`,
          },
          ...s.lessons.map((l) => ({
            type: 'lesson' as const,
            id: l.lessonId,
            label: `${t('takedown.lesson')} · ${pick(l.titleBn, l.titleEn)}`,
          })),
        ]),
      ]
    : [];
  const field = (name: 'claimant' | 'claimantContact' | 'claim' | 'evidence', long = false) => (
    <details.Field name={name}>
      {(f) => (
        <div className="grid gap-1.5">
          <Label htmlFor={`td-${name}`}>{t(`takedown.field.${name}`)}</Label>
          {long ? (
            <textarea
              id={`td-${name}`}
              className={textarea}
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value)}
            />
          ) : (
            <Input
              id={`td-${name}`}
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value)}
            />
          )}
        </div>
      )}
    </details.Field>
  );
  return (
    <section className={card} aria-labelledby="td-log" data-testid="takedown-log">
      <h2 id="td-log" className="flex items-center gap-2 text-xl font-bold">
        <FileWarning aria-hidden="true" className="size-5 text-primary" />
        {t('takedown.log.title')}
      </h2>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void find.handleSubmit();
        }}
      >
        <find.Field name="course">
          {(f) => (
            <div className="grid min-w-64 flex-1 gap-1.5">
              <Label htmlFor="td-course">{t('takedown.log.course')}</Label>
              <Input
                id="td-course"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </div>
          )}
        </find.Field>
        <Button type="submit" variant="outline">
          {t('takedown.log.load')}
        </Button>
      </form>
      {targets ? (
        <form
          noValidate
          className="grid gap-4 border-t border-primary/10 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void details.handleSubmit();
          }}
        >
          <fieldset className="grid max-h-64 gap-1 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium">{t('takedown.log.content')}</legend>
            {options.map((o) => (
              <label
                key={`${o.type}-${o.id}`}
                className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="td-content"
                  className="size-4 accent-primary"
                  checked={content?.id === o.id && content.type === o.type}
                  onChange={() => setContent(o)}
                />
                {o.label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('claimant')}
            {field('claimantContact')}
          </div>
          {field('claim', true)}
          {field('evidence', true)}
          <Button type="submit" className="w-fit" disabled={!content} data-testid="takedown-submit">
            {t('takedown.log.submit')}
          </Button>
        </form>
      ) : null}
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

function NoticeRow(props: {
  notice: TakedownView;
  onDecide: (
    noticeId: string,
    action: 'honour' | 'reject' | 'reverse',
    reason: string,
  ) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatDateTime } = useI18n();
  const n = props.notice;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (action: 'honour' | 'reject' | 'reverse') => {
    setBusy(true);
    setError(null);
    const r = await props.onDecide(n.noticeId, action, reason);
    setBusy(false);
    if (!r.ok) setError(r.error.i18nKey ?? 'errors.takedown.invalid');
  };
  const Icon =
    n.state === 'honoured'
      ? CircleCheck
      : n.state === 'rejected'
        ? CircleSlash
        : n.state === 'reversed'
          ? RotateCcw
          : CircleAlert;
  const actions =
    n.state === 'open'
      ? (['honour', 'reject'] as const)
      : n.state === 'honoured'
        ? (['reverse'] as const)
        : [];
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="takedown-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Icon aria-hidden="true" className="size-4 text-primary" />
          {t(`takedown.state.${n.state}`)} ·{' '}
          {t(`takedown.${n.contentType === 'course' ? 'whole' : n.contentType}`)}
        </span>
        <span className="text-xs text-ink-muted">{formatDateTime(n.loggedAt)}</span>
      </div>
      <p className="text-sm">
        <span className="font-semibold">{n.claimant}</span> ({n.claimantContact})
      </p>
      <p className="text-sm whitespace-pre-line">{n.claim}</p>
      <p className="text-xs whitespace-pre-line text-ink-muted">{n.evidence}</p>
      {n.decisionReason ? (
        <p className="text-sm">{t('takedown.decision', { reason: n.decisionReason })}</p>
      ) : null}
      {n.reversalReason ? (
        <p className="text-sm">{t('takedown.reversal', { reason: n.reversalReason })}</p>
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`td-reason-${n.noticeId}`}>{t('takedown.reason')}</Label>
          <textarea
            id={`td-reason-${n.noticeId}`}
            className={textarea}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button
                key={a}
                variant={a === 'honour' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void decide(a)}
                data-testid={`takedown-${a}`}
              >
                {t(`takedown.action.${a}`)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </li>
  );
}

export function TakedownsAdmin(props: {
  notices: TakedownView[];
  onTargets: (course: string) => Promise<Outcome<TakedownTargets>>;
  onLog: (input: Record<string, string>) => Promise<Outcome>;
  onDecide: (
    noticeId: string,
    action: 'honour' | 'reject' | 'reverse',
    reason: string,
  ) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="takedowns">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('takedown.title')}
        </h1>
        <p className="text-ink/75">{t('takedown.subtitle')}</p>
      </header>
      <LogNotice onTargets={props.onTargets} onLog={props.onLog} />
      <section className={card} aria-labelledby="td-list">
        <h2 id="td-list" className="text-xl font-bold">
          {t('takedown.list')}
        </h2>
        {props.notices.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('takedown.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.notices.map((n) => (
              <NoticeRow key={n.noticeId} notice={n} onDecide={props.onDecide} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
