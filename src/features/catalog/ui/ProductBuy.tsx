// Buying a Practice Pack, exam package or plan from the catalog. Catalog never imports Commerce
// (ADR-020): the route provides what the Student owns and how to start an order through this
// context; without a provider (an anonymous visitor) no button is drawn.
import { Check, ShoppingCart } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

export type BuyableType = 'practice_pack' | 'exam_package' | 'subscription_plan';

export type ProductPurchase = {
  ownedPacks: readonly string[];
  ownedPackages: readonly string[];
  plans: ReadonlyArray<{ planId: string; endsAt: string }>;
  /** Starts an order and goes to its checkout; returns an error key or null. */
  onBuy: (productType: BuyableType, productId: string) => Promise<string | null>;
};

const PurchaseContext = createContext<ProductPurchase | null>(null);

export function ProductPurchaseProvider(props: {
  value: ProductPurchase | null;
  children: ReactNode;
}) {
  return <PurchaseContext.Provider value={props.value}>{props.children}</PurchaseContext.Provider>;
}

export function BuyProductButton(props: {
  productType: BuyableType;
  productId: string;
  tone?: 'default' | 'onPrimary';
}) {
  const { t, tDynamic, formatDate } = useI18n();
  const purchase = useContext(PurchaseContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!purchase) return null;
  const isOwned =
    (props.productType === 'practice_pack' && purchase.ownedPacks.includes(props.productId)) ||
    (props.productType === 'exam_package' && purchase.ownedPackages.includes(props.productId));
  const plan = purchase.plans.find((p) => p.planId === props.productId);
  if (isOwned)
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-pass/15 px-3 py-1 text-sm font-semibold text-pass">
        <Check aria-hidden="true" className="size-4" />
        {t('order.owned')}
      </span>
    );
  return (
    <span className="flex flex-col gap-1">
      {plan ? (
        <span className={`text-sm ${props.tone === 'onPrimary' ? 'opacity-90' : 'text-ink/80'}`}>
          {t('order.activeUntil', { date: formatDate(plan.endsAt) })}
        </span>
      ) : null}
      <Button
        size="sm"
        variant={props.tone === 'onPrimary' ? 'secondary' : 'default'}
        className="w-fit"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(await purchase.onBuy(props.productType, props.productId));
          setBusy(false);
        }}
        data-testid={`buy-${props.productType}`}
      >
        <ShoppingCart aria-hidden="true" className="size-4" />
        {t(
          plan
            ? 'order.renew'
            : props.productType === 'subscription_plan'
              ? 'order.subscribe'
              : 'order.buy',
        )}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </span>
      ) : null}
    </span>
  );
}
