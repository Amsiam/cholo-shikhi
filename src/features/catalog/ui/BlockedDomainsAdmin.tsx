// A9 blocked-domain list (NFR6.210; SD-211): a server-paged TanStack Table of the blocked domains, a
// TanStack Form to add one (validated with the shared schema, then the server's domain rule), and a
// confirmed remove. A change applies to the very next lesson save or publish.
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { formatDate } from '#src/lib/i18n/format.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { AddBlockedDomainInput } from '../server/catalog-trust.schema.ts';
import { ConfirmDialog, firstErrors, type SaveOutcome, TextField } from './fields.tsx';

export type BlockedDomainRow = {
  blockedDomainId: string;
  domain: string;
  createdAt: string;
  version: number;
};

export type BlockedDomainsAdminProps = {
  rows: BlockedDomainRow[];
  total: number;
  paging: { page: number; pages: number; onPage: (page: number) => void };
  onAdd: (input: { domain: string }) => Promise<SaveOutcome>;
  onRemove: (input: { blockedDomainId: string; expectedVersion: number }) => Promise<SaveOutcome>;
};

export function BlockedDomainsAdmin(props: BlockedDomainsAdminProps) {
  const { t, tDynamic, locale } = useI18n();
  const [toRemove, setToRemove] = useState<BlockedDomainRow | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const form = useForm({
    defaultValues: { domain: '' },
    onSubmit: async ({ value, formApi }) => {
      const local = firstErrors(AddBlockedDomainInput, value);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onAdd(value);
      if (outcome) {
        setErrors(firstErrors(AddBlockedDomainInput, value, outcome.fieldErrors));
        setMessage({ text: tDynamic(outcome.i18nKey), isError: true });
        return;
      }
      formApi.reset();
      setMessage({ text: t('catalog.admin.blocked.added'), isError: false });
    },
  });

  const columns: Array<Column<BlockedDomainRow>> = [
    { accessorKey: 'domain', header: () => t('catalog.admin.blocked.domain') },
    {
      id: 'createdAt',
      header: () => t('catalog.admin.blocked.addedOn'),
      cell: ({ row }) => formatDate(row.original.createdAt, locale),
    },
    {
      id: 'actions',
      header: () => t('catalog.admin.blocked.actions'),
      cell: ({ row }) => (
        <Button
          variant="outline"
          onClick={() => setToRemove(row.original)}
          data-testid="blocked-domains-remove"
        >
          {t('catalog.admin.blocked.remove')}
        </Button>
      ),
    },
  ];

  async function confirmRemove() {
    const row = toRemove;
    setToRemove(null);
    if (!row) return;
    const outcome = await props.onRemove({
      blockedDomainId: row.blockedDomainId,
      expectedVersion: row.version,
    });
    setMessage(
      outcome
        ? { text: tDynamic(outcome.i18nKey), isError: true }
        : { text: t('catalog.admin.blocked.removed'), isError: false },
    );
  }

  return (
    <div className="grid gap-6" data-testid="blocked-domains-admin">
      <p className="text-sm text-muted-foreground">{t('catalog.admin.blocked.intro')}</p>
      <form
        className="grid gap-3 sm:max-w-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        data-testid="blocked-domains-form"
      >
        <form.Field name="domain">
          {(field) => (
            <TextField
              label={t('catalog.admin.blocked.domain')}
              value={field.state.value}
              onChange={field.handleChange}
              error={errors.domain}
              hint={t('catalog.admin.blocked.domainHint')}
              testId="blocked-domains-domain"
            />
          )}
        </form.Field>
        <Button size="lg" type="submit" data-testid="blocked-domains-add">
          {t('catalog.admin.blocked.add')}
        </Button>
      </form>
      {message ? (
        <p
          role={message.isError ? 'alert' : 'status'}
          className={message.isError ? 'text-sm text-destructive' : 'text-sm'}
          data-testid="blocked-domains-message"
        >
          {message.text}
        </p>
      ) : null}
      <DataTable
        testId="blocked-domains-table"
        columns={columns}
        rows={props.rows}
        emptyText={t('catalog.admin.blocked.empty')}
        paging={props.paging}
      />
      <ConfirmDialog
        isOpen={toRemove !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToRemove(null);
        }}
        title={t('catalog.admin.blocked.removeTitle')}
        description={t('catalog.admin.blocked.removeBody', { domain: toRemove?.domain ?? '' })}
        confirmLabel={t('catalog.admin.blocked.remove')}
        onConfirm={() => void confirmRemove()}
        testId="blocked-domains-confirm"
      />
    </div>
  );
}
