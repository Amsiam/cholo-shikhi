import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  decideSwitchRequest,
  listSwitchRequests,
} from '#src/features/commerce/server/commerce.functions.ts';
import type { SwitchQueueRow } from '#src/features/commerce/server/switch.server.ts';
import { SwitchQueue } from '#src/features/commerce/ui/SwitchQueue.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };

// A2 course switch queue, for Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/switches')({
  loader: async () => {
    const r = await listSwitchRequests({ data: {} });
    return r.ok
      ? { denied: false as const, rows: r.value as SwitchQueueRow[] }
      : { denied: true as const };
  },
  component: SwitchesPage,
});

function SwitchesPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.switch.forbidden')} />;
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <SwitchQueue
          rows={data.rows}
          onDecide={async (input) => {
            const r = (await decideSwitchRequest({ data: input })) as Outcome;
            if (r.ok) await router.invalidate();
            return r;
          }}
        />
      </div>
    </div>
  );
}
