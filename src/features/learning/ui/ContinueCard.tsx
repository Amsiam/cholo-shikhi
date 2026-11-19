// "Continue where you left off": the course the Student worked on most recently and its next
// unfinished lesson, one tap away.
import { Link } from '@tanstack/react-router';
import { ArrowRight, BookOpen, CircleHelp, FileText, PlayCircle } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MyCourse } from '../server/learning.types.ts';

const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;
const KIND_ICON = { video: PlayCircle, text: FileText, quiz: CircleHelp } as const;

/** The course to resume: most recently active with a lesson left, else the first with one. */
export function resumeCourse(courses: readonly MyCourse[]): MyCourse | null {
  const open = courses.filter((c) => c.nextLesson !== null);
  const active = open
    .filter((c) => c.lastActiveAt !== null)
    .sort((a, b) => (b.lastActiveAt as string).localeCompare(a.lastActiveAt as string));
  return active[0] ?? open[0] ?? null;
}

export function ContinueCard(props: { course: MyCourse }) {
  const { t, locale, formatInteger } = useI18n();
  const c = props.course;
  const next = c.nextLesson;
  if (!next) return null;
  const Icon = KIND_ICON[next.kind] ?? BookOpen;
  return (
    <section
      aria-labelledby="continue-title"
      className="flex flex-col gap-4 border-2 border-primary bg-background p-5 sm:flex-row sm:items-center sm:justify-between"
      data-testid="continue-card"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id="continue-title" className="text-sm font-semibold text-primary">
          {t(c.lastActiveAt ? 'continue.title' : 'continue.start')}
        </h2>
        <p className="text-lg font-bold break-words">{pick(c.titleBn, c.titleEn, locale)}</p>
        <p className="flex items-center gap-1.5 text-sm text-ink/80">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 break-words">{pick(next.titleBn, next.titleEn, locale)}</span>
        </p>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          <span aria-hidden="true" className="h-1.5 w-32 overflow-hidden rounded-full bg-ink/10">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${c.progress.percent}%` }}
            />
          </span>
          {t('continue.progress', {
            done: formatInteger(c.progress.completed),
            total: formatInteger(c.progress.total),
          })}
        </span>
      </div>
      <Link
        to="/learn/$courseId/lessons/$lessonId"
        params={{ courseId: c.courseId, lessonId: next.lessonId }}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-sm bg-primary px-6 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-testid="continue-go"
      >
        {t('learn.continue')}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
