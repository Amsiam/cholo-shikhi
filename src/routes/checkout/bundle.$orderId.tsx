import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { BundleOrderView } from '#src/features/commerce/server/bundle.server.ts';
import {
  getMyBundleOrder,
  settleMyFakeBundleOrder,
} from '#src/features/commerce/server/commerce.functions.ts';
import { BundleGatewayView } from '#src/features/commerce/ui/BundleViews.tsx';

// The development fake gateway for one of the caller's own bundle orders (US8.5).
export const Route = createFileRoute('/checkout/bundle/$orderId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const r = await getMyBundleOrder({ data: { orderId: params.orderId } });
    if (!r.ok) throw notFound();
    return r.value as BundleOrderView;
  },
  component: BundleOrderPage,
});

function BundleOrderPage() {
  const order = Route.useLoaderData();
  const router = useRouter();
  return (
    <BundleGatewayView
      order={order}
      onSettle={async (outcome) => {
        const r = await settleMyFakeBundleOrder({
          data: { orderId: order.orderId, outcome },
        }).catch(() => null);
        await router.invalidate();
        return r?.ok ? null : (r?.error.i18nKey ?? 'errors.common.INTERNAL_ERROR');
      }}
    />
  );
}
