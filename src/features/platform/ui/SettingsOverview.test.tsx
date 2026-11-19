// [LT] A10 settings in plain words: labels, units, money, per-segment values, unset warnings.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { type SettingRow, SettingsOverview } from './SettingsOverview.tsx';

function ui(rows: SettingRow[], locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale={locale}>
        <SettingsOverview rows={rows} />
      </I18nProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
  });
  render(<RouterProvider router={router as never} />);
}

const row = (r: Partial<SettingRow> & Pick<SettingRow, 'settingKey' | 'current'>): SettingRow => ({
  valueType: 'integer',
  min: 1,
  max: 100,
  blocksWhenUnset: false,
  ...r,
});

const ROWS: SettingRow[] = [
  row({
    settingKey: 'auth.signIn.windowMinutes',
    min: 1,
    max: 1440,
    current: { kind: 'value', value: 15, isDefault: true },
  }),
  row({
    settingKey: 'notifications.smsEnabled',
    valueType: 'boolean',
    min: null,
    max: null,
    current: { kind: 'value', value: false, isDefault: false },
  }),
  row({
    settingKey: 'catalog.coursePrice.minPoisha',
    valueType: 'poisha',
    min: 1,
    max: 9_999_999_999,
    blocksWhenUnset: true,
    current: { kind: 'notSet' },
  }),
  row({
    settingKey: 'referrals.shareBps',
    min: 0,
    max: 10_000,
    current: { kind: 'value', value: 1250, isDefault: false },
  }),
  row({
    settingKey: 'commerce.trial.days',
    current: { kind: 'perSegment', defaultValue: 30 },
  }),
  row({ settingKey: 'future.unknownKey', current: { kind: 'value', value: 3, isDefault: true } }),
];

describe('SettingsOverview', () => {
  it('shows each setting with a plain label, its value and unit, and the allowed range', async () => {
    ui(ROWS);
    const window = await screen.findByTestId('setting-auth.signIn.windowMinutes');
    expect(window.textContent).toContain('Counting window for wrong passwords');
    expect(within(window).getByTestId('setting-value').textContent).toBe('15 minutes');
    expect(window.textContent).toContain('Default');
    expect(window.textContent).toContain('Allowed: 1 minute to 1,440 minutes');
    expect(window.textContent).not.toContain('auth.signIn');

    const sms = screen.getByTestId('setting-notifications.smsEnabled');
    expect(within(sms).getByTestId('setting-value').textContent).toBe('Off');
    expect(sms.textContent).toContain('Changed by an Admin');
    expect(sms.textContent).toContain('On or off');

    expect(
      within(screen.getByTestId('setting-referrals.shareBps')).getByTestId('setting-value')
        .textContent,
    ).toBe('12.5%');
  });

  it('flags a required setting that is not set, and prices with no real ceiling', async () => {
    ui(ROWS);
    expect((await screen.findByTestId('settings-blocking')).textContent).toContain('1');
    const price = screen.getByTestId('setting-catalog.coursePrice.minPoisha');
    expect(price.textContent).toContain('Not set');
    expect(price.textContent).toContain('At least ৳0.01');
  });

  it('shows per-segment settings with their default and a way to change them', async () => {
    ui(ROWS);
    const trial = await screen.findByTestId('setting-commerce.trial.days');
    expect(trial.textContent).toContain('Set for each goal segment');
    expect(trial.textContent).toContain('Default 30 days');
    expect(within(trial).getByRole('link').getAttribute('href')).toBe('#admin-trials-title');
  });

  it('still lists a setting it has no words for, by its key, under Other', async () => {
    ui(ROWS);
    expect((await screen.findByTestId('setting-future.unknownKey')).textContent).toContain(
      'future.unknownKey',
    );
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('uses Bangla words and digits in Bangla', async () => {
    ui(ROWS, 'bn');
    const window = await screen.findByTestId('setting-auth.signIn.windowMinutes');
    expect(within(window).getByTestId('setting-value').textContent).toBe('১৫ মিনিট');
  });
});
