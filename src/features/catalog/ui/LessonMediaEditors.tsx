// I1 builder: a video lesson's YouTube video and a quiz lesson's MCQs, both edited on the section's
// working copy. The server parses the link and checks every question again; its field errors are
// shown next to the field they name.
import { useForm } from '@tanstack/react-form';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseYoutubeVideoId } from '../domain/lesson-media.ts';
import { FieldError, type SaveOutcome, TextField } from './fields.tsx';

const LETTERS = [
  'landing.q.letter.a',
  'landing.q.letter.b',
  'landing.q.letter.c',
  'landing.q.letter.d',
] as const;

/** The first error for a field or any of its nested positions (e.g. questions.0.optionsBn.2). */
export function fieldErrorFor(outcome: SaveOutcome, field: string): string | undefined {
  const entries = Object.entries(outcome?.fieldErrors ?? {});
  const exact = entries.find(([key]) => key === field);
  if (exact) return exact[1][0];
  return entries.find(([key]) => key.startsWith(`${field}.`))?.[1][0];
}

// ---------------------------------------------------------------- video

export function VideoEditor(props: {
  youtubeVideoId: string | null;
  canEdit: boolean;
  onSave: (youtube: string | null) => Promise<SaveOutcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [outcome, setOutcome] = useState<SaveOutcome>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const form = useForm({
    defaultValues: { youtube: props.youtubeVideoId ?? '' },
    onSubmit: async ({ value }) => {
      setOutcome(await props.onSave(value.youtube.trim() === '' ? null : value.youtube));
    },
  });
  return (
    <section
      className="grid gap-3 rounded-sm border border-dashed border-primary/40 bg-paper p-4"
      data-testid="video-editor"
    >
      <h3 className="text-sm font-semibold">{t('catalog.instructor.video.title')}</h3>
      {props.youtubeVideoId ? (
        <p className="text-sm" data-testid="video-editor-current">
          {t('catalog.instructor.video.current', { id: props.youtubeVideoId })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="video-editor-none">
          {t('catalog.instructor.video.none')}
        </p>
      )}
      {/* The preview follows the link in the field (a pasted link previews before it is saved),
          falling back to the saved video. */}
      <form.Subscribe selector={(s) => s.values.youtube}>
        {(typed) => {
          const previewId = parseYoutubeVideoId(typed) ?? props.youtubeVideoId;
          if (!previewId) return null;
          return isPreviewing ? (
            <div className="grid gap-2">
              <div className="relative aspect-video w-full max-w-xl overflow-hidden bg-ink">
                <iframe
                  key={previewId}
                  src={`https://www.youtube-nocookie.com/embed/${previewId}?rel=0`}
                  title={t('catalog.instructor.video.previewTitle')}
                  className="absolute inset-0 size-full"
                  allow="encrypted-media; picture-in-picture; fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                  data-testid="video-editor-preview"
                />
              </div>
              {previewId !== props.youtubeVideoId ? (
                <p className="text-sm text-ink/70" data-testid="video-editor-unsaved">
                  {t('catalog.instructor.video.previewUnsaved')}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => setIsPreviewing(false)}
                data-testid="video-editor-preview-close"
              >
                {t('catalog.instructor.video.previewClose')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => setIsPreviewing(true)}
              data-testid="video-editor-preview-open"
            >
              {t('catalog.instructor.video.preview')}
            </Button>
          );
        }}
      </form.Subscribe>
      {props.canEdit ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="youtube">
            {(field) => {
              const typed = field.state.value.trim();
              const isUnrecognised = typed.length > 0 && parseYoutubeVideoId(typed) === null;
              return (
                <TextField
                  label={t('catalog.instructor.video.link')}
                  hint={t('catalog.instructor.video.hint')}
                  lang="en"
                  value={field.state.value}
                  onChange={field.handleChange}
                  error={
                    fieldErrorFor(outcome, 'youtube') ??
                    (isUnrecognised ? 'errors.catalog.youtubeInvalid' : undefined)
                  }
                  testId="video-editor-link"
                />
              );
            }}
          </form.Field>
          <div className="flex flex-wrap gap-2">
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting} data-testid="video-editor-save">
                  {t('catalog.instructor.video.save')}
                </Button>
              )}
            </form.Subscribe>
            {props.youtubeVideoId ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => setOutcome(await props.onSave(null))}
                data-testid="video-editor-clear"
              >
                {t('catalog.instructor.video.clear')}
              </Button>
            ) : null}
          </div>
          {outcome && !outcome.fieldErrors ? (
            <p role="alert" className="text-sm text-destructive" data-testid="video-editor-error">
              {tDynamic(outcome.i18nKey)}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- quiz

export type QuizQuestionEdit = {
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
};

export type QuizEdit = {
  questions: QuizQuestionEdit[];
  /** US4.13: the streak a streak-only bonus quiz needs, else null. */
  streakBonusDays?: number | null;
};
/** The default streak for a new streak-only bonus quiz (FR4.5). */
const DEFAULT_BONUS_DAYS = 7;

type DraftQuestion = {
  /** A stable key for the list while editing; never sent to the server. */
  key: string;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string;
  explanationEn: string;
};

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const blankQuestion = (): DraftQuestion => ({
  key: newKey(),
  promptBn: '',
  promptEn: '',
  optionsBn: ['', '', '', ''],
  optionsEn: ['', '', '', ''],
  correctIndex: 0,
  explanationBn: '',
  explanationEn: '',
});

const toDraft = (q: QuizQuestionEdit): DraftQuestion => ({
  ...q,
  key: newKey(),
  optionsBn: [...q.optionsBn],
  optionsEn: [...q.optionsEn],
  explanationBn: q.explanationBn ?? '',
  explanationEn: q.explanationEn ?? '',
});

export function QuizEditor(props: {
  questionCount: number;
  canEdit: boolean;
  onLoad: () => Promise<QuizEdit | null>;
  onSave: (questions: QuizQuestionEdit[], streakBonusDays: number | null) => Promise<SaveOutcome>;
}) {
  const { t, formatInteger } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState<QuizEdit | 'failed' | null>(null);
  useEffect(() => {
    if (!isOpen || loaded !== null) return;
    void props.onLoad().then((value) => setLoaded(value ?? 'failed'));
  }, [isOpen, loaded, props]);
  return (
    <section
      className="grid gap-3 rounded-sm border border-dashed border-primary/40 bg-paper p-4"
      data-testid="quiz-editor"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t('catalog.instructor.quiz.title', { count: formatInteger(props.questionCount) })}
        </h3>
        <Button
          type="button"
          variant="outline"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((v) => !v)}
          data-testid="quiz-editor-toggle"
        >
          {t(
            isOpen
              ? 'catalog.instructor.quiz.close'
              : props.canEdit
                ? 'catalog.instructor.quiz.edit'
                : 'catalog.instructor.quiz.view',
          )}
        </Button>
      </div>
      {isOpen && loaded === null ? (
        <p className="text-sm">{t('catalog.instructor.quiz.loading')}</p>
      ) : null}
      {isOpen && loaded === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('catalog.instructor.quiz.loadFailed')}
        </p>
      ) : null}
      {isOpen && loaded && loaded !== 'failed' ? (
        <QuizForm
          initial={loaded.questions}
          initialBonusDays={loaded.streakBonusDays ?? null}
          canEdit={props.canEdit}
          onSave={async (questions, streakBonusDays) => {
            const outcome = await props.onSave(questions, streakBonusDays);
            if (!outcome) setLoaded({ questions, streakBonusDays });
            return outcome;
          }}
        />
      ) : null}
    </section>
  );
}

function QuizForm(props: {
  initial: QuizQuestionEdit[];
  initialBonusDays: number | null;
  canEdit: boolean;
  onSave: (questions: QuizQuestionEdit[], streakBonusDays: number | null) => Promise<SaveOutcome>;
}) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [outcome, setOutcome] = useState<SaveOutcome>(null);
  const [isSaved, setIsSaved] = useState(false);
  const form = useForm({
    defaultValues: {
      questions: props.initial.length > 0 ? props.initial.map(toDraft) : [blankQuestion()],
      isBonus: props.initialBonusDays !== null,
      bonusDays: props.initialBonusDays ?? DEFAULT_BONUS_DAYS,
    },
    onSubmit: async ({ value }) => {
      setIsSaved(false);
      const result = await props.onSave(
        value.questions.map(({ key: _key, ...q }) => ({
          ...q,
          explanationBn: q.explanationBn.trim() === '' ? null : q.explanationBn,
          explanationEn: q.explanationEn.trim() === '' ? null : q.explanationEn,
        })),
        value.isBonus ? value.bonusDays : null,
      );
      setOutcome(result);
      setIsSaved(result === null);
    },
  });
  const disabled = !props.canEdit;
  return (
    <form
      className="grid gap-4"
      data-testid="quiz-editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="questions" mode="array">
        {(list) => (
          <>
            <ol className="grid gap-4">
              {list.state.value.map((question, i) => (
                <li
                  key={question.key}
                  className="grid gap-3 rounded-sm border border-primary/20 bg-background p-4"
                  data-testid="quiz-editor-question"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {t('catalog.instructor.quiz.question', { n: formatInteger(i + 1) })}
                    </span>
                    {props.canEdit ? (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={i === 0}
                          aria-label={t('catalog.instructor.sections.moveUp')}
                          onClick={() => list.moveValue(i, i - 1)}
                        >
                          <ChevronUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={i === list.state.value.length - 1}
                          aria-label={t('catalog.instructor.sections.moveDown')}
                          onClick={() => list.moveValue(i, i + 1)}
                        >
                          <ChevronDown aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={list.state.value.length === 1}
                          aria-label={t('catalog.instructor.quiz.remove')}
                          onClick={() => list.removeValue(i)}
                          data-testid="quiz-editor-remove"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(['Bn', 'En'] as const).map((lang) => (
                      <form.Field key={lang} name={`questions[${i}].prompt${lang}`}>
                        {(field) => (
                          <TextField
                            label={t(`catalog.instructor.quiz.prompt${lang}`)}
                            lang={lang === 'Bn' ? 'bn' : 'en'}
                            value={field.state.value}
                            onChange={disabled ? () => undefined : field.handleChange}
                            error={fieldErrorFor(outcome, `questions.${i}.prompt${lang}`)}
                            testId={`quiz-editor-prompt-${lang.toLowerCase()}`}
                          />
                        )}
                      </form.Field>
                    ))}
                  </div>
                  <fieldset className="grid gap-2">
                    <legend className="text-sm font-medium">
                      {t('catalog.instructor.quiz.options')}
                    </legend>
                    {[0, 1, 2, 3].map((o) => (
                      <div
                        key={o}
                        className="grid items-start gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <form.Field name={`questions[${i}].correctIndex`}>
                          {(field) => (
                            <label className="flex min-h-10 items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`correct-${i}`}
                                checked={field.state.value === o}
                                disabled={disabled}
                                onChange={() => field.handleChange(o)}
                                data-testid="quiz-editor-correct"
                              />
                              <span className="font-bold">
                                {t(LETTERS[o] ?? 'landing.q.letter.a')}
                              </span>
                              <span className="sr-only">
                                {t('catalog.instructor.quiz.markCorrect')}
                              </span>
                            </label>
                          )}
                        </form.Field>
                        {(['Bn', 'En'] as const).map((lang) => (
                          <form.Field key={lang} name={`questions[${i}].options${lang}[${o}]`}>
                            {(field) => (
                              <TextField
                                label={t(`catalog.instructor.quiz.option${lang}`, {
                                  letter: t(LETTERS[o] ?? 'landing.q.letter.a'),
                                })}
                                lang={lang === 'Bn' ? 'bn' : 'en'}
                                value={field.state.value ?? ''}
                                onChange={disabled ? () => undefined : field.handleChange}
                                error={fieldErrorFor(outcome, `questions.${i}.options${lang}.${o}`)}
                                testId={`quiz-editor-option-${lang.toLowerCase()}`}
                              />
                            )}
                          </form.Field>
                        ))}
                      </div>
                    ))}
                    <FieldError
                      id={`quiz-options-${i}-error`}
                      error={
                        outcome?.fieldErrors?.[`questions.${i}.optionsBn`]?.[0] ??
                        outcome?.fieldErrors?.[`questions.${i}.optionsEn`]?.[0]
                      }
                      testId="quiz-editor-options-error"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('catalog.instructor.quiz.correctHint', {
                        letter: t(LETTERS[question.correctIndex] ?? 'landing.q.letter.a'),
                      })}
                    </p>
                  </fieldset>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(['Bn', 'En'] as const).map((lang) => (
                      <form.Field key={lang} name={`questions[${i}].explanation${lang}`}>
                        {(field) => (
                          <TextField
                            label={t(`catalog.instructor.quiz.explanation${lang}`)}
                            lang={lang === 'Bn' ? 'bn' : 'en'}
                            value={field.state.value}
                            onChange={disabled ? () => undefined : field.handleChange}
                            error={fieldErrorFor(outcome, `questions.${i}.explanation${lang}`)}
                            testId={`quiz-editor-explanation-${lang.toLowerCase()}`}
                          />
                        )}
                      </form.Field>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            {props.canEdit ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => list.pushValue(blankQuestion())}
                data-testid="quiz-editor-add"
              >
                <Plus aria-hidden="true" />
                {t('catalog.instructor.quiz.add')}
              </Button>
            ) : null}
          </>
        )}
      </form.Field>
      <FieldError
        id="quiz-questions-error"
        error={outcome?.fieldErrors?.questions?.[0]}
        testId="quiz-editor-list-error"
      />
      <fieldset
        className="grid gap-2 rounded-sm border border-primary/20 bg-background p-4"
        data-testid="quiz-editor-bonus"
      >
        <legend className="px-1 text-sm font-semibold">{t('catalog.instructor.quiz.bonus')}</legend>
        <form.Field name="isBonus">
          {(field) => (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                disabled={disabled}
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
              />
              {t('catalog.instructor.quiz.bonusToggle')}
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.isBonus}>
          {(isBonus) =>
            isBonus ? (
              <form.Field name="bonusDays">
                {(field) => (
                  <div className="grid gap-1.5 pl-6">
                    <Label htmlFor="quiz-bonus-days">
                      {t('catalog.instructor.quiz.bonusDays')}
                    </Label>
                    <Input
                      id="quiz-bonus-days"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      className="w-28"
                      disabled={disabled}
                      aria-describedby="quiz-bonus-days-error"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                    />
                    <FieldError
                      id="quiz-bonus-days-error"
                      error={outcome?.fieldErrors?.streakBonusDays?.[0]}
                      testId="quiz-editor-bonus-error"
                    />
                  </div>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
        <p className="text-xs text-ink-muted">{t('catalog.instructor.quiz.bonusHint')}</p>
      </fieldset>
      {props.canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting} data-testid="quiz-editor-save">
                {t('catalog.instructor.quiz.save')}
              </Button>
            )}
          </form.Subscribe>
          {isSaved ? (
            <p role="status" className="text-sm text-pass" data-testid="quiz-editor-saved">
              {t('catalog.instructor.quiz.saved')}
            </p>
          ) : null}
          {outcome && !outcome.fieldErrors ? (
            <p role="alert" className="text-sm text-destructive" data-testid="quiz-editor-error">
              {tDynamic(outcome.i18nKey)}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
