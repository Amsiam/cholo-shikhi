// [LT] app-shell components: language switcher, notification list, data table, manifest (US9.2).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationList } from '#src/features/notifications/ui/NotificationList.tsx';
import { type Column, DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';

const ui = (node: React.ReactNode, locale: 'bn' | 'en' = 'en') =>
  render(<I18nProvider locale={locale}>{node}</I18nProvider>);

describe('LanguageSwitcher', () => {
  it('marks the active language and asks to switch to the other one', () => {
    const onChange = vi.fn();
    ui(<LanguageSwitcher onChange={onChange} />, 'bn');
    expect(screen.getByTestId('language-switcher-bn').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('language-switcher-en'));
    expect(onChange).toHaveBeenCalledWith('en');
  });
});

describe('NotificationList (S16)', () => {
  it('AC10.1.3 shows "You\'re all caught up" when empty', () => {
    ui(<NotificationList items={[]} />);
    expect(screen.getByTestId('notification-list-empty').textContent).toBe("You're all caught up");
  });
  it('lists items with unread ones emphasised', () => {
    ui(
      <NotificationList
        items={[
          {
            notificationId: 'n1',
            title: 'T1',
            body: 'B1',
            createdAt: '2026-11-13T00:00:00.000Z',
            isRead: false,
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId('notification-list-item')).toHaveLength(1);
    expect(screen.getByText('T1').className).toContain('font-semibold');
  });
});

describe('DataTable (TanStack Table + shadcn/ui)', () => {
  type Row = { key: string; n: number };
  const columns: Array<Column<Row>> = [
    { accessorKey: 'key', header: () => 'K' },
    { accessorKey: 'n', header: () => 'N' },
  ];
  it('renders rows and pages server-side', () => {
    const onPage = vi.fn();
    ui(
      <DataTable
        testId="t"
        columns={columns}
        rows={[
          { key: 'a', n: 1 },
          { key: 'b', n: 2 },
        ]}
        emptyText="none"
        paging={{ page: 1, pages: 3, onPage }}
      />,
    );
    expect(screen.getAllByTestId('t-row')).toHaveLength(2);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByTestId('t-next'));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it('shows the empty text', () => {
    ui(<DataTable testId="t" columns={columns} rows={[]} emptyText="none" />);
    expect(screen.getByTestId('t-empty').textContent).toBe('none');
  });
});

describe('PWA manifest (US9.2)', () => {
  it('AC9.2.1 launches in standalone mode with no address bar', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
    );
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });
  it('BR17.6 the service worker caches static assets only and waits for "Update"', () => {
    const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(sw).toContain("url.pathname.startsWith('/assets/')");
    expect(sw).toContain('SKIP_WAITING');
    expect(sw).not.toContain('clients.claim');
  });
});
