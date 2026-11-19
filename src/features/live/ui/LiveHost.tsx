// Staff side of live classes: the list with a schedule form, and the control room (attendance,
// fire a pop-quiz, per-question heatmap). The control room refreshes itself.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { CalendarPlus, Shield, Users, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import { TopicSelect } from '#src/features/assessment/ui/QuestionEditor.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { LiveClassCard, LiveControl } from '../server/live.server.ts';
import { LiveStateBadge } from './LiveRoom.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };
const LETTERS = ['A', 'B', 'C', 'D'] as const;
/** A URL shape, not text to translate. */
const LIVE_URL_EXAMPLE = 'https://youtube.com/live/…';
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

/** US6.3: who attended, when they joined and were last seen, and their visible-tab time. */
function AttendanceTable(props: { attendees: LiveControl['attendees'] }) {
  const { t, locale, formatInteger, formatDateTime } = useI18n();
  const percent = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  return (
    <section
      aria-labelledby="live-attendance"
      className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      data-testid="live-attendance"
    >
      <h2 id="live-attendance" className="flex items-center gap-2 text-lg font-bold">
        <Users aria-hidden="true" className="size-5 text-primary" />
        {t('live.host.attendance')}
      </h2>
      {props.attendees.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('live.host.attendanceEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-primary/15 text-ink/70">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t('live.host.col.student')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('live.host.col.joined')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('live.host.col.lastSeen')}
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  {t('live.host.col.active')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {props.attendees.map((a) => (
                <tr key={`${a.name}-${a.firstJoinAt}`} data-testid="live-attendee">
                  <th scope="row" className="py-2 pr-3 font-semibold break-words">
                    {a.name}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{formatDateTime(a.firstJoinAt)}</td>
                  <td className="px-3 py-2">
                    <span className="tabular-nums">{formatDateTime(a.lastSeenAt)}</span>
                    <span
                      className={`block text-xs font-semibold ${a.isPresent ? 'text-pass' : 'text-ink-muted'}`}
                    >
                      {a.isPresent ? t('live.host.here') : t('live.host.left')}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {t('live.host.activeMinutes', { n: formatInteger(a.activeMinutes) })}
                    <span className="block text-xs text-ink-muted">
                      {t('live.host.activeShare', { share: percent.format(a.activeBps / 10_000) })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LiveHostView(props: {
  classes: LiveClassCard[];
  courses: Array<{ courseId: string; titleBn: string; titleEn: string }>;
  onSchedule: (input: {
    courseId: string;
    titleBn: string;
    titleEn: string;
    youtubeUrl: string;
    startsAtLocal: string;
    durationMinutes: number;
    keepsRecording: boolean;
  }) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatDateTime } = useI18n();
  const [errors, setErrors] = useState<Record<string, readonly string[]>>({});
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const err = (k: string) => errors[k]?.map((x) => tDynamic(x)).join(' ');
  const form = useForm({
    defaultValues: {
      courseId: props.courses[0]?.courseId ?? '',
      titleBn: '',
      titleEn: '',
      youtubeUrl: '',
      startsAtLocal: '',
      durationMinutes: 60,
      keepsRecording: true,
    },
    onSubmit: async ({ value, formApi }) => {
      if (!value.startsAtLocal) return setErrors({ startsAtLocal: ['errors.exam.startRequired'] });
      const r = await props.onSchedule(value);
      if (!r.ok) {
        setErrors(r.error.fieldErrors ?? {});
        setMessage(r.error.fieldErrors ? null : { ok: false, key: r.error.i18nKey });
        return;
      }
      setErrors({});
      setMessage({ ok: true, key: 'live.host.scheduled' });
      formApi.reset();
    },
  });
  const field = (id: string, label: string, input: React.ReactNode, error?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-6" data-testid="live-host-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('live.host.title')}
        </h1>
        <p className="text-ink/75">{t('live.host.subtitle')}</p>
      </header>
      {props.courses.length === 0 ? (
        <p className="border border-primary/15 bg-background p-4 text-sm">
          {t('live.host.noCourses')}
        </p>
      ) : (
        <form
          noValidate
          className="grid gap-4 border border-primary/15 bg-background p-5 sm:grid-cols-2 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <h2 className="flex items-center gap-2 text-lg font-bold sm:col-span-2">
            <CalendarPlus aria-hidden="true" className="size-5 text-primary" />
            {t('live.host.new')}
          </h2>
          <form.Field name="courseId">
            {(f) =>
              field(
                'live-course',
                t('live.host.course'),
                <NativeSelect
                  id="live-course"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                >
                  {props.courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {pick(c.titleBn, c.titleEn, locale)}
                    </option>
                  ))}
                </NativeSelect>,
                err('courseId'),
              )
            }
          </form.Field>
          <form.Field name="youtubeUrl">
            {(f) =>
              field(
                'live-url',
                t('live.host.youtube'),
                <Input
                  id="live-url"
                  inputMode="url"
                  placeholder={LIVE_URL_EXAMPLE}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />,
                err('youtubeUrl'),
              )
            }
          </form.Field>
          <form.Field name="titleBn">
            {(f) =>
              field(
                'live-tbn',
                t('examBuilder.titleBn'),
                <Input
                  id="live-tbn"
                  lang="bn"
                  maxLength={150}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />,
                err('titleBn'),
              )
            }
          </form.Field>
          <form.Field name="titleEn">
            {(f) =>
              field(
                'live-ten',
                t('examBuilder.titleEn'),
                <Input
                  id="live-ten"
                  maxLength={150}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />,
                err('titleEn'),
              )
            }
          </form.Field>
          <form.Field name="startsAtLocal">
            {(f) =>
              field(
                'live-start',
                t('examBuilder.startsAt'),
                <Input
                  id="live-start"
                  type="datetime-local"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />,
                err('startsAtLocal'),
              )
            }
          </form.Field>
          <form.Field name="durationMinutes">
            {(f) =>
              field(
                'live-duration',
                t('examBuilder.duration'),
                <Input
                  id="live-duration"
                  type="number"
                  min={10}
                  max={300}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(Number(e.target.value))}
                />,
                err('durationMinutes'),
              )
            }
          </form.Field>
          <form.Field name="keepsRecording">
            {(f) => (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={f.state.value}
                  onChange={(e) => f.handleChange(e.target.checked)}
                />
                {t('live.host.keepRecording')}
              </label>
            )}
          </form.Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" data-testid="live-schedule">
              {t('battle.host.schedule')}
            </Button>
            {message ? (
              <p
                role={message.ok ? 'status' : 'alert'}
                className={`text-sm font-semibold ${message.ok ? 'text-pass' : 'text-destructive'}`}
              >
                {tDynamic(message.key)}
              </p>
            ) : null}
          </div>
        </form>
      )}
      <ul className="flex flex-col gap-3">
        {props.classes.length === 0 ? (
          <li className="text-sm text-ink-muted">{t('live.none')}</li>
        ) : (
          props.classes.map((c) => (
            <li
              key={c.liveClassId}
              className="flex flex-wrap items-center justify-between gap-3 border border-primary/15 bg-background p-4"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{pick(c.titleBn, c.titleEn, locale)}</span>
                  {c.isCancelled ? (
                    <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-semibold">
                      {t('live.cancelled')}
                    </span>
                  ) : (
                    <LiveStateBadge state={c.state} />
                  )}
                </span>
                <span className="text-sm text-ink-muted">
                  {pick(c.courseTitleBn, c.courseTitleEn, locale)} · {formatDateTime(c.startsAt)}
                </span>
              </span>
              <Link
                to="/live-host/$liveClassId"
                params={{ liveClassId: c.liveClassId }}
                className="tap-target font-semibold text-primary hover:underline"
                data-testid="live-control-open"
              >
                {t('live.host.control')}
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function LiveControlView(props: {
  initial: LiveControl;
  taxonomy: TaxonomySubject[];
  onRefresh: () => Promise<LiveControl | null>;
  onFire: (input: { topicId?: string; count: number }) => Promise<Outcome>;
  onCancel: () => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [data, setData] = useState(props.initial);
  const [topicId, setTopicId] = useState('');
  const [count, setCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const next = await props.onRefresh();
    if (next) setData(next);
  }, [props.onRefresh]);
  useEffect(() => {
    if (data.liveClass.state === 'ended') return;
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [data.liveClass.state, refresh]);
  const c = data.liveClass;
  const canFire = (c.state === 'open' || c.state === 'live') && !c.isCancelled;
  return (
    <div className="flex flex-col gap-6" data-testid="live-control">
      <Link to="/live-host" className="tap-target font-medium text-primary hover:underline">
        {t('live.host.back')}
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold sm:text-3xl">
          {pick(c.titleBn, c.titleEn, locale)}
        </h1>
        <LiveStateBadge state={c.state} />
      </header>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ['live.host.joined', data.joined],
          ['live.host.present', data.presentNow],
          ['live.host.avgMinutes', data.averageActiveMinutes],
        ].map(([k, v]) => (
          <div
            key={k as string}
            className="flex flex-col gap-1 border border-primary/15 bg-background p-4"
          >
            <dt className="flex items-center gap-1.5 text-sm text-ink-muted">
              <Users aria-hidden="true" className="size-4" />
              {t(k as 'live.host.joined')}
            </dt>
            <dd className="text-2xl font-extrabold tabular-nums">{formatInteger(v as number)}</dd>
          </div>
        ))}
      </dl>
      <AttendanceTable attendees={data.attendees} />
      <section
        aria-labelledby="live-fire"
        className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      >
        <h2 id="live-fire" className="flex items-center gap-2 text-lg font-bold">
          <Zap aria-hidden="true" className="size-5 text-omr" />
          {t('live.host.fire')}
        </h2>
        <p className="text-sm text-ink/80">{t('live.host.fireNote')}</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_8rem_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="fire-topic">{t('bank.field.topic')}</Label>
            <TopicSelect
              id="fire-topic"
              taxonomy={props.taxonomy}
              value={topicId}
              onChange={setTopicId}
              emptyLabel={t('battle.anyTopic')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fire-count">{t('exams.custom.count')}</Label>
            <NativeSelect
              id="fire-count"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {formatInteger(n)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            disabled={!canFire}
            onClick={async () => {
              const r = await props.onFire({ ...(topicId ? { topicId } : {}), count });
              setError(r.ok ? null : r.error.i18nKey);
              await refresh();
            }}
            data-testid="live-fire-go"
          >
            {t('live.host.fireGo')}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
      </section>
      {[...data.quizzes].reverse().map((q, n) => (
        <section
          key={q.quizId}
          className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
          data-testid="live-heatmap"
        >
          <h2 className="text-lg font-bold">
            {t('live.host.quizN', { n: formatInteger(data.quizzes.length - n) })}
            {q.phase === 'running' && q.currentIndex !== null
              ? ` · ${t('live.quiz.question', { n: formatInteger(q.currentIndex + 1), total: formatInteger(q.questions.length) })}`
              : ''}
          </h2>
          {q.phase === 'over' ? (
            <p className="flex items-center gap-2 text-sm" data-testid="live-shield-winners">
              <Shield aria-hidden="true" className="size-4 text-primary" />
              {t('live.host.shieldWinners', { n: formatInteger(q.shieldWinners) })}
            </p>
          ) : null}
          <ol className="flex flex-col gap-3">
            {q.questions.map((question, i) => {
              const row = q.heatmap[i];
              return (
                <li key={question.questionId} className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">
                    {formatInteger(i + 1)}. {pick(question.promptBn, question.promptEn, locale)}
                  </span>
                  {row ? (
                    <>
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          aria-hidden="true"
                          className="h-2 w-40 overflow-hidden rounded-full bg-omr-soft"
                        >
                          <span
                            className="block h-full rounded-full bg-pass"
                            style={{ width: `${row.percent ?? 0}%` }}
                          />
                        </span>
                        {row.percent === null
                          ? t('live.host.noAnswers')
                          : t('live.host.percentRight', {
                              percent: formatInteger(row.percent),
                              n: formatInteger(row.answered),
                            })}
                      </span>
                      <span className="flex flex-wrap gap-2 text-xs">
                        {row.choices.map((n2, k) => (
                          <span
                            key={LETTERS[k]}
                            className={`rounded-sm px-2 py-0.5 tabular-nums ${k === question.correctIndex ? 'bg-pass/15 font-semibold text-pass' : 'bg-ink/5'}`}
                          >
                            {LETTERS[k]}: {formatInteger(n2)}
                          </span>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-ink-muted">{t('live.host.stillOpen')}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {!c.isCancelled && c.state !== 'ended' ? (
        <Button
          variant="outline"
          className="w-fit border-omr text-omr"
          onClick={async () => {
            await props.onCancel();
            await refresh();
          }}
        >
          {t('live.host.cancel')}
        </Button>
      ) : null}
    </div>
  );
}
