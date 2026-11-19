// S2 Student home dashboard. It shows only what the platform actually records today: the Student's
// goal, the published courses for it, and their notifications. Enrolment, the Mistake Vault and the
// streak ship with later modules, so their panels show the S2 wireframe's empty states (with a way
// forward) instead of invented numbers.
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Flame,
  GraduationCap,
  Library,
  RotateCcw,
  Settings,
  Shield,
} from 'lucide-react';
import type { CourseCard } from '#src/features/catalog/server/catalog-browse.types.ts';
import { CourseResultCard } from '#src/features/catalog/ui/CourseFinder.tsx';
import type { MyCourse } from '#src/features/learning/server/learning.types.ts';
import { ContinueCard } from '#src/features/learning/ui/ContinueCard.tsx';
import type { NotificationItem } from '#src/features/notifications/ui/NotificationList.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

export type StudentDashboardProps = {
  displayName: string;
  goal: { goalId: string; nameBn: string; nameEn: string } | null;
  courses: readonly CourseCard[];
  totalCourses: number;
  notifications: readonly NotificationItem[];
  unread: number;
  /** Counts for the stat cards; enrolments and vault questions come from route adapters. */
  stats: { enrolled: number; vaultQuestions: number };
  /** The goal streak (FR-RTN-1); null while it cannot be read. */
  streak?: {
    current: number;
    best: number;
    isActiveToday: boolean;
    week: ReadonlyArray<{ day: string; isActive: boolean; isShielded?: boolean }>;
    /** Streak-tokens held and unused streak-shields (US5.3, US5.16). */
    tokens?: number;
    shieldsAvailable?: number;
  } | null;
  /** The Student's purchased courses with progress, newest first (a few for the panel). */
  myCourses: readonly MyCourse[];
  /** The course to continue (most recently active), if any. */
  resume?: MyCourse | null;
  isVerified?: boolean;
};

const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
const ruled = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, oklch(1 0 0 / 0.1) 31px, oklch(1 0 0 / 0.1) 32px)',
};
const linkAction =
  'inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
const panel = 'flex flex-col gap-4 border border-primary/20 bg-background p-5';

/**
 * The goal streak (FR-RTN-1) as a row of answer bubbles for the last seven days: a filled bubble
 * is a day with a lesson, quiz or vault practice for this goal; today's bubble is ringed.
 */
function StreakStrip(props: { streak: NonNullable<StudentDashboardProps['streak']> }) {
  const { t, locale, formatInteger } = useI18n();
  const s = props.streak;
  const weekday = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    weekday: 'narrow',
    timeZone: 'UTC',
  });
  const message = s.isActiveToday
    ? 'dashboard.streak.doneToday'
    : s.current > 0
      ? 'dashboard.streak.keepAlive'
      : 'dashboard.streak.start';
  return (
    <section
      aria-labelledby="dashboard-streak-title"
      className="flex shrink-0 flex-col gap-3 border border-primary-foreground/25 bg-primary-foreground/10 p-4 sm:p-5"
      data-testid="dashboard-streak"
    >
      <div className="flex items-center gap-3">
        <Flame aria-hidden="true" className="size-7" />
        <p id="dashboard-streak-title" className="flex items-baseline gap-2">
          <span
            className="text-4xl leading-none font-extrabold tabular-nums"
            data-testid="streak-current"
          >
            {formatInteger(s.current)}
          </span>
          <span className="font-semibold">{t('dashboard.streak.days')}</span>
        </p>
      </div>
      <ol className="flex gap-2" aria-label={t('dashboard.streak.week')}>
        {s.week.map((d, i) => {
          const isToday = i === s.week.length - 1;
          return (
            <li key={d.day} className="flex flex-col items-center gap-1">
              <span
                className={`grid size-6 place-items-center rounded-full border-2 border-primary-foreground ${d.isActive ? 'bg-primary-foreground' : d.isShielded ? 'bg-transparent' : 'bg-transparent opacity-60'} ${isToday ? 'ring-2 ring-primary-foreground/50 ring-offset-2 ring-offset-primary' : ''}`}
              >
                {d.isShielded && !d.isActive ? (
                  <Shield aria-hidden="true" className="size-3.5" />
                ) : null}
                <span className="sr-only">
                  {t(
                    d.isActive
                      ? 'dashboard.streak.active'
                      : d.isShielded
                        ? 'dashboard.streak.shielded'
                        : 'dashboard.streak.missed',
                    { day: weekday.format(new Date(`${d.day}T12:00:00Z`)) },
                  )}
                </span>
              </span>
              <span aria-hidden="true" className="text-xs opacity-80">
                {weekday.format(new Date(`${d.day}T12:00:00Z`))}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm opacity-90">{t(message)}</p>
      {s.best > s.current ? (
        <p className="text-xs opacity-75">
          {t('dashboard.streak.best', { n: formatInteger(s.best) })}
        </p>
      ) : null}
      <Link
        to="/me/streak"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50"
        data-testid="dashboard-streak-rewards"
      >
        {t('dashboard.streak.rewards', {
          tokens: formatInteger(s.tokens ?? 0),
          shields: formatInteger(s.shieldsAvailable ?? 0),
        })}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}

export function StudentDashboard(props: StudentDashboardProps) {
  const { t, locale, formatInteger } = useI18n();
  const goalName = props.goal ? (locale === 'bn' ? props.goal.nameBn : props.goal.nameEn) : '';
  const name = props.displayName.trim();
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink" data-testid="home-page">
      <header className="bg-primary text-primary-foreground" style={ruled}>
        <div
          className={`${container} flex flex-col gap-8 py-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between`}
        >
          <div className="flex min-w-0 flex-col gap-5">
            {props.isVerified ? (
              <p
                role="status"
                className="w-fit rounded-sm bg-primary-foreground/15 px-3 py-1.5 text-sm font-medium"
                data-testid="home-verified"
              >
                {t('home.verified')}
              </p>
            ) : null}
            <h1
              className="text-3xl leading-tight font-extrabold tracking-tight text-balance sm:text-4xl"
              data-testid="home-greeting"
            >
              {name ? t('dashboard.greeting', { name }) : t('dashboard.greetingNoName')}
            </h1>
            {props.goal ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="flex items-center gap-2 text-lg">
                  <span className="opacity-85">{t('dashboard.goal.label')}</span>
                  <span
                    className="inline-flex items-center gap-2 rounded-sm bg-primary-foreground px-3 py-1 font-semibold text-primary"
                    data-testid="dashboard-goal"
                  >
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
                    {goalName}
                  </span>
                </p>
                <Link
                  to="/me/goal"
                  className="tap-target text-sm font-medium underline underline-offset-4 opacity-90 hover:opacity-100"
                  data-testid="dashboard-change-goal"
                >
                  {t('dashboard.goal.change')}
                </Link>
              </div>
            ) : null}
          </div>
          {props.goal && props.streak ? <StreakStrip streak={props.streak} /> : null}
        </div>
      </header>

      {props.resume ? (
        <div className={`${container} pt-8`}>
          <ContinueCard course={props.resume} />
        </div>
      ) : null}

      <section aria-label={t('dashboard.stats.label')} className={`${container} pt-8`}>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="dashboard-stats">
          <StatCard
            icon={GraduationCap}
            value={props.stats.enrolled}
            label={t('dashboard.stats.enrolled')}
            testId="stat-enrolled"
          />
          <StatCard
            icon={Library}
            value={props.totalCourses}
            label={t('dashboard.stats.available')}
            testId="stat-available"
          />
          <StatCard
            icon={RotateCcw}
            value={props.stats.vaultQuestions}
            label={t('dashboard.stats.vault')}
            testId="stat-vault"
            tone="omr"
          />
          <StatCard
            icon={Bell}
            value={props.unread}
            label={t('dashboard.stats.unread')}
            testId="stat-unread"
          />
        </ul>
      </section>

      <div className={`${container} grid gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]`}>
        <div className="flex min-w-0 flex-col gap-6">
          {props.goal ? null : (
            <section className={`${panel} border-2 border-primary`} data-testid="dashboard-no-goal">
              <h2 className="text-xl font-bold">{t('dashboard.goal.none.title')}</h2>
              <Link to="/goals" className={linkAction}>
                {t('dashboard.goal.none.action')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </section>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <section
              aria-labelledby="dashboard-vault-title"
              className="flex flex-col gap-3 border-2 border-omr bg-background p-5"
              data-testid="dashboard-vault"
            >
              <h2 id="dashboard-vault-title" className="flex items-center gap-2 text-lg font-bold">
                <RotateCcw aria-hidden="true" className="size-5 text-omr" />
                {t('dashboard.vault.title')}
              </h2>
              {/* The count and this text must agree: the vault is empty only when nothing was missed. */}
              {props.stats.vaultQuestions === 0 ? (
                <>
                  <p className="text-ink/75" data-testid="dashboard-vault-empty">
                    {t('dashboard.vault.empty')}
                  </p>
                  <Link to="/catalog" search={{}} className={`${linkAction} mt-auto text-omr`}>
                    {t('landing.hero.browse')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </>
              ) : null}
              {props.stats.vaultQuestions > 0 ? (
                <>
                  <p className="text-ink/75" data-testid="dashboard-vault-waiting">
                    {t('dashboard.vault.waiting', {
                      count: formatInteger(props.stats.vaultQuestions),
                    })}
                  </p>
                  <Link to="/vault" className={`${linkAction} mt-auto text-omr`}>
                    {t('dashboard.vault.practise')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </>
              ) : null}
            </section>

            <section
              aria-labelledby="dashboard-my-courses-title"
              className={panel}
              data-testid="dashboard-my-courses"
            >
              <h2
                id="dashboard-my-courses-title"
                className="flex items-center gap-2 text-lg font-bold"
              >
                <BookOpen aria-hidden="true" className="size-5 text-primary" />
                {t('dashboard.myCourses.title')}
              </h2>
              {props.myCourses.length === 0 ? (
                <>
                  <p className="text-ink/75">{t('dashboard.myCourses.empty')}</p>
                  <Link
                    to="/catalog"
                    search={props.goal ? { goal: props.goal.goalId } : {}}
                    className={`${linkAction} mt-auto`}
                  >
                    {t('landing.hero.browse')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </>
              ) : (
                <>
                  <ul className="flex flex-col gap-3" data-testid="dashboard-my-courses-list">
                    {props.myCourses.map((course) => (
                      <li key={course.courseId}>
                        <Link
                          to="/learn/$courseId"
                          params={{ courseId: course.courseId }}
                          className="flex flex-col gap-1.5 rounded-sm px-1 py-1 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <span className="font-semibold break-words">
                            {locale === 'bn' ? course.titleBn : course.titleEn}
                          </span>
                          <span
                            className="h-1.5 overflow-hidden rounded-full bg-primary/15"
                            aria-hidden="true"
                          >
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${course.progress.percent}%` }}
                            />
                          </span>
                          <span className="text-xs text-ink-muted">
                            {t('learn.progress', {
                              done: formatInteger(course.progress.completed),
                              total: formatInteger(course.progress.total),
                            })}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/learn"
                    className={`${linkAction} mt-auto`}
                    data-testid="dashboard-my-courses-all"
                  >
                    {t('learn.myCourses.all')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </>
              )}
            </section>
          </div>

          {props.goal ? (
            <section
              aria-labelledby="dashboard-courses-title"
              className="flex flex-col gap-4"
              data-testid="dashboard-courses"
            >
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 id="dashboard-courses-title" className="text-2xl font-bold text-balance">
                  {t('dashboard.courses.title', { goal: goalName })}
                </h2>
                {props.totalCourses > 0 ? (
                  <Link
                    to="/catalog"
                    search={{ goal: props.goal.goalId }}
                    className={linkAction}
                    data-testid="dashboard-courses-all"
                  >
                    {t('dashboard.courses.all')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                ) : null}
              </div>
              {props.courses.length > 0 ? (
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {props.courses.map((card) => (
                    <CourseResultCard key={card.courseId} card={card} />
                  ))}
                </ul>
              ) : (
                <p className="border border-dashed border-primary/40 bg-background p-6">
                  {t('catalog.finder.empty')}
                </p>
              )}
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <section
            aria-labelledby="dashboard-notifications-title"
            className={panel}
            data-testid="dashboard-notifications"
          >
            <h2
              id="dashboard-notifications-title"
              className="flex items-center justify-between gap-2 text-lg font-bold"
            >
              <span className="flex items-center gap-2">
                <Bell aria-hidden="true" className="size-5 text-primary" />
                {t('shell.nav.notifications')}
              </span>
              {props.unread > 0 ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                  {t('dashboard.notifications.unread', { count: props.unread })}
                </span>
              ) : null}
            </h2>
            {props.notifications.length === 0 ? (
              <p className="text-ink/70">{t('notifications.empty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-primary/10">
                {props.notifications.map((item) => (
                  <li key={item.notificationId} className="flex flex-col gap-0.5 py-2.5">
                    <span className={item.isRead ? 'text-ink/80' : 'font-semibold'}>
                      {item.title}
                    </span>
                    <span className="line-clamp-2 text-sm text-ink-muted">{item.body}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/notifications" className={linkAction}>
              {t('dashboard.notifications.all')}
            </Link>
          </section>

          <section aria-labelledby="dashboard-account-title" className={panel}>
            <h2 id="dashboard-account-title" className="flex items-center gap-2 text-lg font-bold">
              <Settings aria-hidden="true" className="size-5 text-primary" />
              {t('dashboard.account.title')}
            </h2>
            <Link to="/me" className={linkAction} data-testid="dashboard-settings">
              {t('dashboard.account.settings')}
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatCard(props: {
  icon: typeof Bell;
  value: number;
  label: string;
  testId: string;
  tone?: 'primary' | 'omr';
}) {
  const { formatInteger } = useI18n();
  const accent = props.tone === 'omr' ? 'text-omr bg-omr-soft' : 'text-primary bg-primary/10';
  return (
    <li
      className="flex flex-col gap-3 border border-primary/20 bg-background p-4 sm:flex-row sm:items-center sm:p-5"
      data-testid={props.testId}
    >
      <span
        aria-hidden="true"
        className={`flex size-11 shrink-0 items-center justify-center rounded-sm ${accent}`}
      >
        <props.icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className="text-3xl leading-none font-extrabold tabular-nums"
          data-testid={`${props.testId}-value`}
        >
          {formatInteger(props.value)}
        </span>
        <span className="mt-1 text-sm text-ink/70">{props.label}</span>
      </span>
    </li>
  );
}
