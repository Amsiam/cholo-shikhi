// Route-level adapter for buying packs, exam packages and plans from catalog screens. The catalog
// feature never imports commerce (ADR-020): the route reads what the Student owns and starts orders.
import { useNavigate } from '@tanstack/react-router';
import type { ProductPurchase } from '#src/features/catalog/ui/ProductBuy.tsx';
import {
  getMyEntitlements,
  startProductOrder,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { Entitlements } from '#src/features/commerce/server/product.server.ts';

/** What the signed-in Student owns, or null when signed out or unavailable. */
export async function loadEntitlements(): Promise<Entitlements | null> {
  const r = await getMyEntitlements({ data: {} }).catch(() => null);
  return r?.ok ? (r.value as Entitlements) : null;
}

export function useProductPurchase(ent: Entitlements | null): ProductPurchase | null {
  const navigate = useNavigate();
  if (!ent) return null;
  return {
    ownedPacks: ent.practicePackIds,
    ownedPackages: ent.examPackageIds,
    plans: ent.plans,
    onBuy: async (productType, productId) => {
      const r = await startProductOrder({ data: { productType, productId } }).catch(() => null);
      if (!r) return 'errors.common.INTERNAL_ERROR';
      if (!r.ok) return r.error.i18nKey;
      await navigate({ to: '/checkout/order/$orderId', params: { orderId: r.value.orderId } });
      return null;
    },
  };
}
