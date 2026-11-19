// One bank question, bilingual: prompt, four options with one correct answer, an explanation, the
// topic, difficulty and a source note. Under it, the review actions the viewer may take now.
import { useForm } from '@tanstack/react-form';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { ReviewAction } from '../domain/bank.ts';
import type { BankQuestionView, TaxonomySubject } from '../server/bank.server.ts';
import { MeasuredDifficulty, StatusBadge } from './bank-parts.tsx';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

export type QuestionDraft = {
  questionId?: string;
  expectedVersion?: number;
  topicId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string;
  explanationEn: string;
  sourceNote: string;
};

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const textArea =
  'min-h-24 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm';

export function TopicSelect(props: {
  id: string;
  taxonomy: TaxonomySubject[];
  value: string;
  onChange: (v: string) => void;
  emptyLabel: string;
  invalid?: boolean;
  testId?: string;
}) {
  const { locale } = useI18n();
  const name = (x: { nameBn: string; nameEn: string }) => (locale === 'bn' ? x.nameBn : x.nameEn);
  return (
    <NativeSelect
      id={props.id}
      value={props.value}
      aria-invalid={props.invalid || undefined}
      onChange={(e) => props.onChange(e.target.value)}
      data-testid={props.testId}
    >
      <option value="">{props.emptyLabel}</option>
      {props.taxonomy.map((s) => (
        <optgroup key={s.subjectId} label={name(s)}>
          {s.topics.flatMap((t) => [
            <option key={t.topicId} value={t.topicId}>
              {name(t)}
            </option>,
            ...t.subtopics.map((x) => (
              <option key={x.topicId} value={x.topicId}>
                {`${name(t)} › ${name(x)}`}
              </option>
            )),
          ])}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

function FieldError(props: { id: string; keys?: readonly string[] }) {
  const { tDynamic } = useI18n();
  if (!props.keys?.length) return null;
  return (
    <p id={props.id} className="text-sm text-destructive">
      {props.keys.map((k) => tDynamic(k)).join(' ')}
    </p>
  );
}

export function QuestionEditor(props: {
  question: BankQuestionView | null;
  taxonomy: TaxonomySubject[];
  isAdmin: boolean;
  onSave: (draft: QuestionDraft) => Promise<Outcome<BankQuestionView>>;
  onReview: (input: {
    questionId: string;
    expectedVersion: number;
    action: ReviewAction;
    note?: string;
  }) => Promise<Outcome<BankQuestionView>>;
  onClose: (changed: boolean) => void;
}) {
  const { t, tDynamic } = useI18n();
  const uid = useId();
  const [current, setCurrent] = useState<BankQuestionView | null>(props.question);
  const [errors, setErrors] = useState<Record<string, readonly string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [changed, setChanged] = useState(false);
  const isReadOnly = current !== null && !current.canEdit;
  const q = props.question;

  const form = useForm({
    defaultValues: {
      topicId: q?.topicId ?? '',
      difficulty: (q?.difficulty ?? 'medium') as QuestionDraft['difficulty'],
      promptBn: q?.promptBn ?? '',
      promptEn: q?.promptEn ?? '',
      optionsBn: q?.optionsBn ?? ['', '', '', ''],
      optionsEn: q?.optionsEn ?? ['', '', '', ''],
      correctIndex: q?.correctIndex ?? -1,
      explanationBn: q?.explanationBn ?? '',
      explanationEn: q?.explanationEn ?? '',
      sourceNote: q?.sourceNote ?? '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      setNotice(null);
      if (!value.topicId) {
        setErrors({ topicId: ['errors.bank.topicRequired'] });
        return;
      }
      const r = await props.onSave({
        ...value,
        ...(current ? { questionId: current.questionId, expectedVersion: current.version } : {}),
      });
      if (!r.ok) {
        setErrors(r.error.fieldErrors ?? {});
        if (!r.error.fieldErrors) setFormError(r.error.i18nKey);
        return;
      }
      setErrors({});
      setCurrent(r.value);
      setChanged(true);
      setNotice(
        r.value.status === 'published' ? 'bank.editor.savedPublished' : 'bank.editor.saved',
      );
    },
  });

  const review = async (action: ReviewAction) => {
    if (!current) return;
    setFormError(null);
    setNotice(null);
    const r = await props.onReview({
      questionId: current.questionId,
      expectedVersion: current.version,
      action,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!r.ok) {
      setErrors(r.error.fieldErrors ?? {});
      setFormError(r.error.fieldErrors ? null : r.error.i18nKey);
      return;
    }
    setErrors({});
    setCurrent(r.value);
    setChanged(true);
    setNote('');
    setNotice(`bank.editor.done.${action}`);
  };

  const err = (k: string) => errors[k];
  const describedBy = (k: string) => (err(k) ? `${uid}-${k}-err` : undefined);

  return (
    <section
      aria-labelledby={`${uid}-title`}
      className="flex flex-col gap-6 border border-primary/15 bg-background p-5 sm:p-7"
      data-testid="bank-editor"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 pb-4">
        <div className="flex flex-col gap-2">
          <h2 id={`${uid}-title`} className="text-xl">
            {t(current ? 'bank.editor.editTitle' : 'bank.editor.newTitle')}
          </h2>
          {current ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <StatusBadge status={current.status} />
              <MeasuredDifficulty q={current} />
              {current.authorName ? t('bank.editor.by', { name: current.authorName }) : null}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              {t(props.isAdmin ? 'bank.editor.adminNote' : 'bank.editor.instructorNote')}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => props.onClose(changed)}
          aria-label={t('bank.editor.close')}
          data-testid="bank-editor-close"
        >
          <X aria-hidden="true" className="size-5" />
        </Button>
      </header>

      {current?.status === 'rejected' && current.reviewNote ? (
        <div className="border border-omr/40 bg-omr-soft p-4 text-sm" role="note">
          <p className="font-semibold text-omr">{t('bank.editor.rejectedNote')}</p>
          <p>{current.reviewNote}</p>
        </div>
      ) : null}

      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <fieldset disabled={isReadOnly} className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <form.Field name="topicId">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${uid}-topic`}>{t('bank.field.topic')}</Label>
                  <TopicSelect
                    id={`${uid}-topic`}
                    taxonomy={props.taxonomy}
                    value={field.state.value}
                    onChange={field.handleChange}
                    emptyLabel={t('bank.field.topicPick')}
                    invalid={Boolean(err('topicId'))}
                    testId="bank-field-topic"
                  />
                  <FieldError id={`${uid}-topicId-err`} keys={err('topicId')} />
                </div>
              )}
            </form.Field>
            <form.Field name="difficulty">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${uid}-difficulty`}>{t('bank.field.difficulty')}</Label>
                  <NativeSelect
                    id={`${uid}-difficulty`}
                    value={field.state.value}
                    onChange={(e) =>
                      field.handleChange(e.target.value as QuestionDraft['difficulty'])
                    }
                  >
                    <option value="easy">{t('bank.difficulty.easy')}</option>
                    <option value="medium">{t('bank.difficulty.medium')}</option>
                    <option value="hard">{t('bank.difficulty.hard')}</option>
                  </NativeSelect>
                </div>
              )}
            </form.Field>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {(['Bn', 'En'] as const).map((lang) => (
              <fieldset key={lang} className="flex min-w-0 flex-col gap-4">
                <legend className="mb-1 text-sm font-bold tracking-wide text-primary">
                  {t(lang === 'Bn' ? 'bank.lang.bn' : 'bank.lang.en')}
                </legend>
                <form.Field name={`prompt${lang}`}>
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-prompt${lang}`}>{t('bank.field.prompt')}</Label>
                      <textarea
                        id={`${uid}-prompt${lang}`}
                        lang={lang === 'Bn' ? 'bn' : 'en'}
                        className={textArea}
                        value={field.state.value}
                        maxLength={1000}
                        aria-invalid={Boolean(err(`prompt${lang}`)) || undefined}
                        aria-describedby={describedBy(`prompt${lang}`)}
                        onChange={(e) => field.handleChange(e.target.value)}
                        data-testid={`bank-field-prompt-${lang.toLowerCase()}`}
                      />
                      <FieldError id={`${uid}-prompt${lang}-err`} keys={err(`prompt${lang}`)} />
                    </div>
                  )}
                </form.Field>
                <form.Field name={`options${lang}`}>
                  {(field) => (
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t('bank.field.options')}</span>
                      {LETTERS.map((letter, i) => (
                        <div key={letter} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-omr text-xs font-bold text-omr"
                            >
                              {letter}
                            </span>
                            <Input
                              aria-label={t('bank.field.option', { letter })}
                              lang={lang === 'Bn' ? 'bn' : 'en'}
                              value={field.state.value[i] ?? ''}
                              maxLength={300}
                              aria-invalid={Boolean(err(`options${lang}.${i}`)) || undefined}
                              onChange={(e) => {
                                const next = [...field.state.value];
                                next[i] = e.target.value;
                                field.handleChange(next);
                              }}
                              data-testid={`bank-field-option-${lang.toLowerCase()}-${i}`}
                            />
                          </div>
                          <FieldError
                            id={`${uid}-options${lang}-${i}-err`}
                            keys={err(`options${lang}.${i}`)}
                          />
                        </div>
                      ))}
                      <FieldError id={`${uid}-options${lang}-err`} keys={err(`options${lang}`)} />
                    </div>
                  )}
                </form.Field>
                <form.Field name={`explanation${lang}`}>
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label htmlFor={`${uid}-explanation${lang}`}>
                        {t('bank.field.explanation')}
                      </Label>
                      <textarea
                        id={`${uid}-explanation${lang}`}
                        lang={lang === 'Bn' ? 'bn' : 'en'}
                        className={textArea}
                        value={field.state.value}
                        maxLength={1000}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </div>
                  )}
                </form.Field>
              </fieldset>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="correctIndex">
              {(field) => (
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">{t('bank.field.correct')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {LETTERS.map((letter, i) => (
                      <label
                        key={letter}
                        className={`flex size-11 cursor-pointer items-center justify-center rounded-full border-2 font-bold transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                          field.state.value === i
                            ? 'border-pass bg-pass text-white'
                            : 'border-omr text-omr hover:bg-omr-soft'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${uid}-correct`}
                          className="sr-only"
                          checked={field.state.value === i}
                          onChange={() => field.handleChange(i)}
                          data-testid={`bank-field-correct-${i}`}
                        />
                        {letter}
                      </label>
                    ))}
                  </div>
                  <FieldError id={`${uid}-correctIndex-err`} keys={err('correctIndex')} />
                </fieldset>
              )}
            </form.Field>
            <form.Field name="sourceNote">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${uid}-source`}>{t('bank.field.source')}</Label>
                  <Input
                    id={`${uid}-source`}
                    value={field.state.value}
                    maxLength={120}
                    placeholder={t('bank.field.sourceExample')}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>
        </fieldset>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(formError)}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm font-semibold text-pass">
            {tDynamic(notice)}
          </p>
        ) : null}

        {isReadOnly ? null : (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" data-testid="bank-save">
              {t(
                !current && props.isAdmin
                  ? 'bank.editor.savePublish'
                  : current
                    ? 'bank.editor.saveChanges'
                    : 'bank.editor.saveDraft',
              )}
            </Button>
          </div>
        )}
      </form>

      {current && current.actions.length > 0 ? (
        <section
          aria-labelledby={`${uid}-review`}
          className="flex flex-col gap-3 border-t border-primary/10 pt-5"
          data-testid="bank-review"
        >
          <h3 id={`${uid}-review`} className="text-base font-bold">
            {t('bank.review.title')}
          </h3>
          {current.actions.includes('reject') ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-note`}>{t('bank.review.note')}</Label>
              <textarea
                id={`${uid}-note`}
                className={textArea}
                value={note}
                maxLength={1000}
                aria-invalid={Boolean(err('note')) || undefined}
                onChange={(e) => setNote(e.target.value)}
                data-testid="bank-review-note"
              />
              <FieldError id={`${uid}-note-err`} keys={err('note')} />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {current.actions.map((a) => (
              <Button
                key={a}
                variant={a === 'approve' || a === 'submit' ? 'default' : 'outline'}
                className={a === 'reject' || a === 'retire' ? 'border-omr text-omr' : undefined}
                onClick={() => void review(a)}
                data-testid={`bank-action-${a}`}
              >
                {t(`bank.action.${a}`)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
