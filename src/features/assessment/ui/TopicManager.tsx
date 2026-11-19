// Admin: the question bank taxonomy. Subjects (each linked to the Goals whose Students practise it),
// their topics, and one level of sub-topics. Names are bilingual.
import { useForm } from '@tanstack/react-form';
import { Pencil, Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TaxonomySubject } from '../server/bank.server.ts';

type Outcome = { ok: true } | { ok: false; i18nKey: string };
export type GoalOption = { goalId: string; nameBn: string; nameEn: string };

/** Bangla and English names, saved together. */
function NameForm(props: {
  initial?: { nameBn: string; nameEn: string };
  submitLabel: string;
  onSubmit: (names: { nameBn: string; nameEn: string; goalIds: string[] }) => Promise<Outcome>;
  onCancel?: () => void;
  goals?: { all: GoalOption[]; selected: string[] };
  testId: string;
}) {
  const { t, tDynamic, locale } = useI18n();
  const uid = useId();
  const [error, setError] = useState<string | null>(null);
  const [goalIds, setGoalIds] = useState<string[]>(props.goals?.selected ?? []);
  const form = useForm({
    defaultValues: { nameBn: props.initial?.nameBn ?? '', nameEn: props.initial?.nameEn ?? '' },
    onSubmit: async ({ value, formApi }) => {
      if (!value.nameBn.trim() || !value.nameEn.trim()) {
        setError('errors.bank.namesRequired');
        return;
      }
      const r = await props.onSubmit({
        nameBn: value.nameBn.trim(),
        nameEn: value.nameEn.trim(),
        goalIds,
      });
      if (!r.ok) {
        setError(r.i18nKey);
        return;
      }
      setError(null);
      if (!props.initial) formApi.reset();
    },
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      data-testid={props.testId}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="nameBn">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-bn`}>{t('bank.topics.nameBn')}</Label>
              <Input
                id={`${uid}-bn`}
                lang="bn"
                maxLength={120}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="nameEn">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-en`}>{t('bank.topics.nameEn')}</Label>
              <Input
                id={`${uid}-en`}
                lang="en"
                maxLength={120}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      </div>
      {props.goals ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('bank.topics.goals')}</legend>
          <div className="flex flex-wrap gap-2">
            {props.goals.all.map((g) => {
              const isOn = goalIds.includes(g.goalId);
              return (
                <label
                  key={g.goalId}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                    isOn
                      ? 'border-primary bg-primary/10 font-semibold text-primary'
                      : 'border-primary/25'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={isOn}
                    onChange={() =>
                      setGoalIds((ids) =>
                        isOn ? ids.filter((x) => x !== g.goalId) : [...ids, g.goalId],
                      )
                    }
                  />
                  {locale === 'bn' ? g.nameBn : g.nameEn}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
            {t('bank.topics.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function TopicManager(props: {
  taxonomy: TaxonomySubject[];
  goals: GoalOption[];
  onSaveSubject: (input: {
    subjectId?: string;
    nameBn: string;
    nameEn: string;
    goalIds: string[];
  }) => Promise<Outcome>;
  onSaveTopic: (input: {
    topicId?: string;
    subjectId: string;
    parentTopicId?: string | null;
    nameBn: string;
    nameEn: string;
  }) => Promise<Outcome>;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const name = (x: { nameBn: string; nameEn: string }) => (locale === 'bn' ? x.nameBn : x.nameEn);
  const goalName = new Map(props.goals.map((g) => [g.goalId, name(g)]));

  const editRow = (key: string, label: string, form: ReactNode) =>
    open === key ? (
      <div className="border-t border-primary/10 bg-paper/60 p-4">{form}</div>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(key)}
        data-testid={`topics-open-${key.split(':')[0]}`}
      >
        {label}
      </Button>
    );

  return (
    <div className="flex flex-col gap-6" data-testid="topics-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('bank.topics.title')}
        </h1>
        <p className="text-ink/75">{t('bank.topics.subtitle')}</p>
      </header>

      <section
        aria-labelledby="topics-new-subject"
        className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      >
        <h2 id="topics-new-subject" className="flex items-center gap-2 text-lg">
          <Plus aria-hidden="true" className="size-5 text-primary" />
          {t('bank.topics.newSubject')}
        </h2>
        <NameForm
          goals={{ all: props.goals, selected: [] }}
          submitLabel={t('bank.topics.addSubject')}
          onSubmit={(input) => props.onSaveSubject(input)}
          testId="topics-subject-form"
        />
      </section>

      {props.taxonomy.length === 0 ? (
        <p className="text-ink-muted">{t('bank.topics.empty')}</p>
      ) : (
        props.taxonomy.map((s) => (
          <section
            key={s.subjectId}
            aria-labelledby={`subject-${s.subjectId}`}
            className="border border-primary/15 bg-background"
            data-testid="topics-subject"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 px-5 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id={`subject-${s.subjectId}`} className="text-lg">
                  {name(s)}
                </h2>
                <p className="text-sm text-ink-muted">
                  {s.goalIds.length === 0
                    ? t('bank.topics.noGoals')
                    : s.goalIds
                        .map((g) => goalName.get(g) ?? '')
                        .filter(Boolean)
                        .join(' · ')}
                </p>
              </div>
              {open === `subject:${s.subjectId}` ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(`subject:${s.subjectId}`)}
                  data-testid="topics-edit-subject"
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  {t('bank.topics.edit')}
                </Button>
              )}
            </header>
            {open === `subject:${s.subjectId}` ? (
              <div className="border-b border-primary/10 bg-paper/60 p-5">
                <NameForm
                  goals={{ all: props.goals, selected: s.goalIds }}
                  initial={s}
                  submitLabel={t('bank.topics.save')}
                  onSubmit={async (input) => {
                    const r = await props.onSaveSubject({ subjectId: s.subjectId, ...input });
                    if (r.ok) setOpen(null);
                    return r;
                  }}
                  onCancel={() => setOpen(null)}
                  testId="topics-subject-edit-form"
                />
              </div>
            ) : null}

            <ul className="divide-y divide-primary/10">
              {s.topics.map((tp) => (
                <li key={tp.topicId} className="flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="font-semibold">{name(tp)}</span>
                    <span className="flex flex-wrap gap-1">
                      {open === `rename:${tp.topicId}` || open === `sub:${tp.topicId}` ? null : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOpen(`rename:${tp.topicId}`)}
                          >
                            {t('bank.topics.rename')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOpen(`sub:${tp.topicId}`)}
                            data-testid="topics-add-sub"
                          >
                            <Plus aria-hidden="true" className="size-4" />
                            {t('bank.topics.addSub')}
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  {open === `rename:${tp.topicId}` ? (
                    <div className="bg-paper/60 px-5 py-4">
                      <NameForm
                        initial={tp}
                        submitLabel={t('bank.topics.save')}
                        onCancel={() => setOpen(null)}
                        testId="topics-rename-form"
                        onSubmit={async (names) => {
                          const r = await props.onSaveTopic({
                            topicId: tp.topicId,
                            subjectId: s.subjectId,
                            parentTopicId: null,
                            nameBn: names.nameBn,
                            nameEn: names.nameEn,
                          });
                          if (r.ok) setOpen(null);
                          return r;
                        }}
                      />
                    </div>
                  ) : null}
                  {tp.subtopics.length > 0 ? (
                    <ul className="pb-2">
                      {tp.subtopics.map((x) => (
                        <li key={x.topicId} className="flex flex-col">
                          <div className="flex flex-wrap items-center justify-between gap-2 py-1.5 pr-5 pl-10 text-sm">
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full border-2 border-omr"
                              />
                              {name(x)}
                            </span>
                            {open === `rename:${x.topicId}` ? null : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setOpen(`rename:${x.topicId}`)}
                              >
                                {t('bank.topics.rename')}
                              </Button>
                            )}
                          </div>
                          {open === `rename:${x.topicId}` ? (
                            <div className="bg-paper/60 py-4 pr-5 pl-10">
                              <NameForm
                                initial={x}
                                submitLabel={t('bank.topics.save')}
                                onCancel={() => setOpen(null)}
                                testId="topics-rename-form"
                                onSubmit={async (names) => {
                                  const r = await props.onSaveTopic({
                                    topicId: x.topicId,
                                    subjectId: s.subjectId,
                                    parentTopicId: tp.topicId,
                                    nameBn: names.nameBn,
                                    nameEn: names.nameEn,
                                  });
                                  if (r.ok) setOpen(null);
                                  return r;
                                }}
                              />
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {open === `sub:${tp.topicId}` ? (
                    <div className="bg-paper/60 py-4 pr-5 pl-10">
                      <NameForm
                        submitLabel={t('bank.topics.addSub')}
                        onCancel={() => setOpen(null)}
                        testId="topics-sub-form"
                        onSubmit={(names) =>
                          props.onSaveTopic({
                            subjectId: s.subjectId,
                            parentTopicId: tp.topicId,
                            nameBn: names.nameBn,
                            nameEn: names.nameEn,
                          })
                        }
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="border-t border-primary/10 px-5 py-3">
              {editRow(
                `topic:${s.subjectId}`,
                t('bank.topics.addTopic'),
                <NameForm
                  submitLabel={t('bank.topics.addTopic')}
                  onCancel={() => setOpen(null)}
                  testId="topics-topic-form"
                  onSubmit={(names) =>
                    props.onSaveTopic({
                      subjectId: s.subjectId,
                      nameBn: names.nameBn,
                      nameEn: names.nameEn,
                    })
                  }
                />,
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
