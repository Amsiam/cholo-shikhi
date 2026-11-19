import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  decideTakedownNotice,
  getTakedownTargets,
  listTakedownNotices,
  logTakedownNotice,
} from '#src/features/trustops/server/takedown.functions.ts';
import type {
  TakedownTargets,
  TakedownView,
} from '#src/features/trustops/server/takedown.server.ts';
import { TakedownsAdmin } from '#src/features/trustops/ui/TakedownsAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome<T = unknown> = { ok: true; value?: T } | { ok: false; error: { i18nKey?: string } };

// A11 Copyright takedowns, for Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/takedowns')({
  loader: async () => {
    const r = await listTakedownNotices({ data: {} });
    return r.ok
      ? { denied: false as const, notices: r.value as TakedownView[] }
      : { denied: true as const };
  },
  component: TakedownsPage,
});

function TakedownsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.takedown.forbidden')} />;
  const refresh = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <TakedownsAdmin
          notices={data.notices}
          onTargets={async (course) =>
            (await getTakedownTargets({ data: { course } })) as Outcome<TakedownTargets>
          }
          onLog={async (input) =>
            refresh((await logTakedownNotice({ data: input as never })) as Outcome)
          }
          onDecide={async (noticeId, action, reason) =>
            refresh((await decideTakedownNotice({ data: { noticeId, action, reason } })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
