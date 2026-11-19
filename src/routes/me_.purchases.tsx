import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  getMyProductOrders,
  getMyPurchases,
  requestMyRefund,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { Purchase } from '#src/features/commerce/server/commerce.server.ts';
import type { OrderView } from '#src/features/commerce/server/product.server.ts';
import { PurchasesView } from '#src/features/commerce/ui/PurchasesView.tsx';

// Purchase history: the signed-in Student's own payments and the access they bought.
export const Route = createFileRoute('/me_/purchases')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const [result, orders] = await Promise.all([
      getMyPurchases({ data: {} }),
      getMyProductOrders({ data: {} }).catch(() => null),
    ]);
    return {
      purchases: result.ok ? (result.value as Purchase[]) : [],
      orders: orders?.ok ? (orders.value as OrderView[]) : [],
    };
  },
  component: PurchasesPage,
});

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

function PurchasesPage() {
  const router = useRouter();
  const data = Route.useLoaderData();
  return (
    <PurchasesView
      purchases={data.purchases}
      orders={data.orders}
      onRequestRefund={async (paymentId, reason) => {
        const r = (await requestMyRefund({ data: { paymentId, reason } })) as Outcome;
        if (r.ok) await router.invalidate();
        return r;
      }}
    />
  );
}
