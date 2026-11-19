import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { BundleOffer } from '#src/features/commerce/server/bundle.server.ts';
import {
  getBundleOffer,
  startBundleOrder,
} from '#src/features/commerce/server/commerce.functions.ts';
import { BundleOfferView } from '#src/features/commerce/ui/BundleViews.tsx';

// US8.5 (S4): a bundle's page, public like the catalog's bundle list; buying needs sign-in.
export const Route = createFileRoute('/bundles/$bundleId')({
  loader: async ({ params }) => {
    const [offer, shell] = await Promise.all([
      getBundleOffer({ data: { bundleId: params.bundleId } }),
      getShellState().catch(() => null),
    ]);
    if (!offer.ok) throw notFound();
    return {
      offer: offer.value as BundleOffer,
      isSignedIn: Boolean(shell?.ok && shell.value.isSignedIn),
    };
  },
  component: BundlePage,
});

function BundlePage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <BundleOfferView
      offer={data.offer}
      isSignedIn={data.isSignedIn}
      onBuy={async () => {
        const r = await startBundleOrder({ data: { bundleId: data.offer.bundleId } }).catch(
          () => null,
        );
        if (!r?.ok) return r?.error.i18nKey ?? 'errors.common.INTERNAL_ERROR';
        await navigate({
          to: '/checkout/bundle/$orderId',
          params: { orderId: (r.value as { orderId: string }).orderId },
        });
        return null;
      }}
    />
  );
}
