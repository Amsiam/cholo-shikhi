// A11 Payment disputes (US9.3, US9.4), for Finance or Admins with two-step sign-in: record a
// dispute against a payment (its evidence pack is generated and locked at once), open a pack to
// read every section with its lock timestamp, print it or save it as PDF from the browser, and
// export it through the shared renderer (CSV now; PDF once the renderer's PDF engine is installed).
import { useForm } from '@tanstack/react-form';
import { FileDown, Lock, Printer, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DisputePackView, DisputeView } from '../server/dispute.server.ts';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };
type ExportFile = { fileName: string; contentType: string; content: string };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function download(file: ExportFile) {
  const body =
    file.contentType === 'application/pdf'
      ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
      : file.content;
  const url = URL.createObjectURL(new Blob([body], { type: file.contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function RecordForm(props: { onRecord: (v: Record<string, string>) => Promise<Outcome> }) {
  const { t, tDynamic } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: { paymentId: '', gatewayCaseRef: '', reason: '' },
    onSubmit: async ({ value }) => {
      const r = await props.onRecord({
        paymentId: value.paymentId.trim().toLowerCase(),
        gatewayCaseRef: value.gatewayCaseRef,
        reason: value.reason,
      });
      setMessage(
        r.ok
          ? { ok: true, key: 'dispute.recorded' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.dispute.invalid' },
      );
      if (r.ok) form.reset();
    },
  });
  const field = (name: 'paymentId' | 'gatewayCaseRef' | 'reason') => (
    <form.Field name={name}>
      {(f) => (
        <div className="grid gap-1.5">
          <Label htmlFor={`dp-${name}`}>{t(`dispute.field.${name}`)}</Label>
          <Input
            id={`dp-${name}`}
            value={f.state.value}
            onChange={(e) => f.handleChange(e.target.value)}
          />
        </div>
      )}
    </form.Field>
  );
  return (
    <section className={`${card} print:hidden`} aria-labelledby="dp-record">
      <h2 id="dp-record" className="flex items-center gap-2 text-xl font-bold">
        <ShieldAlert aria-hidden="true" className="size-5 text-primary" />
        {t('dispute.record.title')}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field('paymentId')}
          {field('gatewayCaseRef')}
        </div>
        {field('reason')}
        <Button type="submit" className="w-fit" data-testid="dispute-submit">
          {t('dispute.record.submit')}
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

function PackView(props: {
  view: DisputePackView;
  onExport: (format: 'pdf' | 'csv') => Promise<Outcome<ExportFile>>;
}) {
  const { t, tDynamic, formatMoney, formatDateTime, formatInteger } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const { pack } = props.view;
  const run = async (format: 'pdf' | 'csv') => {
    setError(null);
    const r = await props.onExport(format);
    if (r.ok && r.value) download(r.value);
    else if (!r.ok) setError(r.error.i18nKey ?? 'errors.dispute.export');
  };
  const list = (items: Array<{ key: string; text: string }>) =>
    items.length === 0 ? (
      <p className="text-sm text-ink-muted">{t('dispute.pack.none')}</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((i) => (
          <li key={i.key}>{i.text}</li>
        ))}
      </ul>
    );
  return (
    <article className={card} aria-labelledby="dp-pack" data-testid="dispute-pack">
      <header className="flex flex-col gap-1">
        <h2 id="dp-pack" className="text-xl font-bold">
          {t('dispute.pack.title', { ref: props.view.gatewayCaseRef })}
        </h2>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Lock aria-hidden="true" className="size-4" />
          {t('dispute.pack.locked', { at: formatDateTime(props.view.lockedAt) })}
        </p>
      </header>
      <section className="grid gap-1 text-sm">
        <h3 className="font-semibold">{t('dispute.pack.payment')}</h3>
        <p>
          {pack.payment.paymentId} · {formatMoney(pack.payment.amountPoisha as MoneyPoisha)} ·{' '}
          {pack.payment.settledAt ? formatDateTime(pack.payment.settledAt) : ''}
        </p>
        <p>
          {t('dispute.pack.enrolment')}: {pack.enrolment?.enrolmentId ?? t('dispute.pack.none')}
        </p>
        <p>
          {t('dispute.pack.course')}: {pack.course.title}
        </p>
      </section>
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold">{t('dispute.pack.access')}</h3>
        {list(
          pack.accessLog.map((a) => ({
            key: `a-${a.lessonId}`,
            text: `${formatDateTime(a.at)} · ${a.title || a.lessonId}`,
          })),
        )}
      </section>
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold">{t('dispute.pack.videos')}</h3>
        {list(
          pack.videoViews.map((v) => ({
            key: `v-${v.lessonId}`,
            text: `${formatDateTime(v.at)} · ${v.title || v.lessonId}`,
          })),
        )}
      </section>
      <section className="grid gap-1">
        <h3 className="text-sm font-semibold">{t('dispute.pack.quizzes')}</h3>
        {list(
          pack.quizScores.map((q, i) => ({
            key: `q-${q.lessonId}-${i}`,
            text: `${formatDateTime(q.at)} · ${q.title || q.lessonId} · ${formatInteger(q.score)}/${formatInteger(q.total)}`,
          })),
        )}
      </section>
      <section className="grid gap-1 text-sm">
        <h3 className="font-semibold">{t('dispute.pack.summary')}</h3>
        <p data-testid="dispute-pack-summary">
          {pack.summary.hasActivity
            ? t('dispute.pack.activity', {
                lessons: formatInteger(pack.summary.lessonsCompleted),
                videos: formatInteger(pack.summary.videosWatched),
                quizzes: formatInteger(pack.summary.quizzesTaken),
              })
            : t('dispute.pack.noActivity')}
        </p>
      </section>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" className="size-4" />
          {t('dispute.pack.print')}
        </Button>
        <Button variant="outline" onClick={() => void run('pdf')} data-testid="dispute-export-pdf">
          <FileDown aria-hidden="true" className="size-4" />
          {t('dispute.pack.exportPdf')}
        </Button>
        <Button variant="outline" onClick={() => void run('csv')} data-testid="dispute-export-csv">
          <FileDown aria-hidden="true" className="size-4" />
          {t('dispute.pack.exportCsv')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive print:hidden">
          {tDynamic(error)}
        </p>
      ) : null}
    </article>
  );
}

export function DisputesAdmin(props: {
  disputes: DisputeView[];
  onRecord: (v: Record<string, string>) => Promise<Outcome>;
  onOpen: (disputeId: string) => Promise<Outcome<DisputePackView>>;
  onExport: (disputeId: string, format: 'pdf' | 'csv') => Promise<Outcome<ExportFile>>;
}) {
  const { t, tDynamic, formatDateTime } = useI18n();
  const [open, setOpen] = useState<DisputePackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = async (disputeId: string) => {
    setError(null);
    const r = await props.onOpen(disputeId);
    if (r.ok && r.value) setOpen(r.value);
    else if (!r.ok) setError(r.error.i18nKey ?? 'errors.dispute.noPack');
  };
  return (
    <div className="flex flex-col gap-6" data-testid="disputes-admin">
      <header className="flex flex-col gap-1 print:hidden">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <ShieldAlert aria-hidden="true" className="size-7 text-primary" />
          {t('dispute.title')}
        </h1>
        <p className="text-ink/75">{t('dispute.subtitle')}</p>
      </header>
      <RecordForm onRecord={props.onRecord} />
      <section className={`${card} print:hidden`} aria-labelledby="dp-list">
        <h2 id="dp-list" className="text-lg font-bold">
          {t('dispute.list')}
        </h2>
        {props.disputes.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('dispute.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.disputes.map((d) => (
              <li
                key={d.disputeId}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{d.gatewayCaseRef}</span>
                  <span className="text-ink-muted">
                    {d.paymentId} · {formatDateTime(d.recordedAt)}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void show(d.disputeId)}>
                  {t('dispute.open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
      </section>
      {open ? (
        <PackView view={open} onExport={(format) => props.onExport(open.disputeId, format)} />
      ) : null}
    </div>
  );
}
