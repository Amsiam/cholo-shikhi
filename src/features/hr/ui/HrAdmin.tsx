// A7/A8 HR records (US7.1, US7.10, US7.24; HR records only), for Finance or Admins with two-step
// sign-in: find an instructor, save a new pay-policy version (effective from the next cycle), keep
// an Employee's salary, joining and exit dates and leave balance, and record leave or absence.
// A Contractor has no salary or leave fields. Amounts are typed in taka and stored as poisha.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { BadgeCheck, CalendarOff, Contact, FileSignature } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { type MoneyPoisha, parseTakaString } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InstructorHr } from '../server/hr.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };
type Kind = 'revenue_share' | 'salary' | 'per_piece' | 'hybrid';
const KINDS: readonly Kind[] = ['revenue_share', 'salary', 'per_piece', 'hybrid'];
const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

/** Taka text to poisha; blank is undefined, invalid is NaN (refused by the server). */
function poishaOf(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const r = parseTakaString(text.trim());
  return r.ok ? r.value : Number.NaN;
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'number';
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function Message(props: { message: { ok: boolean; key: string } | null }) {
  const { tDynamic } = useI18n();
  if (!props.message) return null;
  return (
    <p
      role={props.message.ok ? 'status' : 'alert'}
      className={`text-sm ${props.message.ok ? '' : 'text-destructive'}`}
    >
      {tDynamic(props.message.key)}
    </p>
  );
}

const outcomeMessage = (r: Outcome) =>
  r.ok ? { ok: true, key: 'hr.saved' } : { ok: false, key: r.error.i18nKey ?? 'errors.hr.invalid' };

function PolicyForm(props: { hr: InstructorHr; onSave: (v: unknown) => Promise<Outcome> }) {
  const { t, formatMoney, formatInteger, formatDateTime } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: { kind: 'revenue_share' as Kind, shareBps: '', salaryTaka: '', pieceTaka: '' },
    onSubmit: async ({ value }) => {
      const r = await props.onSave({
        instructorId: props.hr.instructorId,
        kind: value.kind,
        ...(value.shareBps.trim() ? { shareBps: Number(value.shareBps) } : {}),
        ...(value.salaryTaka.trim() ? { salaryPoisha: poishaOf(value.salaryTaka) } : {}),
        ...(value.pieceTaka.trim() ? { perPiecePoisha: poishaOf(value.pieceTaka) } : {}),
      });
      setMessage(outcomeMessage(r));
      if (r.ok) form.reset();
    },
  });
  const money = (v: number | null) => (v === null ? '' : formatMoney(v as MoneyPoisha));
  return (
    <section className={card} aria-labelledby="hr-policy">
      <h2 id="hr-policy" className="flex items-center gap-2 text-xl font-bold">
        <FileSignature aria-hidden="true" className="size-5 text-primary" />
        {t('hr.policy.title')}
      </h2>
      <p className="text-sm text-ink-muted">{t('hr.policy.note')}</p>
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
              <legend className="mb-1 text-sm font-medium">{t('hr.policy.kind')}</legend>
              {KINDS.map((k) => (
                <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="hr-kind"
                    className="size-4 accent-primary"
                    checked={f.state.value === k}
                    onChange={() => f.handleChange(k)}
                  />
                  {t(`hr.policy.kind.${k}`)}
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <div className="grid gap-4 sm:grid-cols-3">
              {kind === 'revenue_share' || kind === 'hybrid' ? (
                <form.Field name="shareBps">
                  {(f) => (
                    <Field
                      id="hr-share"
                      type="number"
                      label={t('hr.policy.share')}
                      value={f.state.value}
                      onChange={f.handleChange}
                    />
                  )}
                </form.Field>
              ) : null}
              {kind === 'salary' || kind === 'hybrid' ? (
                <form.Field name="salaryTaka">
                  {(f) => (
                    <Field
                      id="hr-salary"
                      label={t('hr.policy.salary')}
                      value={f.state.value}
                      onChange={f.handleChange}
                    />
                  )}
                </form.Field>
              ) : null}
              {kind === 'per_piece' ? (
                <form.Field name="pieceTaka">
                  {(f) => (
                    <Field
                      id="hr-piece"
                      label={t('hr.policy.piece')}
                      value={f.state.value}
                      onChange={f.handleChange}
                    />
                  )}
                </form.Field>
              ) : null}
            </div>
          )}
        </form.Subscribe>
        <Button type="submit" className="w-fit" data-testid="hr-policy-submit">
          {t('hr.policy.submit')}
        </Button>
      </form>
      <Message message={message} />
      {props.hr.policies.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('hr.policy.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-primary/10 text-sm" data-testid="hr-policies">
          {props.hr.policies.map((p) => (
            <li key={p.versionId} className="flex flex-col gap-0.5 py-2">
              <span className="font-semibold">
                {t('hr.policy.version', { n: formatInteger(p.version) })} ·{' '}
                {t(`hr.policy.kind.${p.kind}`)}
                {p.isInEffect ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-primary">
                    <BadgeCheck aria-hidden="true" className="size-4" />
                    {t('hr.policy.inEffect')}
                  </span>
                ) : null}
              </span>
              <span>
                {[
                  p.shareBps === null
                    ? null
                    : t('hr.policy.shareValue', { bps: formatInteger(p.shareBps) }),
                  p.salaryPoisha === null
                    ? null
                    : t('hr.policy.salaryValue', { amount: money(p.salaryPoisha) }),
                  p.perPiecePoisha === null
                    ? null
                    : t('hr.policy.pieceValue', { amount: money(p.perPiecePoisha) }),
                ]
                  .filter(Boolean)
                  .join(' + ')}
              </span>
              <span className="text-ink-muted">
                {t('hr.policy.from', { at: formatDateTime(p.effectiveFrom) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecordForm(props: { hr: InstructorHr; onSave: (v: unknown) => Promise<Outcome> }) {
  const { t, formatMoney, formatInteger } = useI18n();
  const r = props.hr.record;
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: {
      salaryTaka: '',
      joinedOn: r?.joinedOn ?? '',
      exitOn: r?.exitOn ?? '',
      leaveBalanceDays: String(r?.leaveBalanceDays ?? 0),
    },
    onSubmit: async ({ value }) => {
      const res = await props.onSave({
        instructorId: props.hr.instructorId,
        ...(value.salaryTaka.trim() ? { salaryPoisha: poishaOf(value.salaryTaka) } : {}),
        joinedOn: value.joinedOn || null,
        exitOn: value.exitOn || null,
        leaveBalanceDays: Number(value.leaveBalanceDays),
      });
      setMessage(outcomeMessage(res));
    },
  });
  if (!r)
    return (
      <section className={card} aria-labelledby="hr-record">
        <h2 id="hr-record" className="text-xl font-bold">
          {t('hr.record.title')}
        </h2>
        <p className="text-sm" data-testid="hr-contractor">
          {t('hr.record.contractor')}
        </p>
      </section>
    );
  return (
    <section className={card} aria-labelledby="hr-record">
      <h2 id="hr-record" className="flex items-center gap-2 text-xl font-bold">
        <Contact aria-hidden="true" className="size-5 text-primary" />
        {t('hr.record.title')}
      </h2>
      <p className="text-sm">
        {r.salaryPoisha === null
          ? t('hr.record.noSalary')
          : t('hr.record.salary', { amount: formatMoney(r.salaryPoisha as MoneyPoisha) })}{' '}
        · {t('hr.record.balance', { n: formatInteger(r.leaveBalanceDays) })}
      </p>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="salaryTaka">
            {(f) => (
              <Field
                id="hr-rec-salary"
                label={t('hr.record.salaryField')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="leaveBalanceDays">
            {(f) => (
              <Field
                id="hr-rec-balance"
                type="number"
                label={t('hr.record.balanceField')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="joinedOn">
            {(f) => (
              <Field
                id="hr-rec-joined"
                type="date"
                label={t('hr.record.joined')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="exitOn">
            {(f) => (
              <Field
                id="hr-rec-exit"
                type="date"
                label={t('hr.record.exit')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
        </div>
        <Button type="submit" className="w-fit" data-testid="hr-record-submit">
          {t('hr.record.submit')}
        </Button>
      </form>
      <Message message={message} />
    </section>
  );
}

function LeaveForm(props: { hr: InstructorHr; onSave: (v: unknown) => Promise<Outcome> }) {
  const { t, formatInteger } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: { kind: 'leave' as 'leave' | 'absence', startsOn: '', endsOn: '', note: '' },
    onSubmit: async ({ value }) => {
      const r = await props.onSave({
        instructorId: props.hr.instructorId,
        kind: value.kind,
        startsOn: value.startsOn,
        endsOn: value.endsOn,
        ...(value.note.trim() ? { note: value.note } : {}),
      });
      setMessage(outcomeMessage(r));
      if (r.ok) form.reset();
    },
  });
  if (!props.hr.record) return null;
  return (
    <section className={card} aria-labelledby="hr-leave">
      <h2 id="hr-leave" className="flex items-center gap-2 text-xl font-bold">
        <CalendarOff aria-hidden="true" className="size-5 text-primary" />
        {t('hr.leave.title')}
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
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">{t('hr.leave.kind')}</legend>
              {(['leave', 'absence'] as const).map((k) => (
                <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="hr-leave-kind"
                    className="size-4 accent-primary"
                    checked={f.state.value === k}
                    onChange={() => f.handleChange(k)}
                  />
                  {t(`hr.leave.kind.${k}`)}
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <form.Field name="startsOn">
            {(f) => (
              <Field
                id="hr-leave-start"
                type="date"
                label={t('hr.leave.start')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="endsOn">
            {(f) => (
              <Field
                id="hr-leave-end"
                type="date"
                label={t('hr.leave.end')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="note">
            {(f) => (
              <Field
                id="hr-leave-note"
                label={t('hr.leave.note')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
        </div>
        <Button type="submit" className="w-fit" data-testid="hr-leave-submit">
          {t('hr.leave.submit')}
        </Button>
      </form>
      <Message message={message} />
      {props.hr.leave.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('hr.leave.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" data-testid="hr-leave-list">
          {props.hr.leave.map((l) => (
            <li key={l.entryId}>
              {l.startsOn} – {l.endsOn} · {t(`hr.leave.kind.${l.kind}`)} ·{' '}
              {t('hr.leave.days', { n: formatInteger(l.days) })}
              {l.isWithoutLeave ? (
                <span className="ml-2 font-semibold text-destructive">
                  {t('hr.leave.withoutLeave')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HrAdmin(props: {
  instructors: Array<{ instructorId: string; name: string }>;
  selected: InstructorHr | null;
  onFind: (text: string) => Promise<Outcome>;
  onSavePolicy: (v: unknown) => Promise<Outcome>;
  onSaveRecord: (v: unknown) => Promise<Outcome>;
  onRecordLeave: (v: unknown) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const find = useForm({
    defaultValues: { instructor: '' },
    onSubmit: async ({ value }) => {
      const r = await props.onFind(value.instructor);
      setMessage(r.ok ? null : { ok: false, key: r.error.i18nKey ?? 'errors.hr.noInstructor' });
    },
  });
  const hr = props.selected;
  return (
    <div className="flex flex-col gap-6" data-testid="hr-admin">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Contact aria-hidden="true" className="size-7 text-primary" />
          {t('hr.title')}
        </h1>
        <p className="text-ink/75">{t('hr.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="hr-find">
        <h2 id="hr-find" className="text-lg font-bold">
          {t('hr.find.title')}
        </h2>
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void find.handleSubmit();
          }}
        >
          <find.Field name="instructor">
            {(f) => (
              <div className="grid min-w-64 flex-1 gap-1.5">
                <Label htmlFor="hr-find-input">{t('hr.find.label')}</Label>
                <Input
                  id="hr-find-input"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              </div>
            )}
          </find.Field>
          <Button type="submit" variant="outline">
            {t('hr.find.submit')}
          </Button>
        </form>
        <Message message={message} />
        {props.instructors.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('hr.find.none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {props.instructors.map((i) => (
              <li key={i.instructorId}>
                <Link
                  to="/admin/hr"
                  search={{ instructor: i.instructorId }}
                  className="underline underline-offset-4"
                >
                  {i.name || i.instructorId}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {hr ? (
        <>
          <p className="text-lg font-semibold" data-testid="hr-selected">
            {hr.name} · {t(`hr.type.${hr.instructorType}`)}
          </p>
          <PolicyForm key={`p-${hr.instructorId}`} hr={hr} onSave={props.onSavePolicy} />
          <RecordForm key={`r-${hr.instructorId}`} hr={hr} onSave={props.onSaveRecord} />
          <LeaveForm key={`l-${hr.instructorId}`} hr={hr} onSave={props.onRecordLeave} />
        </>
      ) : null}
    </div>
  );
}
