import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import {
  decideFraudFlag,
  flagFraudAccount,
  listFraudQueue,
} from '#src/features/trustops/server/fraud.functions.ts';
import type { FraudQueue } from '#src/features/trustops/server/fraud.server.ts';
import { FraudReview } from '#src/features/trustops/ui/FraudReview.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };

// A3 fraud review queues (manual flags only), for Admins with two-step sign-in.
export const Route = createFileRoute('/admin_/fraud')({
  validateSearch: z.object({
    kind: z.enum(['vault_gaming', 'quiz_collusion', 'referral_fraud']).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const r = await listFraudQueue({ data: deps.kind ? { kind: deps.kind } : {} });
    return r.ok
      ? { denied: false as const, queue: r.value as FraudQueue }
      : { denied: true as const };
  },
  component: FraudPage,
});

function FraudPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('errors.fraud.forbidden')} />;
  const refresh = async (r: Outcome) => {
    if (r.ok) await router.invalidate();
    return r;
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <FraudReview
          queue={data.queue}
          kind={kind}
          onKind={(next) => void navigate({ search: next ? { kind: next } : {} })}
          onFlag={async (v) => refresh((await flagFraudAccount({ data: v })) as Outcome)}
          onDecide={async (flagId, action, reason) =>
            refresh((await decideFraudFlag({ data: { flagId, action, reason } })) as Outcome)
          }
        />
      </div>
    </div>
  );
}
