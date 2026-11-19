import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  getMyProductOrder,
  settleMyFakeProductOrder,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { OrderView } from '#src/features/commerce/server/product.server.ts';
import { ProductGatewayView } from '#src/features/commerce/ui/ProductGatewayView.tsx';

// The development fake gateway for one of the caller's own product orders.
export const Route = createFileRoute('/checkout/order/$orderId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const r = await getMyProductOrder({ data: { orderId: params.orderId } });
    if (!r.ok) throw notFound();
    return r.value as OrderView;
  },
  component: OrderPage,
});

function OrderPage() {
  const order = Route.useLoaderData();
  const router = useRouter();
  return (
    <ProductGatewayView
      order={order}
      onSettle={async (outcome) => {
        const r = await settleMyFakeProductOrder({
          data: { orderId: order.orderId, outcome },
        }).catch(() => null);
        await router.invalidate();
        return r?.ok ? null : (r?.error.i18nKey ?? 'errors.common.INTERNAL_ERROR');
      }}
    />
  );
}
