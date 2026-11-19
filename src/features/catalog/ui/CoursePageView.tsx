// S4 course page (UC6, US2.2). Server-rendered text and price come first; the cover is a placeholder
// while catalog.imageUploads is off and any image loads lazily (BR11.9). Before Buy it shows the Lead
// and the Co-instructors with their sections, the access duration, the price, the description and
// the outline of section and lesson titles, with no previews (BR11.8, BR7.5). Buy becomes Continue
// when the route's Entitlements read says the Student is enrolled (BR11.10). Each published Practice
// Pack is a separate item with its own price (BR11.8); buying one needs an enrolment (BR10.10, U3).
// On the public course page an anonymous visitor sees the same page with a sign-up prompt in place
// of Buy, and no other-Goal note (a visitor has no Goal).
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import type { CoursePage } from '../server/catalog-browse.types.ts';
import { catalogContainer } from './CatalogView.tsx';
import { localTitle } from './fields.tsx';
import { BuyProductButton } from './ProductBuy.tsx';

export type CoursePageViewProps = {
  page: CoursePage;
  isEnrolled: boolean;
  /** In the last 14 days of access the Student can renew from the end date (FR-DIST-4). */
  canRenew?: boolean;
  /** Free trial state for a signed-in Student (FR-DIST-1). */
  trialState?: 'none' | 'available' | 'active' | 'used' | 'usedElsewhere';
  onStartTrial?: () => void;
  /** Admin only: make this course its segment's free trial course, or stop it being one. */
  adminTrial?: { isTrialCourse: boolean; onSet: () => void; onClear: () => void } | undefined;
  /** Checkout ships with U3; until then Buy is shown but cannot start a purchase. */
  onBuy?: () => void;
  /** Shown above Buy for a signed-in buyer (Marketing's promo code field, composed by the route). */
  buyExtra?: ReactNode;
  onContinue?: () => void;
  /** The public course page: an anonymous visitor is asked to create an account instead. */
  isPublic?: boolean;
};

/** BR3.3: a bilingual-one field falls back to the other language, marked with its own lang. */
export function fallbackText(
  valueBn: string | null,
  valueEn: string | null,
  locale: 'bn' | 'en',
): { text: string; lang: 'bn' | 'en' } | null {
  const own = locale === 'bn' ? valueBn : valueEn;
  if (own) return { text: own, lang: locale };
  const other = locale === 'bn' ? valueEn : valueBn;
  return other ? { text: other, lang: locale === 'bn' ? 'en' : 'bn' } : null;
}

const LESSON_KIND = {
  video: 'catalog.course.lessonKind.video',
  text: 'catalog.course.lessonKind.text',
  quiz: 'catalog.course.lessonKind.quiz',
} as const;

const ruledTeal = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0, transparent 23px, oklch(1 0 0 / 0.12) 23px, oklch(1 0 0 / 0.12) 24px)',
};

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

export function CoursePageView({
  page,
  isEnrolled,
  canRenew = false,
  trialState = 'none',
  onStartTrial,
  adminTrial,
  onBuy,
  buyExtra,
  onContinue,
  isPublic = false,
}: CoursePageViewProps) {
  const { t, locale, formatInteger } = useI18n();
  const description = fallbackText(page.descriptionBn, page.descriptionEn, locale);
  const goalName = locale === 'bn' ? page.goal.nameBn : page.goal.nameEn;
  const lessonCount = page.outline.reduce((sum, section) => sum + section.lessons.length, 0);
  return (
    <article className="bg-paper text-ink" data-testid="course-page">
      <header className="bg-primary text-primary-foreground" style={ruledTeal}>
        <div className={`${catalogContainer} flex flex-col gap-4 py-10 lg:py-14`}>
          <Link
            to="/catalog"
            search={{ goal: page.goal.goalId }}
            className="tap-target w-fit text-sm font-medium underline-offset-4 opacity-85 hover:underline hover:opacity-100"
          >
            {t('catalog.course.backToCatalog')}
          </Link>
          <h1
            className="max-w-3xl text-3xl leading-tight font-extrabold tracking-tight text-balance break-words sm:text-5xl"
            data-testid="course-page-title"
          >
            {localTitle(page, locale)}
          </h1>
          <p className="flex items-center gap-2 font-medium opacity-90">
            <span aria-hidden="true" className="size-3 rounded-full bg-primary-foreground" />
            {goalName}
          </p>
          <p className="text-primary-foreground/85">
            {t('catalog.course.lessonCount', { count: formatInteger(lessonCount) })}
            {' · '}
            {t('catalog.browse.duration', { months: formatInteger(page.accessDurationMonths) })}
          </p>
        </div>
      </header>

      <div
        className={`${catalogContainer} grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start`}
      >
        <div className="flex min-w-0 flex-col gap-10">
          {page.isCurrentGoal || isPublic ? null : (
            <p
              role="note"
              className="border border-omr/40 bg-omr-soft px-4 py-3 text-sm"
              data-testid="course-page-other-goal"
            >
              {t('catalog.course.otherGoal', { goal: goalName })}
            </p>
          )}
          {description ? (
            <p
              lang={description.lang}
              data-testid="course-page-description"
              className="max-w-prose text-lg leading-relaxed break-words text-ink/85"
            >
              {description.text}
            </p>
          ) : null}

          <section className="flex flex-col gap-4" aria-labelledby="course-page-outline-heading">
            <h2 id="course-page-outline-heading" className="text-2xl font-bold">
              {t('catalog.course.outline')}
            </h2>
            <ol
              className="flex flex-col divide-y divide-primary/15 border border-primary/25 bg-background"
              data-testid="course-page-outline"
            >
              {page.outline.map((x, index) => (
                <li
                  key={x.sectionId}
                  data-testid="course-page-section"
                  className="flex flex-col gap-3 p-5"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-primary text-sm font-bold text-primary tabular-nums">
                      {formatInteger(index + 1)}
                    </span>
                    <span className="text-lg font-semibold break-words">
                      {localTitle(x, locale)}
                    </span>
                  </div>
                  {x.lessons.length > 0 ? (
                    <ul className="flex flex-col gap-2 pl-11 text-sm">
                      {x.lessons.map((lesson) => {
                        const title = fallbackText(lesson.titleBn, lesson.titleEn, locale);
                        return (
                          <li
                            key={lesson.lessonId}
                            data-testid="course-page-lesson"
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                          >
                            <span className="inline-flex w-16 shrink-0 text-xs font-semibold tracking-wide text-primary uppercase">
                              {t(LESSON_KIND[lesson.kind])}
                            </span>{' '}
                            {title ? (
                              <span lang={title.lang} className="min-w-0 break-words">
                                {title.text}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section
            className="flex flex-col gap-4"
            aria-labelledby="course-page-instructors-heading"
          >
            <h2 id="course-page-instructors-heading" className="text-2xl font-bold">
              {t('catalog.course.instructors')}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2" data-testid="course-page-instructors">
              {page.instructors.map((instructor) => {
                const name = instructor.displayName || t('catalog.course.unnamedInstructor');
                return (
                  <li
                    key={instructor.instructorId}
                    data-testid="course-page-instructor"
                    className="flex gap-4 border border-primary/20 bg-background p-4"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground"
                    >
                      {initialOf(name)}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-semibold break-words">{name}</span>{' '}
                      <span className="text-sm text-ink-muted">
                        {t(
                          instructor.role === 'lead'
                            ? 'catalog.course.role.lead'
                            : 'catalog.course.role.co_instructor',
                        )}
                      </span>
                      {instructor.sections.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink/80">
                          {instructor.sections.map((x) => (
                            <li key={x.sectionId} className="break-words">
                              {localTitle(x, locale)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {page.practicePacks.length > 0 ? (
            <section className="flex flex-col gap-3" aria-labelledby="course-page-packs-heading">
              <h2 id="course-page-packs-heading" className="text-2xl font-bold">
                {t('catalog.course.practicePacks')}
              </h2>
              <p className="text-sm text-ink-muted">{t('catalog.course.practicePacksNote')}</p>
              <ul className="flex flex-col gap-3" data-testid="course-page-packs">
                {page.practicePacks.map((pack) => (
                  <li
                    key={pack.practicePackId}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-2 border-omr bg-background p-4"
                    data-testid="course-page-pack"
                  >
                    <span className="font-semibold break-words">{localTitle(pack, locale)}</span>
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="font-bold tabular-nums" data-testid="course-page-pack-price">
                        {formatMoney(pack.listPricePoisha as MoneyPoisha, locale)}
                      </span>
                      <BuyProductButton
                        productType="practice_pack"
                        productId={pack.practicePackId}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-5 border-2 border-primary bg-background p-5 lg:sticky lg:top-6">
          <div
            className="aspect-video w-full rounded-sm bg-primary/10"
            role="img"
            aria-label={t('catalog.course.coverPlaceholder')}
            data-testid="course-page-cover-placeholder"
          />
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
            <dt className="text-sm text-ink-muted">{t('catalog.course.priceLabel')}</dt>
            <dd className="text-3xl font-extrabold tabular-nums" data-testid="course-page-price">
              {formatMoney(page.listPricePoisha as MoneyPoisha, locale)}
            </dd>
            <dt className="text-sm text-ink-muted">{t('catalog.course.durationLabel')}</dt>
            <dd className="font-medium" data-testid="course-page-duration">
              {t('catalog.browse.duration', { months: formatInteger(page.accessDurationMonths) })}
            </dd>
          </dl>
          <div className="flex flex-col gap-2">
            {isPublic ? (
              <>
                <Link
                  to="/sign-up"
                  className="inline-flex min-h-12 items-center justify-center rounded-sm bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  data-testid="course-page-sign-up"
                >
                  {t('catalog.course.signUpToEnrol')}
                </Link>
                <Link
                  to="/sign-in"
                  className="tap-target justify-center text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="course-page-sign-in"
                >
                  {t('auth.signUp.haveAccount')}
                </Link>
              </>
            ) : isEnrolled ? (
              <>
                <Button
                  size="lg"
                  type="button"
                  onClick={onContinue}
                  data-testid="course-page-continue"
                >
                  {t('catalog.course.continue')}
                </Button>
                {canRenew && onBuy ? (
                  <Button
                    size="lg"
                    variant="outline"
                    type="button"
                    onClick={onBuy}
                    data-testid="course-page-renew"
                  >
                    {t('catalog.course.renew')}
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {onBuy ? buyExtra : null}
                <Button
                  size="lg"
                  type="button"
                  disabled={!onBuy}
                  aria-describedby={onBuy ? undefined : 'course-page-buy-note'}
                  onClick={onBuy}
                  data-testid="course-page-buy"
                >
                  {t('catalog.course.buy')}
                </Button>
                {onBuy ? null : (
                  <p id="course-page-buy-note" className="text-center text-sm text-ink-muted">
                    {t('catalog.course.buyUnavailable')}
                  </p>
                )}
                {trialState === 'available' && onStartTrial ? (
                  <Button
                    size="lg"
                    variant="outline"
                    type="button"
                    onClick={onStartTrial}
                    data-testid="course-page-start-trial"
                  >
                    {t('trial.start')}
                  </Button>
                ) : null}
                {trialState === 'active' ? (
                  <Button
                    size="lg"
                    variant="outline"
                    type="button"
                    onClick={onContinue}
                    data-testid="course-page-continue-trial"
                  >
                    {t('trial.continue')}
                  </Button>
                ) : null}
                {trialState === 'used' || trialState === 'usedElsewhere' ? (
                  <p
                    className="text-center text-sm text-ink-muted"
                    data-testid="course-page-trial-used"
                  >
                    {t('trial.used')}
                  </p>
                ) : null}
              </>
            )}
          </div>
          {adminTrial ? (
            <div
              className="flex flex-col gap-2 border-t border-dashed border-primary/30 pt-4"
              data-testid="course-page-admin-trial"
            >
              <p className="text-sm text-ink-muted">
                {t(adminTrial.isTrialCourse ? 'trial.admin.isTrial' : 'trial.admin.notTrial')}
              </p>
              <Button
                variant="outline"
                type="button"
                onClick={adminTrial.isTrialCourse ? adminTrial.onClear : adminTrial.onSet}
                data-testid="course-page-admin-trial-toggle"
              >
                {t(adminTrial.isTrialCourse ? 'trial.admin.clear' : 'trial.admin.set')}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
