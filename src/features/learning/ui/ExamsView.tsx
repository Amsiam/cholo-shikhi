// Exams for the Student: live exams (upcoming, open now, ended), mock tests, and their own practice
// exams, plus a form to make a practice exam from chosen topics.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  Radio,
  Sparkles,
  Timer,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { StudentExamCard } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import type { PracticeCatalog } from '../server/practice.server.ts';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

function negativeLabelKey(bps: number) {
  if (bps === 0) return 'exams.negative.none' as const;
  if (bps === 2500) return 'exams.negative.quarter' as const;
  if (bps === 5000) return 'exams.negative.half' as const;
  return 'exams.negative.some' as const;
}

export function ExamCard(props: { exam: StudentExamCard }) {
  const { t, locale, formatInteger, formatDateTime, formatMarks } = useI18n();
  const e = props.exam;
  const last = e.attempts.find((a) => a.isSubmitted);
  const isOpenLive = e.liveState === 'open';
  return (
    <li
      className={`flex flex-col gap-3 border bg-background p-5 ${isOpenLive ? 'border-2 border-primary' : 'border-primary/15'}`}
      data-testid="exam-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-lg font-bold break-words">
          {pick(e.titleBn, e.titleEn, locale)}
        </h3>
        {e.liveState ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isOpenLive
                ? 'bg-primary text-primary-foreground'
                : e.liveState === 'upcoming'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-ink/10 text-ink'
            }`}
          >
            {isOpenLive ? <Radio aria-hidden="true" className="size-3.5" /> : null}
            {t(`exams.live.${e.liveState}`)}
          </span>
        ) : null}
      </div>
      {e.courseId ? (
        <p className="text-sm font-semibold text-primary">
          {pick(e.courseTitleBn, e.courseTitleEn, locale)}
        </p>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
        <span>{t('exams.questions', { n: formatInteger(e.questionCount) })}</span>
        <span className="inline-flex items-center gap-1">
          <Timer aria-hidden="true" className="size-4" />
          {t('exams.minutes', { n: formatInteger(e.durationMinutes) })}
        </span>
        <span>{t(negativeLabelKey(e.negativeBps))}</span>
      </p>
      {e.startsAt && e.endsAt ? (
        <p className="inline-flex items-center gap-1.5 text-sm">
          <CalendarClock aria-hidden="true" className="size-4 text-primary" />
          {t('exams.window', { start: formatDateTime(e.startsAt), end: formatDateTime(e.endsAt) })}
        </p>
      ) : null}
      {last ? (
        <p className="text-sm">
          {last.scoreX100 === null
            ? t('exams.awaitingResult')
            : t('exams.lastScore', {
                score: formatMarks(last.scoreX100),
                max: formatMarks(last.maxX100 ?? 0),
              })}{' '}
          <Link
            to="/exams/result/$attemptId"
            params={{ attemptId: last.attemptId }}
            className="tap-target font-semibold text-primary hover:underline"
          >
            {t('exams.viewResult')}
          </Link>
        </p>
      ) : null}
      {e.canStart ? (
        <Button
          asChild
          className="w-fit"
          variant={isOpenLive || e.openAttemptId ? 'default' : 'outline'}
        >
          <Link
            to="/exams/$examId"
            params={{ examId: e.examId }}
            preload={false}
            data-testid="exam-start"
          >
            {t(
              e.openAttemptId
                ? 'exams.resume'
                : e.attempts.length > 0
                  ? 'exams.retake'
                  : 'exams.start',
            )}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

function Section(props: {
  id: string;
  title: string;
  icon: ReactNode;
  exams: StudentExamCard[];
  empty: string;
}) {
  return (
    <section aria-labelledby={props.id} className="flex flex-col gap-3">
      <h2 id={props.id} className="flex items-center gap-2 text-xl font-bold">
        {props.icon}
        {props.title}
      </h2>
      {props.exams.length === 0 ? (
        <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
          {props.empty}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {props.exams.map((e) => (
            <ExamCard key={e.examId} exam={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CustomExamForm(props: {
  catalog: PracticeCatalog;
  onCreate: (input: {
    topicIds: string[];
    count: number;
    durationMinutes: number;
    negativeBps: 0 | 2500 | 5000;
  }) => Promise<Outcome<{ examId: string }>>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      topicIds: [] as string[],
      count: 25,
      durationMinutes: 20,
      negativeBps: 0 as 0 | 2500 | 5000,
    },
    onSubmit: async ({ value }) => {
      if (value.topicIds.length === 0) {
        setError('errors.exam.pickTopics');
        return;
      }
      setError(null);
      const r = await props.onCreate(value);
      if (!r.ok) setError(r.error.i18nKey);
    },
  });
  const chip = (isOn: boolean) =>
    `flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
      isOn
        ? 'border-primary bg-primary/10 font-semibold text-primary'
        : 'border-primary/25 hover:border-primary/50'
    }`;
  return (
    <form
      noValidate
      className="flex flex-col gap-5 border border-primary/15 bg-background p-5"
      data-testid="custom-exam-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="topicIds">
        {(field) => (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">{t('exams.custom.topics')}</legend>
            {props.catalog.subjects.map((s) => (
              <div key={s.subjectId} className="flex flex-col gap-2">
                <span className="text-xs font-bold text-ink-muted">
                  {pick(s.nameBn, s.nameEn, locale)}
                </span>
                <div className="flex flex-wrap gap-2">
                  {s.topics
                    .filter((tp) => tp.questionCount > 0)
                    .map((tp) => {
                      const isOn = field.state.value.includes(tp.topicId);
                      return (
                        <label key={tp.topicId} className={chip(isOn)}>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={isOn}
                            onChange={() =>
                              field.handleChange(
                                isOn
                                  ? field.state.value.filter((x) => x !== tp.topicId)
                                  : [...field.state.value, tp.topicId],
                              )
                            }
                            data-testid="custom-exam-topic"
                          />
                          {pick(tp.nameBn, tp.nameEn, locale)}
                          <span className="text-xs text-ink-muted tabular-nums">
                            {formatInteger(tp.questionCount)}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </fieldset>
        )}
      </form.Field>
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['count', 'exams.custom.count', [10, 25, 50, 100]],
            ['durationMinutes', 'exams.custom.minutes', [10, 20, 30, 60]],
          ] as const
        ).map(([name, label, values]) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">{t(label)}</legend>
                <div className="flex flex-wrap gap-2">
                  {values.map((v) => (
                    <label key={v} className={chip(field.state.value === v)}>
                      <input
                        type="radio"
                        className="sr-only"
                        name={`custom-${name}`}
                        checked={field.state.value === v}
                        onChange={() => field.handleChange(v)}
                      />
                      {formatInteger(v)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </form.Field>
        ))}
        <form.Field name="negativeBps">
          {(field) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">{t('exams.custom.negative')}</legend>
              <div className="flex flex-wrap gap-2">
                {([0, 2500, 5000] as const).map((v) => (
                  <label key={v} className={chip(field.state.value === v)}>
                    <input
                      type="radio"
                      className="sr-only"
                      name="custom-negative"
                      checked={field.state.value === v}
                      onChange={() => field.handleChange(v)}
                    />
                    {t(`exams.custom.negative.${v}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </form.Field>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <Button type="submit" className="w-fit" data-testid="custom-exam-create">
        {t('exams.custom.create')}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </form>
  );
}

export function ExamsView(props: {
  exams: StudentExamCard[];
  hasGoal: boolean;
  catalog: PracticeCatalog;
  onCreateCustom: (input: {
    topicIds: string[];
    count: number;
    durationMinutes: number;
    negativeBps: 0 | 2500 | 5000;
  }) => Promise<Outcome<{ examId: string }>>;
}) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const fromCourses = props.exams.filter((e) => e.courseId !== null);
  const live = props.exams.filter((e) => e.kind === 'live' && e.courseId === null);
  const order = { open: 0, upcoming: 1, ended: 2 } as const;
  live.sort((a, b) => order[a.liveState ?? 'ended'] - order[b.liveState ?? 'ended']);
  const mock = props.exams.filter((e) => e.kind === 'mock' && e.courseId === null);
  const custom = props.exams.filter((e) => e.kind === 'custom');
  const hasTopics = props.catalog.subjects.some((s) => s.topics.some((tp) => tp.questionCount > 0));

  return (
    <div className="flex flex-col gap-8" data-testid="exams-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <ClipboardList aria-hidden="true" className="size-8 text-primary" />
          {t('exams.title')}
        </h1>
        <p className="text-ink/75">{t('exams.subtitle')}</p>
      </header>
      {!props.hasGoal ? (
        <p className="border border-primary/15 bg-background p-4">
          {t('practice.noGoal')}{' '}
          <Link to="/me/goal" className="tap-target font-semibold text-primary hover:underline">
            {t('practice.chooseGoal')}
          </Link>
        </p>
      ) : null}
      <Section
        id="exams-live"
        title={t('exams.section.live')}
        icon={<Radio aria-hidden="true" className="size-5 text-primary" />}
        exams={live}
        empty={t('exams.empty.live')}
      />
      {fromCourses.length > 0 ? (
        <Section
          id="exams-courses"
          title={t('exams.section.courses')}
          icon={<GraduationCap aria-hidden="true" className="size-5 text-primary" />}
          exams={fromCourses}
          empty=""
        />
      ) : null}
      <Section
        id="exams-mock"
        title={t('exams.section.mock')}
        icon={<ClipboardList aria-hidden="true" className="size-5 text-primary" />}
        exams={mock}
        empty={t('exams.empty.mock')}
      />
      <section aria-labelledby="exams-custom" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="exams-custom" className="flex items-center gap-2 text-xl font-bold">
            <Sparkles aria-hidden="true" className="size-5 text-primary" />
            {t('exams.section.custom')}
          </h2>
          {hasTopics && !showForm ? (
            <Button
              variant="outline"
              onClick={() => setShowForm(true)}
              data-testid="custom-exam-open"
            >
              {t('exams.custom.new')}
            </Button>
          ) : null}
        </div>
        {showForm ? (
          <CustomExamForm catalog={props.catalog} onCreate={props.onCreateCustom} />
        ) : null}
        {custom.length === 0 ? (
          <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
            {t('exams.empty.custom')}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {custom.map((e) => (
              <ExamCard key={e.examId} exam={e} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
