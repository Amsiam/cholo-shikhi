// A7 attribution queue (US7.13), Finance or Admins with two-step sign-in: open a case for a section
// two instructors claim (load the course from its link, pick the section and the claimants), then
// confirm one claimant as owner with a reason. An empty queue says "Nothing to review".
import { useForm } from '@tanstack/react-form';
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CaseCourse, CaseView } from '../server/attribution.server.ts';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };
const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function OpenCase(props: {
  onCourse: (course: string) => Promise<Outcome<CaseCourse>>;
  onOpen: (input: Record<string, unknown>) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [course, setCourse] = useState<CaseCourse | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [claimants, setClaimants] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const find = useForm({
    defaultValues: { course: '' },
    onSubmit: async ({ value }) => {
      setMessage(null);
      const r = await props.onCourse(value.course);
      if (r.ok && r.value) {
        setCourse(r.value);
        setSectionId(null);
        setClaimants([]);
      } else
        setMessage({ ok: false, key: (!r.ok && r.error.i18nKey) || 'errors.attribution.noCourse' });
    },
  });
  const details = useForm({
    defaultValues: { description: '' },
    onSubmit: async ({ value }) => {
      if (!course || !sectionId) return;
      const r = await props.onOpen({
        courseId: course.courseId,
        sectionId,
        claimantIds: claimants,
        description: value.description,
      });
      setMessage(
        r.ok
          ? { ok: true, key: 'attribution.opened' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.attribution.invalid' },
      );
      if (r.ok) {
        setCourse(null);
        details.reset();
      }
    },
  });
  return (
    <section className={card} aria-labelledby="at-open">
      <h2 id="at-open" className="text-xl font-bold">
        {t('attribution.open.title')}
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
              <Label htmlFor="at-course">{t('attribution.open.course')}</Label>
              <Input
                id="at-course"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />
            </div>
          )}
        </find.Field>
        <Button type="submit" variant="outline">
          {t('attribution.open.load')}
        </Button>
      </form>
      {course ? (
        <form
          noValidate
          className="grid gap-4 border-t border-primary/10 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void details.handleSubmit();
          }}
        >
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">{t('attribution.open.section')}</legend>
            {course.sections.map((s) => (
              <label key={s.sectionId} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="at-section"
                  className="size-4 accent-primary"
                  checked={sectionId === s.sectionId}
                  onChange={() => setSectionId(s.sectionId)}
                />
                {pick(s.titleBn, s.titleEn)}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">{t('attribution.open.claimants')}</legend>
            {course.instructors.map((i) => (
              <label key={i.instructorId} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={claimants.includes(i.instructorId)}
                  onChange={(e) =>
                    setClaimants(
                      e.target.checked
                        ? [...claimants, i.instructorId]
                        : claimants.filter((x) => x !== i.instructorId),
                    )
                  }
                />
                {i.displayName}
              </label>
            ))}
          </fieldset>
          <details.Field name="description">
            {(f) => (
              <div className="grid gap-1.5">
                <Label htmlFor="at-description">{t('attribution.open.description')}</Label>
                <Input
                  id="at-description"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              </div>
            )}
          </details.Field>
          <Button
            type="submit"
            className="w-fit"
            disabled={!sectionId || claimants.length === 0}
            data-testid="attribution-open-submit"
          >
            {t('attribution.open.submit')}
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

function CaseRowView(props: {
  row: CaseView;
  onResolve: (caseId: string, ownerId: string, reason: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatDateTime } = useI18n();
  const r = props.row;
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const resolve = async () => {
    setError(null);
    if (!ownerId) return;
    const res = await props.onResolve(r.caseId, ownerId, reason);
    if (!res.ok) setError(res.error.i18nKey ?? 'errors.attribution.invalid');
  };
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="attribution-case">
      <p className="font-semibold">
        {pick(r.courseTitleBn, r.courseTitleEn)} · {pick(r.sectionTitleBn, r.sectionTitleEn)}
      </p>
      <p className="text-sm">{r.description}</p>
      <p className="text-xs text-ink-muted">{formatDateTime(r.openedAt)}</p>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">{t('attribution.resolve.owner')}</legend>
        {r.claimants.map((c) => (
          <label key={c.instructorId} className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`at-owner-${r.caseId}`}
              className="size-4 accent-primary"
              checked={ownerId === c.instructorId}
              onChange={() => setOwnerId(c.instructorId)}
            />
            {c.name || c.instructorId}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor={`at-reason-${r.caseId}`}>{t('attribution.resolve.reason')}</Label>
          <Input
            id={`at-reason-${r.caseId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={!ownerId}
          onClick={() => void resolve()}
          data-testid="attribution-resolve"
        >
          {t('attribution.resolve.submit')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </li>
  );
}

export function AttributionQueue(props: {
  open: CaseView[];
  resolved: CaseView[];
  onCourse: (course: string) => Promise<Outcome<CaseCourse>>;
  onOpen: (input: Record<string, unknown>) => Promise<Outcome>;
  onResolve: (caseId: string, ownerId: string, reason: string) => Promise<Outcome>;
  /** Attribution money waiting for the payouts.payrollAndAttribution flag and the drafts' approval. */
  pendingReassignments: number;
  rules: { isOn: boolean; isApproved: boolean };
  onPostPending: () => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatMoney, formatInteger } = useI18n();
  const pick = (bn: string, en: string) => (locale === 'bn' ? bn : en) || bn || en;
  const [postError, setPostError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPost = props.rules.isOn && props.rules.isApproved;
  const postPending = async () => {
    setBusy(true);
    setPostError(null);
    const r = await props.onPostPending();
    setBusy(false);
    if (!r.ok) setPostError(r.error.i18nKey ?? 'errors.attribution.rulesOff');
  };
  return (
    <div className="flex flex-col gap-6" data-testid="attribution-queue">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Scale aria-hidden="true" className="size-7 text-primary" />
          {t('attribution.title')}
        </h1>
        <p className="text-ink/75">{t('attribution.subtitle')}</p>
      </header>
      <section className={card} aria-labelledby="at-queue">
        <h2 id="at-queue" className="text-lg font-bold">
          {t('attribution.queue')}
        </h2>
        {props.open.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('attribution.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10">
            {props.open.map((r) => (
              <CaseRowView key={r.caseId} row={r} onResolve={props.onResolve} />
            ))}
          </ul>
        )}
      </section>
      {props.pendingReassignments > 0 ? (
        <section
          className={card}
          aria-labelledby="at-pending"
          data-testid="attribution-pending-money"
        >
          <h2 id="at-pending" className="text-lg font-bold">
            {t('attribution.money.pendingTitle')}
          </h2>
          <p className="text-sm">
            {t('attribution.money.pending', { n: formatInteger(props.pendingReassignments) })}
          </p>
          {canPost ? (
            <Button
              className="self-start"
              disabled={busy}
              onClick={() => void postPending()}
              data-testid="attribution-post-pending"
            >
              {t('attribution.money.post')}
            </Button>
          ) : (
            <p className="text-sm text-ink-muted">{t('attribution.money.waiting')}</p>
          )}
          {postError ? (
            <p role="alert" className="text-sm text-destructive">
              {tDynamic(postError)}
            </p>
          ) : null}
        </section>
      ) : null}
      <OpenCase onCourse={props.onCourse} onOpen={props.onOpen} />
      {props.resolved.length > 0 ? (
        <section className={card} aria-labelledby="at-resolved">
          <h2 id="at-resolved" className="text-lg font-bold">
            {t('attribution.resolvedList')}
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {props.resolved.map((r) => (
              <li key={r.caseId}>
                {pick(r.sectionTitleBn, r.sectionTitleEn)} →{' '}
                {r.claimants.find((c) => c.instructorId === r.ownerId)?.name ?? r.ownerId} ·{' '}
                {r.reason}
                {r.reassignment && r.reassignment.movedPoisha > 0 ? (
                  <span className="block text-ink/75" data-testid="attribution-moved">
                    {t(
                      r.reassignment.isPosted
                        ? 'attribution.money.movedPosted'
                        : 'attribution.money.movedPending',
                      { amount: formatMoney(r.reassignment.movedPoisha as MoneyPoisha) },
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
