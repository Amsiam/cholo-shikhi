import { createFileRoute, getRouteApi, notFound, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { getMyReceipt } from '#src/features/commerce/server/commerce.functions.ts';
import type { Purchase } from '#src/features/commerce/server/commerce.server.ts';
import { ReceiptView } from '#src/features/commerce/ui/PurchasesView.tsx';

const root = getRouteApi('__root__');

// One receipt of the signed-in Student's own (anyone else's answers not found).
export const Route = createFileRoute('/me_/purchases_/$paymentId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const result = await getMyReceipt({ data: { paymentId: params.paymentId } });
    if (!result.ok || (result.value as Purchase).status !== 'succeeded') throw notFound();
    return result.value as Purchase;
  },
  component: ReceiptPage,
});

function ReceiptPage() {
  const shell = root.useLoaderData();
  return <ReceiptView purchase={Route.useLoaderData()} displayName={shell.displayName} />;
}
