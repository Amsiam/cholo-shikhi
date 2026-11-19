import { createFileRoute, getRouteApi, Link, notFound, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  ErrorScreen,
  errorPrimaryAction,
  errorSecondaryAction,
} from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  getCoursePage,
  getPublicCoursePage,
} from '#src/features/catalog/server/catalog-browse.functions.ts';
import { catalogContainer } from '#src/features/catalog/ui/CatalogView.tsx';
import { CoursePageView } from '#src/features/catalog/ui/CoursePageView.tsx';
import { ProductPurchaseProvider } from '#src/features/catalog/ui/ProductBuy.tsx';
import {
  clearSegmentTrialCourse,
  getMySwitchOptions,
  requestMyCourseSwitch,
  setSegmentTrialCourse,
  startCourseCheckout,
  startMyTrial,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { SwitchOptions } from '#src/features/commerce/server/switch.server.ts';
import { SwitchBlock } from '#src/features/commerce/ui/SwitchBlock.tsx';
import { getCurrentGoal } from '#src/features/goals/server/goals.functions.ts';
import { requireCurrentGoal } from '#src/features/goals/ui/require-current-goal.ts';
import { PromoCodeField } from '#src/features/marketing/ui/StorefrontParts.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { enrolmentStateOf, trialStateOf } from '../-adapters/entitlements.ts';
import { loadEntitlements, useProductPurchase } from '../-adapters/product-purchase.ts';

// S4 course page (UC6, US2.2). A signed-in Student passes the Goal guard first (BR2.1); an anonymous
// visitor gets the public course page through the explicitly public, published-only read, with a
// sign-up prompt in place of Buy. A course that is not published answers the route's not-found,
// exactly like a missing one (BR4.4, SD-204). The Entitlements read is composed here beside the
// catalog read, never inside the catalog feature (BR11.10, ADR-020).
const root = getRouteApi('__root__');

export const Route = createFileRoute('/courses/$courseId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    return { isSignedIn: shell.ok && shell.value.isSignedIn };
  },
  loader: async ({ params, context }) => {
    if (!context.isSignedIn) {
      const page = await getPublicCoursePage({ data: { courseId: params.courseId } });
      if (!page.ok) {
        if (page.error.code === 'NOT_FOUND' || page.error.code === 'VALIDATION_FAILED')
          throw notFound();
        throw new Error(`course page could not be loaded: ${page.error.code}`);
      }
      return {
        page: page.value,
        isEnrolled: false,
        canRenew: false,
        trialState: 'none' as const,
        isTrialCourse: false,
        isPublic: true,
        entitlements: null,
        switchOptions: null,
      };
    }
    await requireCurrentGoal(() => getCurrentGoal({ data: {} }));
    const [page, enrolmentState, trialState] = await Promise.all([
      getCoursePage({ data: { courseId: params.courseId } }),
      // UC6 E2: an Entitlements failure shows Buy; checkout re-checks in U3.
      enrolmentStateOf(params.courseId).catch(() => ({
        isEnrolled: false,
        canRenew: false,
        endsAt: null,
      })),
      trialStateOf(params.courseId).catch(() => ({ state: 'none' as const, isTrialCourse: false })),
    ]);
    if (!page.ok) {
      if (page.error.code === 'NOT_FOUND' || page.error.code === 'VALIDATION_FAILED')
        throw notFound();
      throw new Error(`course page could not be loaded: ${page.error.code}`);
    }
    return {
      page: page.value,
      isEnrolled: enrolmentState.isEnrolled,
      canRenew: enrolmentState.canRenew,
      trialState: trialState.state,
      isTrialCourse: trialState.isTrialCourse,
      isPublic: false,
      entitlements: await loadEntitlements(),
      // US2.17: offer a switch from a paid course, unless this course is already owned.
      switchOptions: enrolmentState.isEnrolled
        ? null
        : await getMySwitchOptions({ data: { courseId: params.courseId } })
            .then((r) => (r.ok ? (r.value as SwitchOptions) : null))
            .catch(() => null),
    };
  },
  notFoundComponent: CourseNotFound,
  component: CoursePageRoute,
});

function CoursePageRoute() {
  const { page, isEnrolled, canRenew, trialState, isTrialCourse, isPublic, switchOptions } =
    Route.useLoaderData();
  const shell = root.useLoaderData();
  const isAdmin = shell.roles.includes('admin');
  const navigate = Route.useNavigate();
  const router = useRouter();
  // US8.3: an optional promo code; a refused code shows its reason and opens no payment.
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);
  const purchase = useProductPurchase(Route.useLoaderData().entitlements ?? null);
  const toCourse = () => navigate({ to: '/learn/$courseId', params: { courseId: page.courseId } });
  return (
    <ProductPurchaseProvider value={purchase}>
      <CoursePageView
        page={page}
        isEnrolled={isEnrolled}
        canRenew={canRenew}
        trialState={trialState}
        adminTrial={
          isAdmin
            ? {
                isTrialCourse,
                onSet: async () => {
                  await setSegmentTrialCourse({ data: { courseId: page.courseId } });
                  await router.invalidate();
                },
                onClear: async () => {
                  await clearSegmentTrialCourse({ data: { courseId: page.courseId } });
                  await router.invalidate();
                },
              }
            : undefined
        }
        onStartTrial={async () => {
          const started = await startMyTrial({ data: { courseId: page.courseId } }).catch(
            () => null,
          );
          if (started?.ok) await toCourse();
          else await router.invalidate();
        }}
        isPublic={isPublic}
        onContinue={() => void toCourse()}
        buyExtra={
          isPublic ? null : (
            <PromoCodeField value={promoCode} onChange={setPromoCode} errorKey={promoError} />
          )
        }
        onBuy={async () => {
          // Opens a pending payment at the course's published (or discounted) price, then the
          // gateway page.
          setPromoError(null);
          const code = promoCode.trim();
          const checkout = await startCourseCheckout({
            data: { courseId: page.courseId, ...(code ? { promoCode: code } : {}) },
          }).catch(() => null);
          if (checkout && !checkout.ok && checkout.error.i18nKey.startsWith('errors.promo.')) {
            setPromoError(checkout.error.i18nKey);
            return;
          }
          if (checkout?.ok) {
            await navigate({
              to: '/checkout/$paymentId',
              params: { paymentId: checkout.value.paymentId },
            });
          } else if (checkout && !checkout.ok && checkout.error.code === 'ALREADY_ENROLLED') {
            await toCourse();
          }
        }}
      />
      {switchOptions ? (
        <div className={`${catalogContainer} pb-12`}>
          <SwitchBlock
            options={switchOptions}
            onRequest={async (fromCourseId) =>
              (await requestMyCourseSwitch({
                data: { fromCourseId, toCourseId: page.courseId },
              })) as Parameters<typeof SwitchBlock>[0]['onRequest'] extends (
                ...a: never[]
              ) => Promise<infer R>
                ? R
                : never
            }
          />
        </div>
      ) : null}
    </ProductPurchaseProvider>
  );
}

function CourseNotFound() {
  const { t } = useI18n();
  return (
    <ErrorScreen
      kind="notFound"
      testId="course-not-found"
      title={t('catalog.course.notFound')}
      body={t('shell.notFound.body')}
      actions={
        <>
          <Link
            to="/catalog"
            search={{}}
            className={errorPrimaryAction}
            data-testid="course-not-found-back"
          >
            {t('catalog.course.backToCatalog')}
          </Link>
          <Link to="/" className={errorSecondaryAction}>
            {t('errorPage.home')}
          </Link>
        </>
      }
    />
  );
}
