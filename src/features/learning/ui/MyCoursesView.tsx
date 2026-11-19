// My courses: every course the Student has purchased (an active enrolment), with progress, the
// access end date, and a button that resumes at the first unfinished lesson.
import { Link } from '@tanstack/react-router';
import { ArrowRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { accessState } from '#src/lib/access-window.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MyCourse } from '../server/learning.types.ts';
import { learnContainer, ProgressBar } from './learning-parts.tsx';
import { TrialBanner } from './TrialParts.tsx';

/** Access end date; in its last 14 days a red-pen warning with the days left (FR-DIST-4). */
export function AccessLine(props: {
  endsAt: string;
  courseId?: string;
  tone?: 'paper' | 'onPrimary';
}) {
  const { t, formatDate, formatInteger } = useI18n();
  const access = accessState(new Date(props.endsAt), new Date());
  if (access.isExpiringSoon) {
    return (
      <p
        className={`flex w-fit items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-semibold ${props.tone === 'onPrimary' ? 'bg-primary-foreground text-omr' : 'bg-omr-soft text-omr'}`}
        data-testid="access-expiring"
      >
        <Clock aria-hidden="true" className="size-4" />
        {t('learn.access.expiresIn', {
          days: formatInteger(access.daysLeft),
          date: formatDate(props.endsAt),
        })}
        {props.courseId ? (
          <Link
            to="/courses/$courseId"
            params={{ courseId: props.courseId }}
            className="ml-1 underline underline-offset-2"
            data-testid="access-renew"
          >
            {t('catalog.course.renew')}
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <p className={`text-sm ${props.tone === 'onPrimary' ? 'opacity-85' : 'text-ink-muted'}`}>
      {t('learn.accessUntil', { date: formatDate(props.endsAt) })}
    </p>
  );
}

export function MyCoursesView(props: { courses: readonly MyCourse[] }) {
  const { t, locale, formatInteger } = useI18n();
  const [query, setQuery] = useState('');
  const q = query.trim().toLocaleLowerCase();
  const shown = q
    ? props.courses.filter((c) =>
        [c.titleBn, c.titleEn, c.goal.nameBn, c.goal.nameEn].some((x) =>
          x.toLocaleLowerCase().includes(q),
        ),
      )
    : props.courses;
  const hasSearch = props.courses.length > 2;
  return (
    <section
      className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink"
      data-testid="my-courses-page"
    >
      <header className="border-b border-primary/15 bg-background">
        <div className={`${learnContainer} flex flex-col gap-2 py-8`}>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t('learn.myCourses.title')}
          </h1>
          <p className="text-ink/70">
            {t('learn.myCourses.count', { count: formatInteger(props.courses.length) })}
          </p>
          {hasSearch ? (
            <div className="mt-2 grid max-w-md gap-1.5">
              <label htmlFor="my-courses-search" className="text-sm font-medium">
                {t('learn.myCourses.search')}
              </label>
              <input
                id="my-courses-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 w-full rounded-sm border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
                data-testid="my-courses-search"
              />
            </div>
          ) : null}
        </div>
      </header>
      <div className={`${learnContainer} py-8`}>
        {props.courses.length === 0 ? (
          <div
            className="flex flex-col items-start gap-3 border border-dashed border-primary/40 bg-background p-8"
            data-testid="my-courses-empty"
          >
            <p className="text-lg">{t('learn.myCourses.empty')}</p>
            <Link
              to="/catalog"
              search={{}}
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
            >
              {t('landing.hero.browse')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        ) : (
          <>
            {shown.length === 0 ? (
              <p className="text-ink-muted" role="status">
                {t('learn.myCourses.noMatch')}
              </p>
            ) : null}
            <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="my-courses-list">
              {shown.map((course) => {
                const isDone = course.progress.total > 0 && course.progress.nextLessonId === null;
                return (
                  <li
                    key={course.courseId}
                    className="flex flex-col gap-4 border border-primary/20 bg-background p-5"
                    data-testid="my-course"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold tracking-wide text-primary uppercase">
                        {locale === 'bn' ? course.goal.nameBn : course.goal.nameEn}
                      </span>
                      <h2 className="text-lg leading-snug font-bold break-words">
                        <Link
                          to="/learn/$courseId"
                          params={{ courseId: course.courseId }}
                          className="hover:text-primary hover:underline"
                        >
                          {locale === 'bn' ? course.titleBn : course.titleEn}
                        </Link>
                      </h2>
                    </div>
                    <div className="flex flex-col gap-2">
                      <ProgressBar
                        percent={course.progress.percent}
                        label={t('learn.progressLabel', {
                          percent: formatInteger(course.progress.percent),
                        })}
                      />
                      <p className="flex justify-between gap-2 text-sm text-ink/70">
                        <span>
                          {t('learn.progress', {
                            done: formatInteger(course.progress.completed),
                            total: formatInteger(course.progress.total),
                          })}
                        </span>
                        <span className="tabular-nums">
                          {formatInteger(course.progress.percent)}%
                        </span>
                      </p>
                    </div>
                    {course.trial ? (
                      <TrialBanner courseId={course.courseId} trial={course.trial} />
                    ) : (
                      <AccessLine endsAt={course.endsAt} courseId={course.courseId} />
                    )}
                    <div className="mt-auto flex flex-wrap gap-2">
                      {course.progress.nextLessonId ? (
                        <Link
                          to="/learn/$courseId/lessons/$lessonId"
                          params={{
                            courseId: course.courseId,
                            lessonId: course.progress.nextLessonId,
                          }}
                          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          data-testid="my-course-continue"
                        >
                          {t(course.progress.completed === 0 ? 'learn.start' : 'learn.continue')}
                          <ArrowRight aria-hidden="true" className="size-4" />
                        </Link>
                      ) : null}
                      <Link
                        to="/learn/$courseId"
                        params={{ courseId: course.courseId }}
                        className={`inline-flex min-h-11 items-center justify-center rounded-sm border border-primary/40 px-4 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${isDone ? 'flex-1' : ''}`}
                      >
                        {t('learn.openCourse')}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
