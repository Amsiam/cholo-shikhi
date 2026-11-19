import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  decideRefundRequest,
  listRefundRequests,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { RefundQueueRow } from '#src/features/commerce/server/refund.server.ts';
import { RefundQueue } from '#src/features/commerce/ui/RefundQueue.tsx';
import { saveSetting } from '#src/features/platform/server/settings.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

const RefundSearch = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional().catch('pending'),
  page: z.number().int().min(1).max(10_000).optional().catch(undefined),
});

// Admin: refund requests and the refund window.
export const Route = createFileRoute('/admin_/refunds')({
  validateSearch: RefundSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const r = await listRefundRequests({
      data: { ...(deps.status ? { status: deps.status } : {}), page: deps.page ?? 1 },
    });
    return r.ok
      ? {
          denied: false as const,
          ...(r.value as {
            rows: RefundQueueRow[];
            page: number;
            pageCount: number;
            windowDays: number | null;
            pendingExpiryMinutes: number;
          }),
        }
      : { denied: true as const };
  },
  component: RefundsPage,
});

function RefundsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/admin/refunds' });
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('admin.denied')} />;
  const done = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <RefundQueue
          rows={data.rows}
          status={search.status}
          windowDays={data.windowDays}
          pendingExpiryMinutes={data.pendingExpiryMinutes}
          page={data.page}
          pageCount={data.pageCount}
          onStatus={(status) => void navigate({ search: { status, page: undefined } })}
          onPage={(page) => void navigate({ search: { ...search, page } })}
          onDecide={async (input) => done((await decideRefundRequest({ data: input })) as Outcome)}
          onSaveWindow={async (days) =>
            done(
              (await saveSetting({
                data: {
                  settingKey: 'commerce.refund.windowDays',
                  value: days,
                  reason: 'Refund window set from the refunds page',
                },
              })) as Outcome,
            )
          }
          onSaveExpiry={async (minutes) =>
            done(
              (await saveSetting({
                data: {
                  settingKey: 'commerce.checkout.pendingExpiryMinutes',
                  value: minutes,
                  reason: 'Checkout expiry set from the refunds page',
                },
              })) as Outcome,
            )
          }
        />
      </div>
    </div>
  );
}
