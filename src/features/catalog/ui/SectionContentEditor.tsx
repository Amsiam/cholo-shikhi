// I1 builder part 2: one section's lessons and its review (US3.17, US3.9, US3.10; BR3.4, BR7.1–BR7.4,
// BR8.2–BR8.8; NFR6.208, NFR7.201). Lessons are added, ordered, retitled and removed in the working
// copy; a text lesson's body is typed in the small editor markup, parsed into an allowlisted document
// and previewed through the one reviewed renderer. The review panel shows only the actions the
// caller may take; the server decides again under its row locks.
import { useForm } from '@tanstack/react-form';
import {
  ArrowDown,
  ArrowUp,
  BookText,
  CircleCheck,
  CircleDashed,
  ListChecks,
  MessageSquareWarning,
  Plus,
  ShieldAlert,
  Trash2,
  Video,
} from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  canonicalJson,
  LESSON_BODY_MAX_BYTES,
  type LessonDocument,
} from '../domain/lesson-document.ts';
import { lessonMarkupOf, parseLessonMarkup } from '../domain/lesson-markup.ts';
import { LESSON_KINDS, type LessonKind } from '../domain/lessons.ts';
import { RETURN_COMMENT_MAX } from '../domain/review.ts';
import {
  ChoiceField,
  ConfirmDialog,
  FieldError,
  firstErrors,
  type SaveOutcome,
  TextField,
} from './fields.tsx';
import {
  type QuizEdit,
  QuizEditor,
  type QuizQuestionEdit,
  VideoEditor,
} from './LessonMediaEditors.tsx';
import { renderLessonDocument } from './render-lesson-document.tsx';

export type ContentLesson = {
  lessonId: string;
  kind: LessonKind;
  liveState: 'never_published' | 'live' | 'withdrawn';
  position: number;
  version: number;
  titleBn: string | null;
  titleEn: string | null;
  bodyBn: LessonDocument | null;
  bodyEn: LessonDocument | null;
  mediaStatus: string;
  youtubeVideoId: string | null;
  captionLanguages: string[];
  quizQuestionCount: number;
  isComplete: boolean;
  isUnderTakedown: boolean;
};

export type ContentSection = {
  sectionId: string;
  isOwner: boolean;
  isLead: boolean;
  canManageCourse: boolean;
  isUnderTakedown: boolean;
  canEdit: boolean;
  working: { reviewState: string; titleBn: string; titleEn: string } | null;
  lessons: ContentLesson[];
  lastReturnComment: string | null;
};

export type ReviewAction = 'submit' | 'approve' | 'return' | 'selfApprove' | 'reopen';

export type SectionContentActions = {
  onAddLesson: (input: {
    kind: LessonKind;
    titleBn: string;
    titleEn: string;
  }) => Promise<SaveOutcome>;
  onEditLesson: (
    lesson: ContentLesson,
    titles: { titleBn: string; titleEn: string },
  ) => Promise<SaveOutcome>;
  onSaveBody: (
    lesson: ContentLesson,
    language: 'bn' | 'en',
    body: LessonDocument | null,
  ) => Promise<SaveOutcome>;
  onSetVideo: (lesson: ContentLesson, youtube: string | null) => Promise<SaveOutcome>;
  onLoadQuiz: (lesson: ContentLesson) => Promise<QuizEdit | null>;
  onSaveQuiz: (
    lesson: ContentLesson,
    questions: QuizQuestionEdit[],
    streakBonusDays: number | null,
  ) => Promise<SaveOutcome>;
  onReorder: (lessonIds: string[]) => Promise<SaveOutcome>;
  onRemoveLesson: (lessonId: string) => Promise<SaveOutcome>;
  onReview: (action: ReviewAction, comment?: string) => Promise<SaveOutcome>;
};

const LessonTitles = z.object({
  kind: z.enum(LESSON_KINDS),
  titleBn: z.string().max(300),
  titleEn: z.string().max(300),
});

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** The first error for a field, or for any of its nested positions (e.g. bodyBn.links.2). */
function errorFor(outcome: NonNullable<SaveOutcome>, field: string): string | undefined {
  const entries = Object.entries(outcome.fieldErrors ?? {});
  const hit = entries.find(([key]) => key === field || key.startsWith(`${field}.`));
  return hit?.[1][0];
}

function AddLessonForm(props: { onAdd: SectionContentActions['onAddLesson'] }) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useForm({
    defaultValues: { kind: 'text' as LessonKind, titleBn: '', titleEn: '' },
    onSubmit: async ({ value, formApi }) => {
      const local = firstErrors(LessonTitles, value);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onAdd(value);
      if (outcome) {
        setErrors(
          firstErrors(LessonTitles, value, outcome.fieldErrors ?? { _form: [outcome.i18nKey] }),
        );
        return;
      }
      formApi.reset();
    },
  });
  return (
    <form
      className="grid gap-4 border border-dashed border-primary/40 bg-background p-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="lesson-add-form"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <Plus aria-hidden="true" className="size-4 text-primary" />
        {t('catalog.instructor.lessons.addHeading')}
      </h3>
      <form.Field name="kind">
        {(field) => (
          <ChoiceField
            legend={t('catalog.instructor.lessons.kind')}
            value={field.state.value}
            onChange={(v) => field.handleChange(v as LessonKind)}
            options={LESSON_KINDS.map((kind) => ({
              value: kind,
              label: t(`catalog.instructor.lessons.kind.${kind}`),
            }))}
            testId="lesson-add-form-kind"
          />
        )}
      </form.Field>
      <form.Field name="titleBn">
        {(field) => (
          <TextField
            label={t('catalog.instructor.lessons.titleBn')}
            lang="bn"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.titleBn}
            hint={t('catalog.instructor.lessons.titleHint')}
            testId="lesson-add-form-title-bn"
          />
        )}
      </form.Field>
      <form.Field name="titleEn">
        {(field) => (
          <TextField
            label={t('catalog.instructor.lessons.titleEn')}
            lang="en"
            value={field.state.value}
            onChange={field.handleChange}
            error={errors.titleEn}
            testId="lesson-add-form-title-en"
          />
        )}
      </form.Field>
      <FieldError id="lesson-add-form-error" error={errors._form} testId="lesson-add-form-error" />
      <Button
        type="submit"
        className="w-fit justify-self-start"
        data-testid="lesson-add-form-submit"
      >
        {t('catalog.instructor.lessons.add')}
      </Button>
    </form>
  );
}

function BodyEditor(props: {
  lesson: ContentLesson;
  language: 'bn' | 'en';
  canEdit: boolean;
  onSave: SectionContentActions['onSaveBody'];
}) {
  const { t, tDynamic } = useI18n();
  const field = props.language === 'bn' ? 'bodyBn' : 'bodyEn';
  const stored = props.language === 'bn' ? props.lesson.bodyBn : props.lesson.bodyEn;
  const [markup, setMarkup] = useState(() => lessonMarkupOf(stored));
  const [error, setError] = useState<string | undefined>();
  const document = parseLessonMarkup(markup);
  const bytes = byteLength(canonicalJson(document));
  const isTooLarge = bytes > LESSON_BODY_MAX_BYTES;
  const id = `${props.lesson.lessonId}-${props.language}`;
  const testId = `lesson-body-${props.language}`;
  async function save() {
    const body = document.content.length === 0 ? null : document;
    const outcome = await props.onSave(props.lesson, props.language, body);
    setError(outcome ? (errorFor(outcome, field) ?? outcome.i18nKey) : undefined);
  }
  return (
    <div className="grid gap-2" data-testid={testId}>
      <label htmlFor={id} className="text-sm font-medium">
        {t(
          props.language === 'bn'
            ? 'catalog.instructor.lessons.bodyBn'
            : 'catalog.instructor.lessons.bodyEn',
        )}
      </label>
      <textarea
        id={id}
        lang={props.language}
        className="min-h-40 rounded-sm border border-primary/20 bg-background p-2 font-mono text-sm"
        value={markup}
        readOnly={!props.canEdit}
        onChange={(event) => setMarkup(event.target.value)}
        aria-invalid={error || isTooLarge ? true : undefined}
        aria-describedby={`${id}-help ${id}-size${error ? ` ${id}-error` : ''}`}
        data-testid={`${testId}-input`}
      />
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        {t('catalog.instructor.lessons.markupHelp')}
      </p>
      <p
        id={`${id}-size`}
        className={isTooLarge ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        data-testid={`${testId}-size`}
      >
        {t('catalog.instructor.lessons.bodySize', { used: bytes, max: LESSON_BODY_MAX_BYTES })}
      </p>
      <div className="border border-primary/20 bg-background" data-testid={`${testId}-preview`}>
        <p className="border-b border-primary/10 bg-primary/5 px-4 py-2 text-xs font-semibold tracking-wide text-primary uppercase">
          {t('catalog.instructor.lessons.preview')}
        </p>
        <div className="lesson-prose p-4">{renderLessonDocument(document)}</div>
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive"
          data-testid={`${testId}-error`}
        >
          {tDynamic(error)}
        </p>
      ) : null}
      {props.canEdit ? (
        <Button
          type="button"
          variant="outline"
          className="w-fit justify-self-start"
          disabled={isTooLarge}
          onClick={() => void save()}
          data-testid={`${testId}-save`}
        >
          {t('catalog.instructor.lessons.saveBody')}
        </Button>
      ) : null}
    </div>
  );
}

const iconButton =
  'inline-flex size-11 items-center justify-center rounded-sm sm:size-9 border border-primary/20 bg-background text-ink/70 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

function LessonRow(props: {
  lesson: ContentLesson;
  index: number;
  count: number;
  canEdit: boolean;
  actions: SectionContentActions;
  onMove: (from: number, to: number) => void;
  onAskRemove: (lesson: ContentLesson) => void;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const { lesson } = props;
  const KindIcon = lesson.kind === 'video' ? Video : lesson.kind === 'quiz' ? ListChecks : BookText;
  const [titles, setTitles] = useState({
    titleBn: lesson.titleBn ?? '',
    titleEn: lesson.titleEn ?? '',
  });
  const [error, setError] = useState<string | undefined>();
  const title =
    (locale === 'bn' ? lesson.titleBn : lesson.titleEn) || lesson.titleBn || lesson.titleEn || '';
  return (
    <li
      className={`flex flex-col border bg-background ${lesson.isComplete ? 'border-primary/20' : 'border-omr/30'}`}
      data-testid="lesson-row"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-primary/10 p-4 sm:px-5">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary"
        >
          <KindIcon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-ink-muted tabular-nums">
              {formatInteger(props.index + 1)}.
            </span>
            <span className="text-lg font-semibold break-words" data-testid="lesson-row-title">
              {title}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-ink/70">
              {t(`catalog.instructor.lessons.kind.${lesson.kind}`)}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${lesson.isComplete ? 'bg-pass/15 text-pass' : 'bg-omr-soft text-omr'}`}
              data-testid="lesson-row-complete"
            >
              {lesson.isComplete ? (
                <CircleCheck aria-hidden="true" className="size-3.5" />
              ) : (
                <CircleDashed aria-hidden="true" className="size-3.5" />
              )}
              {t(
                lesson.isComplete
                  ? 'catalog.instructor.lessons.complete'
                  : 'catalog.instructor.lessons.incomplete',
              )}
            </span>
            {lesson.isUnderTakedown ? (
              <Badge variant="destructive">{t('catalog.instructor.takedown')}</Badge>
            ) : null}
          </span>
        </div>
        {props.canEdit ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={iconButton}
              disabled={props.index === 0}
              aria-label={t('catalog.instructor.sections.moveUp')}
              title={t('catalog.instructor.sections.moveUp')}
              onClick={() => props.onMove(props.index, props.index - 1)}
              data-testid="lesson-row-move-up"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              className={iconButton}
              disabled={props.index === props.count - 1}
              aria-label={t('catalog.instructor.sections.moveDown')}
              title={t('catalog.instructor.sections.moveDown')}
              onClick={() => props.onMove(props.index, props.index + 1)}
              data-testid="lesson-row-move-down"
            >
              <ArrowDown aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              className={`${iconButton} hover:border-omr hover:text-omr`}
              aria-label={t('catalog.instructor.lessons.remove')}
              title={t('catalog.instructor.lessons.remove')}
              onClick={() => props.onAskRemove(lesson)}
              data-testid="lesson-row-remove"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {lesson.kind === 'video' && lesson.captionLanguages.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="lesson-row-no-captions">
            {t('catalog.instructor.lessons.noCaptions')}
          </p>
        ) : null}
        {props.canEdit ? (
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <TextField
              label={t('catalog.instructor.lessons.titleBn')}
              lang="bn"
              value={titles.titleBn}
              onChange={(v) => setTitles((x) => ({ ...x, titleBn: v }))}
              testId="lesson-row-title-bn"
            />
            <TextField
              label={t('catalog.instructor.lessons.titleEn')}
              lang="en"
              value={titles.titleEn}
              onChange={(v) => setTitles((x) => ({ ...x, titleEn: v }))}
              testId="lesson-row-title-en"
            />
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={async () => {
                const outcome = await props.actions.onEditLesson(lesson, titles);
                setError(
                  outcome ? (outcome.fieldErrors?.titleBn?.[0] ?? outcome.i18nKey) : undefined,
                );
              }}
              data-testid="lesson-row-save-title"
            >
              {t('catalog.instructor.lessons.saveTitle')}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="lesson-row-error">
            {tDynamic(error)}
          </p>
        ) : null}
        {lesson.kind === 'video' ? (
          <VideoEditor
            key={`${lesson.lessonId}-${lesson.version}`}
            youtubeVideoId={lesson.youtubeVideoId}
            canEdit={props.canEdit}
            onSave={(youtube) => props.actions.onSetVideo(lesson, youtube)}
          />
        ) : null}
        {lesson.kind === 'quiz' ? (
          <QuizEditor
            questionCount={lesson.quizQuestionCount}
            canEdit={props.canEdit}
            onLoad={() => props.actions.onLoadQuiz(lesson)}
            onSave={(questions, days) => props.actions.onSaveQuiz(lesson, questions, days)}
          />
        ) : null}
        {lesson.kind === 'text' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(['bn', 'en'] as const).map((language) => (
              <BodyEditor
                key={language}
                lesson={lesson}
                language={language}
                canEdit={props.canEdit}
                onSave={props.actions.onSaveBody}
              />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const REVIEW_STEPS = ['draft', 'in_review', 'approved'] as const;

/** BR8.3–BR8.8: the actions shown follow the caller's role and the copy's state. */
export function availableReviewActions(section: ContentSection): ReviewAction[] {
  const state = section.working?.reviewState;
  if (!state || section.isUnderTakedown) return [];
  const actions: ReviewAction[] = [];
  if (state === 'draft' && section.isOwner && !section.isLead) actions.push('submit');
  if (state === 'draft' && section.isOwner && section.isLead) actions.push('selfApprove');
  if (state === 'in_review' && section.canManageCourse) actions.push('approve', 'return');
  if (state === 'approved' && (section.isOwner || section.canManageCourse)) actions.push('reopen');
  return actions;
}

function ReviewPanel(props: {
  section: ContentSection;
  onReview: SectionContentActions['onReview'];
}) {
  const { t, tDynamic } = useI18n();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>();
  const state = props.section.working?.reviewState ?? 'published';
  const actions = availableReviewActions(props.section);
  async function run(action: ReviewAction) {
    const outcome = await props.onReview(action, action === 'return' ? comment : undefined);
    setError(outcome ? (outcome.fieldErrors?.comment?.[0] ?? outcome.i18nKey) : undefined);
    if (!outcome) setComment('');
  }
  return (
    <section
      className="flex flex-col gap-4 border border-primary/20 bg-background p-5 lg:sticky lg:top-20"
      aria-labelledby="review-panel-title"
      data-testid="review-panel"
    >
      <h2 id="review-panel-title" className="text-lg font-semibold">
        {t('catalog.instructor.review.title')}
      </h2>
      <p className="font-semibold text-primary" data-testid="review-panel-state">
        {t('catalog.instructor.review.state', {
          state: tDynamic(`catalog.instructor.review.state.${state}`),
        })}
      </p>
      <ol
        className="flex flex-col gap-1.5 text-sm"
        aria-label={t('catalog.instructor.review.steps')}
      >
        {REVIEW_STEPS.map((step, i) => {
          const at = REVIEW_STEPS.indexOf(state as (typeof REVIEW_STEPS)[number]);
          const isDone = at > i || state === 'published';
          const isNow = at === i;
          return (
            <li key={step} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-3 rounded-full border-2 ${isDone ? 'border-pass bg-pass' : isNow ? 'border-primary bg-primary' : 'border-ink/25'}`}
              />
              <span
                className={
                  isNow ? 'font-semibold text-primary' : isDone ? 'text-ink/70' : 'text-ink-muted'
                }
              >
                {tDynamic(`catalog.instructor.review.state.${step}`)}
              </span>
            </li>
          );
        })}
      </ol>
      {props.section.lastReturnComment ? (
        <div
          className="flex flex-col gap-1.5 border border-omr/40 bg-omr-soft p-3"
          data-testid="review-panel-comment"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-omr">
            <MessageSquareWarning aria-hidden="true" className="size-4 shrink-0" />
            {t('catalog.instructor.review.returnedWith')}
          </p>
          {/* Plain text (NFR6.211): React escapes it; newlines are the only formatting. */}
          <p className="whitespace-pre-line">{props.section.lastReturnComment}</p>
        </div>
      ) : null}
      {actions.includes('return') ? (
        <div className="grid gap-1.5">
          <label htmlFor="review-comment" className="text-sm font-medium">
            {t('catalog.instructor.review.comment')}
          </label>
          <textarea
            id="review-comment"
            className="min-h-24 rounded-sm border border-primary/20 bg-background p-2"
            maxLength={RETURN_COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'review-panel-error' : undefined}
            data-testid="review-panel-comment-input"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'return' || action === 'reopen' ? 'outline' : 'default'}
            onClick={() => void run(action)}
            data-testid={`review-panel-${action}`}
          >
            {t(`catalog.instructor.review.action.${action}`)}
          </Button>
        ))}
      </div>
      {error ? (
        <p
          id="review-panel-error"
          role="alert"
          className="text-sm text-destructive"
          data-testid="review-panel-error"
        >
          {tDynamic(error)}
        </p>
      ) : null}
    </section>
  );
}

export function SectionContentEditor(props: { section: ContentSection } & SectionContentActions) {
  const { t, tDynamic, formatInteger } = useI18n();
  const [toRemove, setToRemove] = useState<ContentLesson | null>(null);
  const [listError, setListError] = useState<string | undefined>();
  const { section } = props;
  async function move(from: number, to: number) {
    const ids = section.lessons.map((l) => l.lessonId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    const outcome = await props.onReorder(ids);
    setListError(outcome?.i18nKey);
  }
  async function confirmRemove() {
    const lesson = toRemove;
    setToRemove(null);
    if (!lesson) return;
    const outcome = await props.onRemoveLesson(lesson.lessonId);
    setListError(outcome?.i18nKey);
  }
  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      data-testid="section-content-editor"
    >
      {section.isUnderTakedown ? (
        <p
          role="alert"
          className="flex items-start gap-2 border border-destructive/40 bg-destructive/5 p-3 text-destructive lg:col-span-2"
          data-testid="section-content-takedown"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('errors.catalog.underTakedown')}
        </p>
      ) : null}
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="lessons-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="lessons-title" className="text-2xl font-bold">
            {t('catalog.instructor.lessons.title')}
          </h2>
          <p className="text-sm text-ink-muted">
            {t('catalog.instructor.lessons.completeCount', {
              done: formatInteger(section.lessons.filter((l) => l.isComplete).length),
              total: formatInteger(section.lessons.length),
            })}
          </p>
        </div>
        {section.lessons.length === 0 ? (
          <p
            className="border border-dashed border-primary/40 bg-background p-6"
            data-testid="section-content-empty"
          >
            {t('catalog.instructor.lessons.empty')}
          </p>
        ) : (
          <ol className="flex flex-col gap-4" data-testid="section-content-lessons">
            {section.lessons.map((lesson, index) => (
              <LessonRow
                key={`${lesson.lessonId}-${lesson.version}`}
                lesson={lesson}
                index={index}
                count={section.lessons.length}
                canEdit={section.canEdit && !lesson.isUnderTakedown}
                actions={props}
                onMove={(from, to) => void move(from, to)}
                onAskRemove={setToRemove}
              />
            ))}
          </ol>
        )}
        {listError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="section-content-error">
            {tDynamic(listError)}
          </p>
        ) : null}
        {section.canEdit ? <AddLessonForm onAdd={props.onAddLesson} /> : null}
      </section>
      <ReviewPanel section={section} onReview={props.onReview} />
      <ConfirmDialog
        isOpen={toRemove !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToRemove(null);
        }}
        title={t('catalog.instructor.lessons.removeTitle')}
        description={t(
          toRemove?.liveState === 'never_published'
            ? 'catalog.instructor.lessons.removeDraftBody'
            : 'catalog.instructor.lessons.removeLiveBody',
        )}
        confirmLabel={t('catalog.instructor.lessons.remove')}
        onConfirm={() => void confirmRemove()}
        testId="lesson-remove-confirm"
      />
    </div>
  );
}
