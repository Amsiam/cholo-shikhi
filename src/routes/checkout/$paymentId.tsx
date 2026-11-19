import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { getPublicCoursePage } from '#src/features/catalog/server/catalog-browse.functions.ts';
import {
  getMyCheckout,
  settleMyFakePayment,
  startCourseCheckout,
} from '#src/features/commerce/server/commerce.functions.ts';
import { FakeGatewayView } from '#src/features/commerce/ui/FakeGatewayView.tsx';

// The development fake gateway's page for one of the caller's own payments.
export const Route = createFileRoute('/checkout/$paymentId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const checkout = await getMyCheckout({ data: { paymentId: params.paymentId } });
    if (!checkout.ok) throw notFound();
    const course = await getPublicCoursePage({ data: { courseId: checkout.value.courseId } });
    return {
      ...checkout.value,
      courseTitleBn: course.ok ? course.value.titleBn : '',
      courseTitleEn: course.ok ? course.value.titleEn : '',
    };
  },
  component: CheckoutPage,
});

function CheckoutPage() {
  const checkout = Route.useLoaderData();
  const router = useRouter();
  return (
    <FakeGatewayView
      checkout={checkout}
      onSettle={async (outcome) => {
        const result = await settleMyFakePayment({
          data: { paymentId: checkout.paymentId, outcome },
        }).catch(() => null);
        await router.invalidate();
        return result?.ok ? null : (result?.error.code ?? 'INTERNAL_ERROR');
      }}
      onRetry={async () => {
        const next = await startCourseCheckout({ data: { courseId: checkout.courseId } }).catch(
          () => null,
        );
        if (next?.ok)
          await router.navigate({
            to: '/checkout/$paymentId',
            params: { paymentId: next.value.paymentId },
          });
      }}
    />
  );
}
