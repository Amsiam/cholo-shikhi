// [LT] Step 25: the A9 blocked-domain screen with React Testing Library: the shared-schema field
// error is announced, a server refusal is shown by its i18n key, removal asks first, and the table
// shows the empty state.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import {
  type BlockedDomainRow,
  BlockedDomainsAdmin,
  type BlockedDomainsAdminProps,
} from './BlockedDomainsAdmin.tsx';

const ROW: BlockedDomainRow = {
  blockedDomainId: '0b6f8c9e-3a8d-4f57-9b7e-0c1d2e3f4a5b',
  domain: 'phish.example',
  createdAt: '2026-11-16T04:00:00.000Z',
  version: 1,
};

function setup(overrides: Partial<BlockedDomainsAdminProps> = {}, locale: 'bn' | 'en' = 'en') {
  const props: BlockedDomainsAdminProps = {
    rows: [ROW],
    total: 1,
    paging: { page: 1, pages: 1, onPage: vi.fn() },
    onAdd: vi.fn(async () => null),
    onRemove: vi.fn(async () => null),
    ...overrides,
  };
  render(
    <I18nProvider locale={locale}>
      <BlockedDomainsAdmin {...props} />
    </I18nProvider>,
  );
  return props;
}

describe('BlockedDomainsAdmin', () => {
  it('lists the blocked domains in a table', () => {
    setup();
    const table = screen.getByTestId('blocked-domains-table');
    expect(within(table).getByText('phish.example')).toBeTruthy();
  });

  it('shows the empty state', () => {
    setup({ rows: [], total: 0 });
    expect(screen.getByTestId('blocked-domains-table-empty')).toBeTruthy();
  });

  it('announces a field error from the shared schema without calling the server', async () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('blocked-domains-add'));
    await waitFor(() => expect(screen.getByTestId('blocked-domains-domain-error')).toBeTruthy());
    expect(screen.getByTestId('blocked-domains-domain').getAttribute('aria-invalid')).toBe('true');
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it('adds a domain and confirms', async () => {
    const props = setup();
    fireEvent.change(screen.getByTestId('blocked-domains-domain'), {
      target: { value: 'spam.example' },
    });
    fireEvent.click(screen.getByTestId('blocked-domains-add'));
    await waitFor(() => expect(props.onAdd).toHaveBeenCalledWith({ domain: 'spam.example' }));
    expect((await screen.findByTestId('blocked-domains-message')).getAttribute('role')).toBe(
      'status',
    );
  });

  it('shows the server refusal against the field', async () => {
    setup({
      onAdd: vi.fn(async () => ({
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { domain: ['errors.catalog.domainInvalid'] },
      })),
    });
    fireEvent.change(screen.getByTestId('blocked-domains-domain'), {
      target: { value: 'localhost' },
    });
    fireEvent.click(screen.getByTestId('blocked-domains-add'));
    expect((await screen.findByTestId('blocked-domains-domain-error')).textContent).toContain(
      'example.com',
    );
  });

  it('asks before unblocking and sends the row version', async () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('blocked-domains-remove'));
    const dialog = await screen.findByTestId('blocked-domains-confirm');
    expect(dialog.textContent).toContain('phish.example');
    fireEvent.click(screen.getByTestId('blocked-domains-confirm-confirm'));
    await waitFor(() =>
      expect(props.onRemove).toHaveBeenCalledWith({
        blockedDomainId: ROW.blockedDomainId,
        expectedVersion: 1,
      }),
    );
  });

  it('cancelling the confirmation removes nothing', async () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('blocked-domains-remove'));
    fireEvent.click(await screen.findByTestId('blocked-domains-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('blocked-domains-confirm')).toBeNull());
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('renders in Bangla', () => {
    setup({}, 'bn');
    expect(screen.getByTestId('blocked-domains-add').textContent).toBe('ডোমেইন নিষিদ্ধ করুন');
  });
});
