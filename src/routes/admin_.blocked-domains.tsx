import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import {
  addBlockedDomain,
  listBlockedDomains,
  removeBlockedDomain,
} from '#src/features/catalog/server/catalog-trust.functions.ts';
import {
  type BlockedDomainRow,
  BlockedDomainsAdmin,
} from '#src/features/catalog/ui/BlockedDomainsAdmin.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

const PAGE_SIZE = 20;
type Outcome =
  | { ok: true }
  | {
      ok: false;
      error: { code: string; i18nKey: string; fieldErrors?: Record<string, readonly string[]> };
    };

// A9 blocked-domain list (Admin with two-step only, NFR6.210). A non-nested route at
// /admin/blocked-domains, so the U1 Admin console stays a leaf. Paging is server-side.
export const Route = createFileRoute('/admin_/blocked-domains')({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const result = await listBlockedDomains({ data: { page: deps.page, pageSize: PAGE_SIZE } });
    if (!result.ok) return { denied: true as const };
    return {
      denied: false as const,
      list: result.value as { rows: BlockedDomainRow[]; total: number; page: number },
    };
  },
  component: BlockedDomainsPage,
});

function BlockedDomainsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate({ from: '/admin/blocked-domains' });
  if (data.denied) {
    return (
      <p role="alert" data-testid="blocked-domains-denied">
        {t('catalog.admin.blocked.denied')}
      </p>
    );
  }
  async function after(result: Outcome) {
    await router.invalidate();
    return result.ok ? null : result.error;
  }
  return (
    <section className="grid gap-6" data-testid="blocked-domains-page">
      <h1 className="text-2xl font-semibold">{t('catalog.admin.blocked.title')}</h1>
      <BlockedDomainsAdmin
        rows={data.list.rows}
        total={data.list.total}
        paging={{
          page: data.list.page,
          pages: Math.max(1, Math.ceil(data.list.total / PAGE_SIZE)),
          onPage: (page) => void navigate({ search: { page } }),
        }}
        onAdd={async (input) => after(await addBlockedDomain({ data: input }))}
        onRemove={async (input) => after(await removeBlockedDomain({ data: input }))}
      />
    </section>
  );
}
