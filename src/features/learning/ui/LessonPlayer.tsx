// S5/S6 lesson player for an enrolled Student: a video lesson (YouTube, privacy-enhanced embed,
// loaded only when the Student taps play, so no data is spent until then), a reading lesson (the
// reviewed lesson-document renderer), or an MCQ quiz graded on the server. Video and reading
// lessons are marked done by the Student; a quiz is done once submitted.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Flame,
  ListOrdered,
  Maximize,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { renderLessonDocument } from '#src/features/catalog/ui/render-lesson-document.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { BADGE_SPOTS, nextBadgeSpot } from '../domain/viewer-badge.ts';
import type { LessonView, QuizResult } from '../server/learning.types.ts';
import {
  LESSON_KIND_LABEL,
  LessonKindIcon,
  LocalText,
  learnContainer,
  ProgressBar,
} from './learning-parts.tsx';

export type LessonPlayerProps = {
  lesson: LessonView;
  onComplete: () => Promise<void>;
  onSubmitQuiz: (
    answers: Array<{ questionId: string; chosenIndex: number | null }>,
  ) => Promise<QuizResult | null>;
  /** US3.12: the viewer-badge explanation was dismissed. */
  onDismissBadgeNotice?: () => Promise<void>;
};

const LETTER_KEYS = [
  'landing.q.letter.a',
  'landing.q.letter.b',
  'landing.q.letter.c',
  'landing.q.letter.d',
] as const;

export function LessonPlayer(props: LessonPlayerProps) {
  const { t, locale, formatInteger } = useI18n();
  const { lesson } = props;
  const [isCompleting, setIsCompleting] = useState(false);
  const body =
    locale === 'bn' ? (lesson.bodyBn ?? lesson.bodyEn) : (lesson.bodyEn ?? lesson.bodyBn);
  return (
    <article className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink" data-testid="lesson-player">
      <div className="border-b border-primary/15 bg-background">
        <div className={`${learnContainer} flex flex-col gap-2 py-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link
              to="/learn/$courseId"
              params={{ courseId: lesson.courseId }}
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline"
              data-testid="lesson-back"
            >
              <ListOrdered aria-hidden="true" className="size-4" />
              <span className="break-words">
                {locale === 'bn' ? lesson.courseTitleBn : lesson.courseTitleEn}
              </span>
            </Link>
            <span className="text-ink-muted tabular-nums">
              {t('learn.lesson.position', {
                n: formatInteger(lesson.number),
                total: formatInteger(lesson.lessonCount),
              })}
            </span>
          </div>
          <ProgressBar
            percent={lesson.progress.percent}
            label={t('learn.progressLabel', { percent: formatInteger(lesson.progress.percent) })}
          />
        </div>
      </div>

      <div className={`${learnContainer} flex flex-col gap-6 py-8`}>
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance break-words">
            <LocalText bn={lesson.titleBn} en={lesson.titleEn} />
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-muted">
            <LessonKindIcon kind={lesson.kind} />
            {t(LESSON_KIND_LABEL[lesson.kind])}
            <span aria-hidden="true">·</span>
            <LocalText bn={lesson.sectionTitleBn} en={lesson.sectionTitleEn} />
          </p>
        </header>

        {lesson.kind === 'video' ? (
          <VideoPanel
            videoId={lesson.youtubeVideoId}
            title={lesson}
            viewer={lesson.viewer}
            onDismissNotice={props.onDismissBadgeNotice}
          />
        ) : null}

        {lesson.kind !== 'quiz' && body ? (
          <section
            aria-label={t('learn.lesson.notes')}
            className="lesson-body lesson-prose max-w-3xl border border-primary/15 bg-background p-6"
            data-testid="lesson-body"
          >
            {renderLessonDocument(body)}
          </section>
        ) : null}
        {lesson.kind === 'text' && !body ? (
          <p className="border border-dashed border-primary/40 bg-background p-6">
            {t('learn.lesson.noBody')}
          </p>
        ) : null}

        {lesson.kind === 'quiz' ? (
          <QuizArea lesson={lesson} onSubmit={props.onSubmitQuiz} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {lesson.isCompleted ? (
              <p
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-pass"
                data-testid="lesson-done"
              >
                <CheckCircle2 aria-hidden="true" className="size-5" />
                {t('learn.lesson.completed')}
              </p>
            ) : (
              <Button
                size="lg"
                type="button"
                disabled={isCompleting}
                onClick={async () => {
                  setIsCompleting(true);
                  await props.onComplete();
                  setIsCompleting(false);
                }}
                data-testid="lesson-complete"
              >
                <CheckCircle2 aria-hidden="true" className="size-5" />
                {t('learn.lesson.markDone')}
              </Button>
            )}
          </div>
        )}

        <nav
          aria-label={t('learn.lesson.navLabel')}
          className="flex flex-wrap justify-between gap-3 border-t border-primary/15 pt-6"
        >
          {lesson.previousLessonId ? (
            <Link
              to="/learn/$courseId/lessons/$lessonId"
              params={{ courseId: lesson.courseId, lessonId: lesson.previousLessonId }}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary/30 bg-background px-4 font-semibold text-primary hover:bg-primary/10"
              data-testid="lesson-previous"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t('learn.lesson.previous')}
            </Link>
          ) : (
            <span />
          )}
          {lesson.nextLessonId ? (
            <Link
              to="/learn/$courseId/lessons/$lessonId"
              params={{ courseId: lesson.courseId, lessonId: lesson.nextLessonId }}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
              data-testid="lesson-next"
            >
              {t('learn.lesson.next')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <Link
              to="/learn/$courseId"
              params={{ courseId: lesson.courseId }}
              className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
              data-testid="lesson-finish"
            >
              {t('learn.lesson.backToCourse')}
            </Link>
          )}
        </nav>
      </div>
    </article>
  );
}

/**
 * US3.12: the viewer badge, drawn by the app over the video (aria-hidden). It jumps to another
 * spot every few seconds, without animation, and never sits in the caption area.
 */
function ViewerBadge(props: { badge: string; seconds: number }) {
  const [spot, setSpot] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setSpot((current) => nextBadgeSpot(current, Math.random)),
      props.seconds * 1000,
    );
    return () => clearInterval(timer);
  }, [props.seconds]);
  const at = BADGE_SPOTS[spot] ?? BADGE_SPOTS[0];
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 rounded-sm bg-ink/45 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-white/85 select-none"
      style={{ top: `${at?.top ?? 6}%`, left: `${at?.left ?? 6}%` }}
      data-testid="lesson-video-badge"
    >
      {props.badge}
    </span>
  );
}

/** The video stays a placeholder until the Student taps play: no YouTube request before that. */
function VideoPanel(props: {
  videoId: string | null;
  title: { titleBn: string | null; titleEn: string | null };
  viewer: LessonView['viewer'];
  onDismissNotice?: (() => Promise<void>) | undefined;
}) {
  const { t, locale } = useI18n();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isNoticeOpen, setIsNoticeOpen] = useState(props.viewer?.showNotice ?? false);
  const frame = useRef<HTMLDivElement>(null);
  const frameTitle =
    (locale === 'bn' ? props.title.titleBn : props.title.titleEn) ?? t('learn.lesson.videoTitle');
  if (!props.videoId) {
    return (
      <p
        className="aspect-video w-full max-w-4xl content-center bg-ink/90 p-6 text-center text-ink-foreground"
        data-testid="lesson-video-missing"
      >
        {t('learn.lesson.videoMissing')}
      </p>
    );
  }
  // Full screen is the player box itself, so the badge stays on screen (AC3.12.4); YouTube's own
  // full-screen button is turned off (fs=0) because it would hide the badge.
  const goFullScreen = () => {
    void frame.current?.requestFullscreen?.().catch(() => undefined);
  };
  return (
    <div className="flex w-full max-w-4xl flex-col gap-2">
      {isLoaded && isNoticeOpen && props.viewer ? (
        <div
          role="note"
          className="flex flex-wrap items-start justify-between gap-3 border border-primary/25 bg-background p-3 text-sm"
          data-testid="lesson-video-notice"
        >
          <p className="max-w-prose">
            <span className="font-semibold">{t('learn.badge.title')}</span>{' '}
            {t('learn.badge.body', { badge: props.viewer.badge })}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsNoticeOpen(false);
              void props.onDismissNotice?.();
            }}
            data-testid="lesson-video-notice-ok"
          >
            {t('learn.badge.ok')}
          </Button>
        </div>
      ) : null}
      <div
        ref={frame}
        className="relative aspect-video w-full overflow-hidden bg-ink"
        data-testid="lesson-video"
      >
        {isLoaded ? (
          <>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${props.videoId}?rel=0&modestbranding=1&autoplay=1&fs=0`}
              title={frameTitle}
              className="absolute inset-0 size-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              data-testid="lesson-video-frame"
            />
            {props.viewer ? (
              <ViewerBadge badge={props.viewer.badge} seconds={props.viewer.badgeSeconds} />
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsLoaded(true)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to bottom, transparent 0, transparent 23px, oklch(1 0 0 / 0.06) 23px, oklch(1 0 0 / 0.06) 24px)',
            }}
            data-testid="lesson-video-play"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-primary ring-4 ring-primary/30">
              <Play aria-hidden="true" className="ml-1 size-8 fill-current" />
            </span>
            <span className="font-semibold">{t('learn.lesson.playVideo')}</span>
            <span className="text-sm opacity-75">{t('learn.lesson.videoDataNote')}</span>
          </button>
        )}
      </div>
      {isLoaded ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={goFullScreen}
          data-testid="lesson-video-fullscreen"
        >
          <Maximize aria-hidden="true" className="size-4" />
          {t('learn.badge.fullScreen')}
        </Button>
      ) : null}
    </div>
  );
}

/** US4.13: a locked streak-only bonus quiz says what streak it needs instead of its questions. */
function QuizArea(props: { lesson: LessonView; onSubmit: LessonPlayerProps['onSubmitQuiz'] }) {
  const { t, formatInteger } = useI18n();
  const lock = props.lesson.bonusLock;
  if (!lock) return <QuizPanel lesson={props.lesson} onSubmit={props.onSubmit} />;
  return (
    <section
      className="flex flex-col gap-3 border-2 border-dashed border-primary/40 bg-background p-6"
      data-testid="quiz-bonus-locked"
    >
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Flame aria-hidden="true" className="size-5 text-primary" />
        {t('learn.bonus.lockedTitle')}
      </h2>
      <p>
        {t('learn.bonus.lockedBody', {
          needed: formatInteger(lock.needed),
          current: formatInteger(lock.current),
        })}
      </p>
      <Link
        to="/me/streak"
        className="inline-flex min-h-11 w-fit items-center gap-2 font-semibold text-primary hover:underline"
      >
        {t('streak.title')}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}

function QuizPanel(props: { lesson: LessonView; onSubmit: LessonPlayerProps['onSubmitQuiz'] }) {
  const { t, locale, formatInteger } = useI18n();
  const { lesson } = props;
  const [result, setResult] = useState<QuizResult | null>(lesson.lastResult);
  const [isRetaking, setIsRetaking] = useState(lesson.lastResult === null);
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: { answers: lesson.questions.map(() => null as number | null) },
    onSubmit: async ({ value }) => {
      const graded = await props.onSubmit(
        lesson.questions.map((q, i) => ({
          questionId: q.questionId,
          // A choice made before the page finished loading is only in the native radio state.
          chosenIndex: value.answers[i] ?? nativeChoice(formRef.current, q.questionId),
        })),
      );
      if (graded) {
        setResult(graded);
        setIsRetaking(false);
      }
    },
  });
  // Choices made before hydration live only in the DOM; copy them into the form state once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once after hydration by design
  useEffect(() => {
    lesson.questions.forEach((q, i) => {
      const choice = nativeChoice(formRef.current, q.questionId);
      if (choice !== null) form.setFieldValue(`answers[${i}]`, choice);
    });
  }, []);

  if (lesson.questions.length === 0) {
    return (
      <p className="border border-dashed border-primary/40 bg-background p-6">
        {t('learn.quiz.empty')}
      </p>
    );
  }

  if (result && !isRetaking) {
    const byId = new Map(result.answers.map((a) => [a.questionId, a]));
    return (
      <section className="flex max-w-3xl flex-col gap-5" data-testid="quiz-result">
        <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-primary bg-background p-5">
          <div className="flex flex-col">
            <span className="text-sm text-ink-muted">{t('learn.quiz.yourScore')}</span>
            <span className="text-4xl font-extrabold tabular-nums" data-testid="quiz-score">
              {formatInteger(result.score)}/{formatInteger(result.total)}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              form.reset();
              setIsRetaking(true);
            }}
            data-testid="quiz-retake"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t('learn.quiz.retake')}
          </Button>
        </div>
        {result.score < result.total ? (
          <p className="border border-omr/40 bg-omr-soft px-4 py-3 text-sm">
            {t('learn.quiz.vaultNote')}
          </p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {lesson.questions.map((q, qIndex) => {
            const answer = byId.get(q.questionId);
            const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
            const explanation = locale === 'bn' ? answer?.explanationBn : answer?.explanationEn;
            return (
              <li
                key={q.questionId}
                className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
                data-testid="quiz-result-question"
              >
                <p className="flex items-start gap-2 font-semibold">
                  {answer?.isCorrect ? (
                    <CheckCircle2
                      role="img"
                      aria-label={t('landing.vault.right')}
                      className="mt-0.5 size-5 shrink-0 text-pass"
                    />
                  ) : (
                    <XCircle
                      role="img"
                      aria-label={t('landing.vault.wrong')}
                      className="mt-0.5 size-5 shrink-0 text-omr"
                    />
                  )}
                  <span>
                    {formatInteger(qIndex + 1)}. {locale === 'bn' ? q.promptBn : q.promptEn}
                  </span>
                </p>
                <ul className="flex flex-col gap-1.5 pl-7">
                  {options.map((option, oIndex) => {
                    const isCorrect = answer?.correctIndex === oIndex;
                    const isChosen = answer?.chosenIndex === oIndex;
                    const tone = isCorrect
                      ? 'border-pass bg-pass text-ink-foreground'
                      : isChosen
                        ? 'border-omr bg-omr text-white'
                        : 'border-ink/25 text-ink-muted';
                    return (
                      <li key={LETTER_KEYS[oIndex]} className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${tone}`}
                        >
                          {t(LETTER_KEYS[oIndex] ?? 'landing.q.letter.a')}
                        </span>
                        <span
                          className={
                            isCorrect ? 'font-semibold' : isChosen ? 'line-through' : 'text-ink/75'
                          }
                        >
                          {option}
                        </span>
                        {isCorrect ? (
                          <span className="sr-only">{t('learn.quiz.correctAnswer')}</span>
                        ) : null}
                        {isChosen && !isCorrect ? (
                          <span className="sr-only">{t('learn.quiz.yourAnswer')}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {answer && answer.chosenIndex === null ? (
                  <p className="pl-7 text-sm text-omr">{t('learn.quiz.skipped')}</p>
                ) : null}
                {explanation ? <p className="pl-7 text-sm text-ink/75">{explanation}</p> : null}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <form
      ref={formRef}
      className="flex max-w-3xl flex-col gap-5"
      data-testid="quiz-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-ink/70">
        {t('learn.quiz.intro', { count: formatInteger(lesson.questions.length) })}
      </p>
      <ol className="flex flex-col gap-4">
        {lesson.questions.map((q, qIndex) => {
          const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
          return (
            <li key={q.questionId}>
              <form.Field name={`answers[${qIndex}]`}>
                {(field) => (
                  <fieldset
                    className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
                    data-testid="quiz-question"
                  >
                    <legend className="sr-only">
                      {t('learn.quiz.questionLabel', { n: formatInteger(qIndex + 1) })}
                    </legend>
                    <p className="font-semibold" aria-hidden="true">
                      {formatInteger(qIndex + 1)}. {locale === 'bn' ? q.promptBn : q.promptEn}
                    </p>
                    <span className="sr-only">{locale === 'bn' ? q.promptBn : q.promptEn}</span>
                    <div className="flex flex-col gap-1.5">
                      {options.map((option, oIndex) => {
                        const id = `q-${q.questionId}-${oIndex}`;
                        const isChosen = field.state.value === oIndex;
                        return (
                          <label
                            key={id}
                            htmlFor={id}
                            className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                          >
                            <input
                              id={id}
                              type="radio"
                              name={`q-${q.questionId}`}
                              value={oIndex}
                              defaultChecked={isChosen}
                              onChange={() => field.handleChange(oIndex)}
                              className="sr-only"
                              data-testid="quiz-option"
                            />
                            <span
                              aria-hidden="true"
                              className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                                isChosen
                                  ? 'border-ink bg-ink text-ink-foreground'
                                  : 'border-primary text-primary group-hover:bg-primary/10'
                              }`}
                            >
                              {t(LETTER_KEYS[oIndex] ?? 'landing.q.letter.a')}
                            </span>
                            <span>{option}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </form.Field>
            </li>
          );
        })}
      </ol>
      <form.Subscribe
        selector={(s) =>
          [s.isSubmitting, s.values.answers.filter((a) => a !== null).length] as const
        }
      >
        {([isSubmitting, answered]) => (
          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg" type="submit" disabled={isSubmitting} data-testid="quiz-submit">
              {t('learn.quiz.submit')}
            </Button>
            <span className="text-sm text-ink-muted tabular-nums">
              {t('learn.quiz.answered', {
                done: formatInteger(answered),
                total: formatInteger(lesson.questions.length),
              })}
            </span>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/** The option a radio group has checked in the DOM, or null. */
export function nativeChoice(form: HTMLFormElement | null, questionId: string): number | null {
  if (!form) return null;
  const raw = new FormData(form).get(`q-${questionId}`);
  const index = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(index) && index >= 0 && index <= 3 ? index : null;
}
