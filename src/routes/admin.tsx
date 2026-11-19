import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { listTrialCourseOffers } from '#src/features/commerce/server/commerce.functions.ts';
import { TrialCapsEditor } from '#src/features/commerce/ui/TrialCapsEditor.tsx';
import { listAuditLog } from '#src/features/platform/server/audit.functions.ts';
import { listFlags } from '#src/features/platform/server/flags.functions.ts';
import {
  listSettingDefinitions,
  saveSetting,
} from '#src/features/platform/server/settings.functions.ts';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import {
  type SaveSettingOutcome,
  SettingsOverview,
} from '#src/features/platform/ui/SettingsOverview.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

type FlagRow = { flagKey: string; state: string; rolloutPercent: number; revision: number };
type AuditRow = {
  auditEntryId: string;
  occurredAt: string;
  action: string;
  subjectType: string;
  subjectId: string;
  actorId: string;
};

const PAGE_SIZE = 20;

// A10 Admin console (Admin with two-step only, BR1.6): flags, settings and the audit log with
// server-side pagination through schema-validated search params.
export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const [flags, settings, audit, trials] = await Promise.all([
      listFlags({ data: {} }),
      listSettingDefinitions({ data: {} }),
      listAuditLog({ data: { page: deps.page, pageSize: PAGE_SIZE } }),
      listTrialCourseOffers({ data: {} }).catch(() => null),
    ]);
    if (!flags.ok || !settings.ok || !audit.ok) return { denied: true as const };
    return {
      denied: false as const,
      flags: flags.value,
      settings: settings.value,
      audit: audit.value,
      trials: trials?.ok ? trials.value : [],
    };
  },
  component: AdminPage,
});

function AdminPage() {
  const { t, formatDateTime, locale } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/admin' });
  const router = useRouter();
  if (data.denied) {
    return <AccessDenied reason={t('admin.denied')} testId="admin-denied" />;
  }
  const flagColumns: Array<Column<FlagRow>> = [
    { accessorKey: 'flagKey', header: () => t('admin.flags.key') },
    { accessorKey: 'state', header: () => t('admin.flags.state') },
    { accessorKey: 'rolloutPercent', header: () => t('admin.flags.rollout') },
    { accessorKey: 'revision', header: () => t('admin.flags.revision') },
  ];
  const auditColumns: Array<Column<AuditRow>> = [
    {
      accessorKey: 'occurredAt',
      header: () => t('admin.audit.when'),
      cell: ({ row }) => formatDateTime(row.original.occurredAt),
    },
    { accessorKey: 'action', header: () => t('admin.audit.action') },
    {
      id: 'subject',
      header: () => t('admin.audit.subject'),
      cell: ({ row }) => `${row.original.subjectType}:${row.original.subjectId}`,
    },
    { accessorKey: 'actorId', header: () => t('admin.audit.actor') },
  ];
  const pages = Math.max(1, Math.ceil(data.audit.total / PAGE_SIZE));
  return (
    <section className="grid gap-8" data-testid="admin-page">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <Link
        to="/admin/goals"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-sm border border-primary/40 bg-background px-5 font-semibold text-primary hover:bg-primary/10"
        data-testid="admin-goals-link"
      >
        {t('goals.admin.title')}
      </Link>
      <section className="grid gap-2" aria-labelledby="admin-trials-title">
        <h2 id="admin-trials-title" className="font-medium">
          {t('trial.admin.title')}
        </h2>
        <p className="text-sm text-ink-muted">{t('trial.admin.howTo')}</p>
        <DataTable
          testId="admin-trials"
          rows={data.trials}
          rowId={(r) => r.segmentId}
          emptyText={t('trial.admin.none')}
          display={[
            {
              id: 'goal',
              header: t('trial.admin.goal'),
              cell: (r) => (locale === 'bn' ? r.goalNameBn : r.goalNameEn) || r.goalNameBn,
            },
            {
              id: 'course',
              header: t('insights.col.course'),
              cell: (r) => (
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: r.courseId }}
                  className="tap-target font-semibold text-primary hover:underline"
                >
                  {(locale === 'bn' ? r.titleBn : r.titleEn) || r.titleBn}
                </Link>
              ),
            },
            {
              id: 'caps',
              header: t('trial.caps.header'),
              cell: (r) => (
                <TrialCapsEditor
                  segmentId={r.segmentId}
                  days={r.days}
                  lessons={r.lessons}
                  onSave={async ({ segmentId, days, lessons, reason }) => {
                    for (const [settingKey, value] of [
                      ['commerce.trial.days', days],
                      ['commerce.trial.lessons', lessons],
                    ] as const) {
                      const res = await saveSetting({
                        data: { settingKey, scopeKey: segmentId, value, reason },
                      });
                      if (!res.ok)
                        return { ok: false, error: { i18nKey: 'trial.caps.saveFailed' } };
                    }
                    await router.invalidate();
                    return { ok: true };
                  }}
                />
              ),
            },
          ]}
        />
      </section>
      <div className="grid gap-2">
        <h2 className="font-medium">{t('admin.flags.title')}</h2>
        <DataTable
          testId="admin-flags-table"
          columns={flagColumns}
          rows={data.flags}
          emptyText={t('admin.flags.empty')}
        />
      </div>
      <div className="grid gap-2">
        <h2 className="font-medium">{t('admin.settings.title')}</h2>
        <SettingsOverview
          rows={data.settings}
          onSave={async (input) => {
            const r = (await saveSetting({ data: input })) as SaveSettingOutcome;
            if (r.ok) await router.invalidate();
            return r;
          }}
        />
      </div>
      <div className="grid gap-2">
        <h2 className="font-medium">{t('admin.audit.title')}</h2>
        <DataTable
          testId="admin-audit-table"
          columns={auditColumns}
          rows={data.audit.rows}
          emptyText={t('admin.audit.empty')}
          paging={{
            page: data.audit.page,
            pages,
            onPage: (page) => void navigate({ search: { page } }),
          }}
        />
      </div>
    </section>
  );
}
