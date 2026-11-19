// Staff exam builder: the list of mock tests and live exams, and the editor. An exam is a set of
// rules ("20 questions from Sandhi, medium"); drawing picks published questions for each rule, and
// publishing freezes that set for every Student.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Dices, Plus, Radio, Send, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { TaxonomySubject } from '../server/bank.server.ts';
import type { StaffExamDetail, StaffExamView } from '../server/exam.server.ts';
import { DifficultyMark } from './bank-parts.tsx';
import { TopicSelect } from './QuestionEditor.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };
export type GoalGroup = {
  nameBn: string;
  nameEn: string;
  goals: Array<{ goalId: string; nameBn: string; nameEn: string }>;
};
type Difficulty = 'easy' | 'medium' | 'hard';
type Row = { topicId: string; difficulty: Difficulty | null; count: number };
export type ExamDraftInput = {
  examId?: string;
  expectedVersion?: number;
  kind: 'mock' | 'live';
  titleBn: string;
  titleEn: string;
  goalId: string;
  durationMinutes: number;
  negativeBps: number;
  startsAtLocal?: string;
  blueprint: Row[];
};

const STATUS_TONE = {
  draft: 'bg-ink/10 text-ink',
  published: 'bg-pass/15 text-pass',
  retired: 'bg-ink/5 text-ink-muted',
} as const;

export function ExamList(props: { exams: StaffExamView[]; goalName: (id: string) => string }) {
  const { t, locale, formatInteger, formatDateTime, formatMarks } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="exam-builder-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t('examBuilder.title')}
          </h1>
          <p className="text-ink/75">{t('examBuilder.subtitle')}</p>
        </div>
        <Button asChild>
          <Link
            to="/exam-builder/$examId"
            params={{ examId: 'new' }}
            data-testid="exam-builder-new"
          >
            <Plus aria-hidden="true" className="size-4" />
            {t('examBuilder.new')}
          </Link>
        </Button>
      </header>
      <DataTable
        testId="exam-builder-table"
        caption={t('examBuilder.title')}
        rows={props.exams}
        rowId={(e) => e.examId}
        emptyText={t('examBuilder.empty')}
        display={[
          {
            id: 'title',
            header: t('examBuilder.col.exam'),
            cell: (e) => (
              <Link
                to="/exam-builder/$examId"
                params={{ examId: e.examId }}
                className="tap-target flex flex-col items-start gap-0.5"
              >
                <span className="font-semibold text-primary hover:underline">
                  {locale === 'bn' ? e.titleBn : e.titleEn}
                </span>
                <span className="text-xs text-ink-muted">
                  {[
                    props.goalName(e.goalId),
                    locale === 'bn' ? e.courseTitleBn || e.courseTitleEn : e.courseTitleEn,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            ),
          },
          {
            id: 'kind',
            header: t('examBuilder.col.kind'),
            cell: (e) => (
              <span className="flex flex-col gap-0.5 text-sm">
                <span className="inline-flex items-center gap-1 font-semibold">
                  {e.kind === 'live' ? (
                    <Radio aria-hidden="true" className="size-3.5 text-primary" />
                  ) : null}
                  {t(`examBuilder.kind.${e.kind}`)}
                </span>
                {e.startsAt ? (
                  <span className="text-xs text-ink-muted">{formatDateTime(e.startsAt)}</span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'questions',
            header: t('examBuilder.col.questions'),
            isNumeric: true,
            cell: (e) => formatInteger(e.plannedCount),
          },
          {
            id: 'status',
            header: t('insights.col.status'),
            cell: (e) => (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[e.status]}`}
              >
                {t(`examBuilder.status.${e.status}`)}
              </span>
            ),
          },
          {
            id: 'attempts',
            header: t('examBuilder.col.attempts'),
            isNumeric: true,
            cell: (e) => (
              <span className="flex flex-col items-end text-sm">
                <span>{formatInteger(e.attempts)}</span>
                {e.averageX100 !== null ? (
                  <span className="text-xs text-ink-muted">
                    {t('examBuilder.average', { marks: formatMarks(Math.round(e.averageX100)) })}
                  </span>
                ) : null}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

const textField = (id: string, label: string, input: React.ReactNode, error?: string) => (
  <div className="grid gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    {input}
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div>
);

export function ExamEditor(props: {
  detail: StaffExamDetail | null;
  taxonomy: TaxonomySubject[];
  goals: GoalGroup[];
  onSave: (input: ExamDraftInput) => Promise<Outcome<StaffExamDetail>>;
  onDraw: (examId: string, expectedVersion: number) => Promise<Outcome<StaffExamDetail>>;
  onPublish: (examId: string, expectedVersion: number) => Promise<Outcome<StaffExamDetail>>;
  onRetire: (examId: string, expectedVersion: number) => Promise<Outcome<StaffExamDetail>>;
  onAttach: (
    examId: string,
    expectedVersion: number,
    courseId: string | null,
  ) => Promise<Outcome<StaffExamDetail>>;
  onCreated: (examId: string) => void;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const uid = useId();
  const [detail, setDetail] = useState<StaffExamDetail | null>(props.detail);
  const [errors, setErrors] = useState<Record<string, readonly string[]>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; key: string } | null>(null);
  const e = detail?.exam ?? null;
  const [courseId, setCourseId] = useState<string>(props.detail?.exam.courseId ?? '');
  const isEditable = e === null || e.canEdit;
  const name = (x: { nameBn: string; nameEn: string }) => (locale === 'bn' ? x.nameBn : x.nameEn);
  const err = (k: string) => {
    const keys = errors[k];
    return keys?.length ? keys.map((x) => tDynamic(x)).join(' ') : undefined;
  };

  const handle = (r: Outcome<StaffExamDetail>, okKey: string) => {
    if (!r.ok) {
      setErrors(r.error.fieldErrors ?? {});
      setMessage(r.error.fieldErrors ? null : { tone: 'error', key: r.error.i18nKey });
      return false;
    }
    setErrors({});
    setDetail(r.value);
    setMessage({ tone: 'ok', key: okKey });
    return true;
  };

  const form = useForm({
    defaultValues: {
      kind: (e?.kind ?? 'mock') as 'mock' | 'live',
      titleBn: e?.titleBn ?? '',
      titleEn: e?.titleEn ?? '',
      goalId: e?.goalId ?? '',
      durationMinutes: e?.durationMinutes ?? 60,
      negativeBps: e?.negativeBps ?? 5000,
      startsAtLocal: e?.startsAtLocal ?? '',
      blueprint: (e?.blueprint ?? [{ topicId: '', difficulty: null, count: 10 }]) as Row[],
    },
    onSubmit: async ({ value }) => {
      if (!value.goalId) {
        setErrors({ goalId: ['errors.exam.goalRequired'] });
        return;
      }
      if (value.blueprint.some((r) => !r.topicId)) {
        setErrors({ blueprint: ['errors.bank.topicRequired'] });
        return;
      }
      const r = await props.onSave({
        ...value,
        ...(value.kind === 'live'
          ? { startsAtLocal: value.startsAtLocal }
          : { startsAtLocal: undefined }),
        ...(e ? { examId: e.examId, expectedVersion: e.version } : {}),
      });
      if (handle(r, 'examBuilder.saved') && r.ok && !e) props.onCreated(r.value.exam.examId);
    },
  });

  const statusLine = e ? (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[e.status]}`}>
      {t(`examBuilder.status.${e.status}`)}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="exam-editor">
      <Link to="/exam-builder" className="tap-target font-medium text-primary hover:underline">
        {t('examBuilder.back')}
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">
          {e ? (locale === 'bn' ? e.titleBn : e.titleEn) : t('examBuilder.new')}
        </h1>
        {statusLine}
      </header>

      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(ev) => {
          ev.preventDefault();
          void form.handleSubmit();
        }}
      >
        <fieldset
          disabled={!isEditable}
          className="flex flex-col gap-6 border border-primary/15 bg-background p-5 sm:p-7"
        >
          <legend className="sr-only">{t('examBuilder.details')}</legend>
          <form.Field name="kind">
            {(field) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">{t('examBuilder.col.kind')}</legend>
                <div className="flex flex-wrap gap-2">
                  {(['mock', 'live'] as const).map((k) => (
                    <label
                      key={k}
                      className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-sm border px-4 py-2 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                        field.state.value === k
                          ? 'border-primary bg-primary/10'
                          : 'border-primary/25'
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`${uid}-kind`}
                        checked={field.state.value === k}
                        onChange={() => field.handleChange(k)}
                        data-testid={`exam-kind-${k}`}
                      />
                      <span className="font-semibold">{t(`examBuilder.kind.${k}`)}</span>
                      <span className="text-xs text-ink-muted">
                        {t(`examBuilder.kindHint.${k}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="titleBn">
              {(field) =>
                textField(
                  `${uid}-tbn`,
                  t('examBuilder.titleBn'),
                  <Input
                    id={`${uid}-tbn`}
                    lang="bn"
                    maxLength={150}
                    value={field.state.value}
                    onChange={(ev) => field.handleChange(ev.target.value)}
                    data-testid="exam-title-bn"
                  />,
                  err('titleBn'),
                )
              }
            </form.Field>
            <form.Field name="titleEn">
              {(field) =>
                textField(
                  `${uid}-ten`,
                  t('examBuilder.titleEn'),
                  <Input
                    id={`${uid}-ten`}
                    maxLength={150}
                    value={field.state.value}
                    onChange={(ev) => field.handleChange(ev.target.value)}
                    data-testid="exam-title-en"
                  />,
                  err('titleEn'),
                )
              }
            </form.Field>
            <form.Field name="goalId">
              {(field) =>
                textField(
                  `${uid}-goal`,
                  t('examBuilder.goal'),
                  <NativeSelect
                    id={`${uid}-goal`}
                    value={field.state.value}
                    onChange={(ev) => field.handleChange(ev.target.value)}
                    data-testid="exam-goal"
                  >
                    <option value="">{t('examBuilder.goalPick')}</option>
                    {props.goals.map((g) => (
                      <optgroup key={g.nameEn} label={name(g)}>
                        {g.goals.map((x) => (
                          <option key={x.goalId} value={x.goalId}>
                            {name(x)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </NativeSelect>,
                  err('goalId'),
                )
              }
            </form.Field>
            <form.Subscribe selector={(st) => st.values.kind}>
              {(kind) =>
                kind === 'live' ? (
                  <form.Field name="startsAtLocal">
                    {(field) =>
                      textField(
                        `${uid}-start`,
                        t('examBuilder.startsAt'),
                        <Input
                          id={`${uid}-start`}
                          type="datetime-local"
                          value={field.state.value}
                          onChange={(ev) => field.handleChange(ev.target.value)}
                          data-testid="exam-starts"
                        />,
                        err('startsAtLocal'),
                      )
                    }
                  </form.Field>
                ) : (
                  <span />
                )
              }
            </form.Subscribe>
            <form.Field name="durationMinutes">
              {(field) =>
                textField(
                  `${uid}-dur`,
                  t('examBuilder.duration'),
                  <Input
                    id={`${uid}-dur`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={300}
                    value={field.state.value}
                    onChange={(ev) => field.handleChange(Number(ev.target.value))}
                    data-testid="exam-duration"
                  />,
                  err('durationMinutes'),
                )
              }
            </form.Field>
            <form.Field name="negativeBps">
              {(field) =>
                textField(
                  `${uid}-neg`,
                  t('examBuilder.negative'),
                  <NativeSelect
                    id={`${uid}-neg`}
                    value={field.state.value}
                    onChange={(ev) => field.handleChange(Number(ev.target.value))}
                  >
                    <option value={0}>{t('exams.custom.negative.0')}</option>
                    <option value={2500}>{t('exams.custom.negative.2500')}</option>
                    <option value={5000}>{t('exams.custom.negative.5000')}</option>
                  </NativeSelect>,
                )
              }
            </form.Field>
          </div>

          <form.Field name="blueprint" mode="array">
            {(field) => (
              <fieldset className="flex flex-col gap-3">
                <legend className="text-base font-bold">{t('examBuilder.rules')}</legend>
                <p className="text-sm text-ink-muted">{t('examBuilder.rulesHint')}</p>
                {field.state.value.map((row, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
                    key={i}
                    className="grid items-end gap-3 border-l-2 border-primary/30 pl-3 sm:grid-cols-[2fr_1fr_6rem_auto]"
                    data-testid="exam-rule"
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-r${i}-topic`}>{t('bank.field.topic')}</Label>
                      <TopicSelect
                        id={`${uid}-r${i}-topic`}
                        taxonomy={props.taxonomy}
                        value={row.topicId}
                        onChange={(v) => field.replaceValue(i, { ...row, topicId: v })}
                        emptyLabel={t('bank.field.topicPick')}
                        testId="exam-rule-topic"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-r${i}-diff`}>{t('bank.filter.measured')}</Label>
                      <NativeSelect
                        id={`${uid}-r${i}-diff`}
                        value={row.difficulty ?? ''}
                        onChange={(ev) =>
                          field.replaceValue(i, {
                            ...row,
                            difficulty: (ev.target.value || null) as Difficulty | null,
                          })
                        }
                      >
                        <option value="">{t('practice.anyDifficulty')}</option>
                        <option value="easy">{t('bank.difficulty.easy')}</option>
                        <option value="medium">{t('bank.difficulty.medium')}</option>
                        <option value="hard">{t('bank.difficulty.hard')}</option>
                      </NativeSelect>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-r${i}-count`}>{t('examBuilder.count')}</Label>
                      <Input
                        id={`${uid}-r${i}-count`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={row.count}
                        onChange={(ev) =>
                          field.replaceValue(i, { ...row, count: Number(ev.target.value) })
                        }
                        data-testid="exam-rule-count"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      disabled={field.state.value.length === 1}
                      onClick={() => field.removeValue(i)}
                      aria-label={t('examBuilder.removeRule')}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                    {detail?.available[i] !== undefined ? (
                      <p
                        className={`text-xs sm:col-span-4 ${detail.available[i] < row.count ? 'font-semibold text-omr' : 'text-ink-muted'}`}
                      >
                        {t('examBuilder.available', { n: formatInteger(detail.available[i] ?? 0) })}
                      </p>
                    ) : null}
                    {err(`blueprint.${i}`) ? (
                      <p className="text-sm text-destructive sm:col-span-4">
                        {err(`blueprint.${i}`)}
                      </p>
                    ) : null}
                  </div>
                ))}
                {err('blueprint') ? (
                  <p className="text-sm text-destructive">{err('blueprint')}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => field.pushValue({ topicId: '', difficulty: null, count: 10 })}
                  data-testid="exam-rule-add"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  {t('examBuilder.addRule')}
                </Button>
              </fieldset>
            )}
          </form.Field>
          {isEditable ? (
            <Button type="submit" className="w-fit" data-testid="exam-save">
              {t('examBuilder.save')}
            </Button>
          ) : null}
        </fieldset>
      </form>

      {message ? (
        <p
          role={message.tone === 'ok' ? 'status' : 'alert'}
          className={`text-sm font-semibold ${message.tone === 'ok' ? 'text-pass' : 'text-destructive'}`}
        >
          {tDynamic(message.key)}
        </p>
      ) : null}

      {e && detail ? (
        <section
          aria-labelledby={`${uid}-course`}
          className="flex flex-col gap-3 border border-primary/15 bg-background p-5 sm:p-7"
          data-testid="exam-course"
        >
          <h2 id={`${uid}-course`} className="text-lg font-bold">
            {t('examBuilder.course')}
          </h2>
          <p className="text-sm text-ink-muted">{t('examBuilder.courseHint')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-64 flex-1 gap-1.5">
              <Label htmlFor={`${uid}-course-select`} className="sr-only">
                {t('examBuilder.course')}
              </Label>
              <NativeSelect
                id={`${uid}-course-select`}
                value={courseId}
                onChange={(ev) => setCourseId(ev.target.value)}
                data-testid="exam-course-select"
              >
                <option value="">{t('examBuilder.courseNone')}</option>
                {detail.courseOptions.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {locale === 'bn' ? c.titleBn || c.titleEn : c.titleEn || c.titleBn}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              variant="outline"
              disabled={courseId === (e.courseId ?? '')}
              onClick={async () =>
                handle(
                  await props.onAttach(e.examId, e.version, courseId || null),
                  'examBuilder.attached',
                )
              }
              data-testid="exam-course-save"
            >
              {t('examBuilder.attach')}
            </Button>
          </div>
        </section>
      ) : null}

      {e ? (
        <section
          aria-labelledby={`${uid}-q`}
          className="flex flex-col gap-4 border border-primary/15 bg-background p-5 sm:p-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={`${uid}-q`} className="text-lg font-bold">
              {t('examBuilder.questions', {
                n: formatInteger(e.questionCount),
                planned: formatInteger(e.plannedCount),
              })}
            </h2>
            <div className="flex flex-wrap gap-2">
              {e.status === 'draft' ? (
                <>
                  <Button
                    variant="outline"
                    onClick={async () =>
                      handle(await props.onDraw(e.examId, e.version), 'examBuilder.drawn')
                    }
                    data-testid="exam-draw"
                  >
                    <Dices aria-hidden="true" className="size-4" />
                    {t(e.questionCount > 0 ? 'examBuilder.redraw' : 'examBuilder.draw')}
                  </Button>
                  <Button
                    onClick={async () =>
                      handle(await props.onPublish(e.examId, e.version), 'examBuilder.published')
                    }
                    disabled={e.questionCount === 0}
                    data-testid="exam-publish"
                  >
                    <Send aria-hidden="true" className="size-4" />
                    {t('examBuilder.publish')}
                  </Button>
                </>
              ) : null}
              {e.status === 'published' ? (
                <Button
                  variant="outline"
                  className="border-omr text-omr"
                  onClick={async () =>
                    handle(await props.onRetire(e.examId, e.version), 'examBuilder.retired')
                  }
                  data-testid="exam-retire"
                >
                  {t('examBuilder.retire')}
                </Button>
              ) : null}
            </div>
          </div>
          {detail && detail.questions.length > 0 ? (
            <ol className="flex flex-col divide-y divide-primary/10">
              {detail.questions.map((q, i) => (
                <li
                  key={q.questionId}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold tabular-nums">{formatInteger(i + 1)}. </span>
                    {locale === 'bn' ? q.promptBn : q.promptEn}
                  </span>
                  <DifficultyMark difficulty={q.difficulty} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-muted">{t('examBuilder.noQuestions')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
