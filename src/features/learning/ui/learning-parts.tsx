// Small pieces shared by the learning screens.
import { CheckCircle2, Circle, FileText, ListChecks, PlayCircle } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';

export const learnContainer = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

export const LESSON_KIND_LABEL = {
  video: 'catalog.course.lessonKind.video',
  text: 'catalog.course.lessonKind.text',
  quiz: 'catalog.course.lessonKind.quiz',
} as const;

export function LessonKindIcon(props: { kind: 'video' | 'text' | 'quiz'; className?: string }) {
  const Icon = props.kind === 'video' ? PlayCircle : props.kind === 'quiz' ? ListChecks : FileText;
  return <Icon aria-hidden="true" className={props.className ?? 'size-4'} />;
}

export function DoneMark(props: { isDone: boolean }) {
  const { t } = useI18n();
  return props.isDone ? (
    <CheckCircle2
      role="img"
      aria-label={t('learn.lesson.done')}
      className="size-5 shrink-0 text-pass"
    />
  ) : (
    <Circle
      role="img"
      aria-label={t('learn.lesson.notDone')}
      className="size-5 shrink-0 text-ink-muted"
    />
  );
}

export function ProgressBar(props: { percent: number; label: string; tone?: 'light' | 'dark' }) {
  const track = props.tone === 'light' ? 'bg-primary-foreground/25' : 'bg-primary/15';
  const fill = props.tone === 'light' ? 'bg-primary-foreground' : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.percent}
      aria-label={props.label}
      className={`h-2 w-full overflow-hidden rounded-full ${track}`}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${props.percent}%` }} />
    </div>
  );
}

/** A bilingual title in the active language, falling back to the other one, marked with its lang. */
export function LocalText(props: { bn: string | null; en: string | null; fallback?: string }) {
  const { locale } = useI18n();
  const own = locale === 'bn' ? props.bn : props.en;
  if (own) return <>{own}</>;
  const other = locale === 'bn' ? props.en : props.bn;
  if (other) return <span lang={locale === 'bn' ? 'en' : 'bn'}>{other}</span>;
  return <>{props.fallback ?? ''}</>;
}
