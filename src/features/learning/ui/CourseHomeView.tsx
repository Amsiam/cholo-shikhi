// A purchased course's learning dashboard: progress, a resume button, the full outline with a done
// mark per lesson, the access end date and the instructors.
import { Link } from '@tanstack/react-router';
import { ArrowRight, ClipboardList, Flame } from 'lucide-react';
import type { StudentExamCard } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { LearningCourse } from '../server/learning.types.ts';
import {
  DoneMark,
  LESSON_KIND_LABEL,
  LessonKindIcon,
  LocalText,
  learnContainer,
  ProgressBar,
} from './learning-parts.tsx';
import { AccessLine } from './MyCoursesView.tsx';
import { NpsPrompt } from './NpsPrompt.tsx';
import { LockedLessonMark, TrialBanner } from './TrialParts.tsx';

const ruled = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, oklch(1 0 0 / 0.1) 31px, oklch(1 0 0 / 0.1) 32px)',
};

/** US4.13: a streak-only bonus quiz shows the streak it needs, and whether it is open now. */
function BonusMark(props: { lesson: { streakBonusDays: number | null; isBonusLocked: boolean } }) {
  const { t, formatInteger } = useI18n();
  const days = props.lesson.streakBonusDays;
  if (!days) return null;
  const label = props.lesson.isBonusLocked
    ? t('learn.bonus.locked', { n: formatInteger(days) })
    : t('learn.bonus.open', { n: formatInteger(days) });
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${props.lesson.isBonusLocked ? 'text-ink-muted' : 'text-primary'}`}
      data-testid="course-home-bonus"
    >
      <Flame aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

export function CourseHomeView(props: {
  course: LearningCourse;
  exams?: StudentExamCard[];
  /** Answers the course NPS question (shown once the course is complete). */
  onNps?: (
    score: number | null,
  ) => Promise<{ ok: true } | { ok: false; error: { i18nKey: string } }>;
}) {
  const { t, locale, formatInteger } = useI18n();
  const { course } = props;
  const firstLessonId = course.sections.flatMap((s) => s.lessons)[0]?.lessonId ?? null;
  const resumeId = course.progress.nextLessonId ?? firstLessonId;
  const isDone = course.progress.total > 0 && course.progress.nextLessonId === null;
  let number = 0;
  return (
    <article className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink" data-testid="course-home">
      <header className="bg-primary text-primary-foreground" style={ruled}>
        <div
          className={`${learnContainer} grid gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end`}
        >
          <div className="flex flex-col gap-3">
            <Link
              to="/learn"
              className="tap-target w-fit text-sm font-medium opacity-85 hover:underline"
            >
              {t('learn.myCourses.title')}
            </Link>
            <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance break-words sm:text-4xl">
              {locale === 'bn' ? course.titleBn : course.titleEn}
            </h1>
            <p className="font-medium opacity-90">
              {locale === 'bn' ? course.goal.nameBn : course.goal.nameEn}
            </p>
            {course.trial ? (
              <TrialBanner courseId={course.courseId} trial={course.trial} tone="onPrimary" />
            ) : (
              <AccessLine endsAt={course.endsAt} courseId={course.courseId} tone="onPrimary" />
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-sm bg-primary-foreground/10 p-4">
            <p className="flex items-end justify-between gap-2">
              <span
                className="text-4xl font-extrabold tabular-nums"
                data-testid="course-home-percent"
              >
                {formatInteger(course.progress.percent)}%
              </span>
              <span className="text-sm opacity-90">
                {t('learn.progress', {
                  done: formatInteger(course.progress.completed),
                  total: formatInteger(course.progress.total),
                })}
              </span>
            </p>
            <ProgressBar
              tone="light"
              percent={course.progress.percent}
              label={t('learn.progressLabel', { percent: formatInteger(course.progress.percent) })}
            />
            {resumeId ? (
              <Link
                to="/learn/$courseId/lessons/$lessonId"
                params={{ courseId: course.courseId, lessonId: resumeId }}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-primary-foreground px-5 font-semibold text-primary hover:bg-primary-foreground/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-foreground/60"
                data-testid="course-home-resume"
              >
                {t(
                  isDone
                    ? 'learn.review'
                    : course.progress.completed === 0
                      ? 'learn.start'
                      : 'learn.continue',
                )}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className={`${learnContainer} grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_18rem]`}>
        {course.askNps && props.onNps ? (
          <div className="lg:col-span-2">
            <NpsPrompt onAnswer={props.onNps} />
          </div>
        ) : null}
        <section aria-labelledby="course-home-outline" className="flex min-w-0 flex-col gap-4">
          <h2 id="course-home-outline" className="text-2xl font-bold">
            {t('catalog.course.outline')}
          </h2>
          <ol className="flex flex-col gap-4" data-testid="course-home-sections">
            {course.sections.map((section, sIndex) => {
              const done = section.lessons.filter((l) => l.isCompleted).length;
              return (
                <li key={section.sectionId} className="border border-primary/20 bg-background">
                  <div className="flex items-center justify-between gap-3 border-b border-primary/15 px-5 py-3">
                    <h3 className="flex items-center gap-3 font-semibold">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-primary text-xs font-bold text-primary tabular-nums">
                        {formatInteger(sIndex + 1)}
                      </span>
                      <span className="break-words">
                        {locale === 'bn' ? section.titleBn : section.titleEn}
                      </span>
                    </h3>
                    <span className="shrink-0 text-sm text-ink-muted tabular-nums">
                      {formatInteger(done)}/{formatInteger(section.lessons.length)}
                    </span>
                  </div>
                  <ul className="divide-y divide-primary/10">
                    {section.lessons.map((lesson) => {
                      number += 1;
                      return (
                        <li key={lesson.lessonId}>
                          {lesson.isLocked ? (
                            <div
                              className="flex min-h-12 items-center gap-3 px-5 py-2.5 text-ink-muted"
                              data-testid="course-home-lesson-locked"
                            >
                              <DoneMark isDone={lesson.isCompleted} />
                              <span className="w-6 shrink-0 text-sm text-ink-muted tabular-nums">
                                {formatInteger(number)}
                              </span>
                              <span className="min-w-0 flex-1 break-words">
                                <LocalText bn={lesson.titleBn} en={lesson.titleEn} />
                              </span>
                              <span className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase sm:inline-flex">
                                <LessonKindIcon kind={lesson.kind} />
                                {t(LESSON_KIND_LABEL[lesson.kind])}
                              </span>
                              <LockedLessonMark />
                            </div>
                          ) : (
                            <Link
                              to="/learn/$courseId/lessons/$lessonId"
                              params={{ courseId: course.courseId, lessonId: lesson.lessonId }}
                              className="flex min-h-12 items-center gap-3 px-5 py-2.5 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                              data-testid="course-home-lesson"
                            >
                              <DoneMark isDone={lesson.isCompleted} />
                              <span className="w-6 shrink-0 text-sm text-ink-muted tabular-nums">
                                {formatInteger(number)}
                              </span>
                              <span className="min-w-0 flex-1 break-words">
                                <LocalText bn={lesson.titleBn} en={lesson.titleEn} />
                              </span>
                              <span className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase sm:inline-flex">
                                <LessonKindIcon kind={lesson.kind} />
                                {t(LESSON_KIND_LABEL[lesson.kind])}
                              </span>
                              <BonusMark lesson={lesson} />
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 border border-primary/20 bg-background p-5">
            <h2 className="text-lg font-bold">{t('catalog.course.instructors')}</h2>
            <ul className="flex flex-col gap-3">
              {course.instructors.map((i) => (
                <li key={i.instructorId} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground"
                  >
                    {Array.from(i.displayName.trim())[0] ?? ''}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold break-words">
                      {i.displayName || t('catalog.course.unnamedInstructor')}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {t(
                        i.role === 'lead'
                          ? 'catalog.course.role.lead'
                          : 'catalog.course.role.co_instructor',
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {props.exams && props.exams.length > 0 ? (
            <section
              aria-labelledby="course-home-exams"
              className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
              data-testid="course-home-exams"
            >
              <h2 id="course-home-exams" className="flex items-center gap-2 text-lg font-bold">
                <ClipboardList aria-hidden="true" className="size-5 text-primary" />
                {t('exams.course.title')}
              </h2>
              <ul className="flex flex-col divide-y divide-primary/10">
                {props.exams.map((e) => (
                  <li key={e.examId} className="flex flex-col gap-1 py-2">
                    <Link
                      to={e.canStart ? '/exams/$examId' : '/exams'}
                      params={{ examId: e.examId }}
                      preload={false}
                      className="tap-target font-semibold text-primary hover:underline"
                    >
                      {locale === 'bn' ? e.titleBn : e.titleEn}
                    </Link>
                    <span className="text-xs text-ink-muted">
                      {t('exams.questions', { n: formatInteger(e.questionCount) })} ·{' '}
                      {t('exams.minutes', { n: formatInteger(e.durationMinutes) })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
