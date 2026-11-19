// [LT] A10 settings in plain words: labels, units, money, per-segment values, unset warnings.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import {
  type SaveSetting,
  type SettingRow,
  SettingsOverview,
  toFormText,
  toStoredValue,
} from './SettingsOverview.tsx';

function ui(
  rows: SettingRow[],
  locale: 'bn' | 'en' = 'en',
  onSave: SaveSetting = async () => ({ ok: true }),
) {
  const rootRoute = createRootRoute({
    component: () => (
      <I18nProvider locale={locale}>
        <SettingsOverview rows={rows} onSave={onSave} />
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

  it('changes a price in taka, saves it in poisha with the reason', async () => {
    const onSave = vi.fn<SaveSetting>(async () => ({ ok: true }));
    ui(ROWS, 'en', onSave);
    const price = await screen.findByTestId('setting-catalog.coursePrice.minPoisha');
    fireEvent.click(within(price).getByTestId('setting-change'));
    fireEvent.change(within(price).getByLabelText('New value'), { target: { value: '1,500.5' } });
    fireEvent.change(within(price).getByLabelText('Why are you changing it?'), {
      target: { value: 'Launch pricing' },
    });
    fireEvent.click(within(price).getByTestId('setting-save'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        settingKey: 'catalog.coursePrice.minPoisha',
        value: 150050,
        reason: 'Launch pricing',
      }),
    );
    await waitFor(() => expect(within(price).queryByTestId('setting-editor')).toBeNull());
  });

  it('refuses a value out of range or without a reason before calling the server', async () => {
    const onSave = vi.fn<SaveSetting>(async () => ({ ok: true }));
    ui(ROWS, 'en', onSave);
    const window = await screen.findByTestId('setting-auth.signIn.windowMinutes');
    fireEvent.click(within(window).getByTestId('setting-change'));
    fireEvent.change(within(window).getByLabelText('New value'), { target: { value: '5000' } });
    fireEvent.click(within(window).getByTestId('setting-save'));
    expect((await within(window).findByRole('alert')).textContent).toContain('outside');
    fireEvent.change(within(window).getByLabelText('New value'), { target: { value: '30' } });
    fireEvent.click(within(window).getByTestId('setting-save'));
    expect((await within(window).findByRole('alert')).textContent).toContain('reason');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server refusal and keeps the form open', async () => {
    const onSave = vi.fn<SaveSetting>(async () => ({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: { value: ['errors.validation.required'] } },
    }));
    ui(ROWS, 'en', onSave);
    const window = await screen.findByTestId('setting-auth.signIn.windowMinutes');
    fireEvent.click(within(window).getByTestId('setting-change'));
    fireEvent.change(within(window).getByLabelText('Why are you changing it?'), {
      target: { value: 'Testing' },
    });
    fireEvent.click(within(window).getByTestId('setting-save'));
    expect((await within(window).findByRole('alert')).textContent).toContain('required');
    expect(within(window).getByTestId('setting-editor')).toBeTruthy();
  });

  it('offers no in-place editor for per-segment settings', async () => {
    ui(ROWS);
    const trial = await screen.findByTestId('setting-commerce.trial.days');
    expect(within(trial).queryByTestId('setting-change')).toBeNull();
  });
});

describe('setting form values', () => {
  it('reads taka and percent with up to two decimals as hundredths, and Bangla digits', () => {
    expect(toStoredValue('taka', '১৫০০')).toBe(150000);
    expect(toStoredValue('taka', '12.5')).toBe(1250);
    expect(toStoredValue('taka', '12.345')).toBeNull();
    expect(toStoredValue('percent', '12.5')).toBe(1250);
    expect(toStoredValue('minutes', '15')).toBe(15);
    expect(toStoredValue('minutes', '1.5')).toBeNull();
    expect(toStoredValue('onOff', 'true')).toBe(true);
    expect(toStoredValue('rounding', 'down')).toBe('down');
    expect(toStoredValue('rounding', 'sideways')).toBeNull();
  });
  it('starts the form from the stored value', () => {
    expect(toFormText('taka', 150050)).toBe('1500.50');
    expect(toFormText('percent', 1000)).toBe('10');
    expect(toFormText('onOff', null)).toBe('false');
  });
});
