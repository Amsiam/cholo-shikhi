// [LT] OfflineBanner (R-STATES), InstallPrompt (US9.1 in the browser) and UpdateBanner (AC9.2.2).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { InstallPrompt, OfflineBanner, UpdateBanner } from './Banners.tsx';

const ui = (node: React.ReactNode) => render(<I18nProvider locale="en">{node}</I18nProvider>);
function setOnline(isOnline: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => isOnline });
}
function installEvent() {
  const event = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void> };
  event.prompt = vi.fn(async () => undefined);
  return event;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('OfflineBanner', () => {
  it('appears when the connection drops and disappears when it returns', () => {
    ui(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('offline-banner').textContent).toMatch(/offline/);
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('InstallPrompt', () => {
  it('AC9.1.1 shows on the second visit when the flag is on, and installs on tap', async () => {
    localStorage.setItem('cs.visits', '1');
    ui(<InstallPrompt isFlagOn minVisits={2} dismissDays={7} />);
    const event = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    fireEvent.click(await screen.findByTestId('install-prompt-accept'));
    expect(event.prompt).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('install-prompt')).toBeNull());
    expect(localStorage.getItem('cs.installShown')).toBe('1');
  });

  it('AC9.1.2 remembers a dismissal on the device', async () => {
    localStorage.setItem('cs.visits', '3');
    ui(<InstallPrompt isFlagOn minVisits={2} dismissDays={7} />);
    act(() => {
      window.dispatchEvent(installEvent());
    });
    fireEvent.click(await screen.findByTestId('install-prompt-dismiss'));
    expect(localStorage.getItem('cs.installDismissedAt')).not.toBeNull();
    expect(screen.queryByTestId('install-prompt')).toBeNull();
  });

  it('AC9.1.3 stays hidden while the flag is off', () => {
    localStorage.setItem('cs.visits', '9');
    ui(<InstallPrompt isFlagOn={false} minVisits={2} dismissDays={7} />);
    act(() => {
      window.dispatchEvent(installEvent());
    });
    expect(screen.queryByTestId('install-prompt')).toBeNull();
  });
});

describe('UpdateBanner', () => {
  it('AC9.2.2 offers "Update" for a waiting version and only applies it when tapped', async () => {
    const waiting = { postMessage: vi.fn() };
    const registration = { waiting, addEventListener: vi.fn() };
    const serviceWorker = {
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
      controller: {},
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    ui(<UpdateBanner />);
    fireEvent.click(await screen.findByTestId('update-banner-apply'));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js');
  });
});
