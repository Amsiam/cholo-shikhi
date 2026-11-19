// S4 switch block (US2.17): on a course the Student does not own, offer to switch one of their paid
// courses for it. The refund policy is shown before the request is sent; a pending request is shown
// instead of a new form (AC2.17.2).
import { ArrowLeftRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import type { SwitchOptions, SwitchView } from '../server/switch.server.ts';

type Outcome =
  | { ok: true; value: { request: SwitchView; isExisting: boolean } }
  | { ok: false; error: { i18nKey?: string } };

export function SwitchBlock(props: {
  options: SwitchOptions;
  onRequest: (fromCourseId: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatDateTime } = useI18n();
  const [fromId, setFromId] = useState(props.options.from[0]?.courseId ?? '');
  const [hasRead, setHasRead] = useState(false);
  const [pending, setPending] = useState<SwitchView | null>(props.options.pending);
  const [notice, setNotice] = useState<string | null>(null);
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  if (!pending && props.options.from.length === 0) return null;
  if (pending)
    return (
      <section
        className="flex flex-col gap-2 border border-primary/20 bg-background p-5"
        aria-labelledby="switch-pending"
        data-testid="switch-pending"
      >
        <h2 id="switch-pending" className="flex items-center gap-2 text-lg font-bold">
          <Clock aria-hidden="true" className="size-5 text-primary" />
          {t('switch.pending.title')}
        </h2>
        <p className="text-sm">
          {t('switch.pending.body', {
            from: pick(pending.fromTitleBn, pending.fromTitleEn),
            to: pick(pending.toTitleBn, pending.toTitleEn),
            deadline: formatDateTime(pending.deadlineAt),
          })}
        </p>
        {notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {tDynamic(notice)}
          </p>
        ) : null}
      </section>
    );
  const send = async () => {
    const r = await props.onRequest(fromId);
    if (r.ok) {
      setPending(r.value.request);
      setNotice(r.value.isExisting ? 'switch.existing' : 'switch.sent');
    } else setNotice(r.error.i18nKey ?? 'errors.switch.generic');
  };
  return (
    <section
      className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
      aria-labelledby="switch-title"
      data-testid="switch-block"
    >
      <h2 id="switch-title" className="flex items-center gap-2 text-lg font-bold">
        <ArrowLeftRight aria-hidden="true" className="size-5 text-primary" />
        {t('switch.title')}
      </h2>
      <p className="text-sm text-ink/80">{t('switch.intro')}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t('switch.from')}</legend>
        {props.options.from.map((c) => (
          <label
            key={c.courseId}
            className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name="switch-from"
              className="size-4 accent-primary"
              checked={fromId === c.courseId}
              onChange={() => setFromId(c.courseId)}
            />
            {pick(c.titleBn, c.titleEn)}
          </label>
        ))}
      </fieldset>
      <div className="rounded-sm bg-ink/5 p-3 text-sm" data-testid="switch-policy">
        <p className="font-semibold">{t('switch.policy.title')}</p>
        <p>{t('switch.policy.body')}</p>
      </div>
      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={hasRead}
          onChange={(e) => setHasRead(e.target.checked)}
          data-testid="switch-read"
        />
        {t('switch.policy.read')}
      </label>
      <Button
        className="w-fit"
        disabled={!hasRead || !fromId}
        onClick={() => void send()}
        data-testid="switch-send"
      >
        {t('switch.send')}
      </Button>
      {notice ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(notice)}
        </p>
      ) : null}
    </section>
  );
}
