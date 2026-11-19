// [AT] US9.1 Get prompted to install the app (device rules).
import { describe, expect, it } from 'vitest';
import { shouldShowInstallPrompt } from './install-prompt.ts';

const base = {
  isFlagOn: true,
  isPromptAvailable: true,
  visits: 2,
  minVisits: 2,
  dismissedAt: null,
  hasShown: false,
  dismissDays: 7,
  now: '2026-11-13T00:00:00.000Z',
};

describe('US9.1 install prompt', () => {
  it('AC9.1.1 Given the flag is on and this is my second visit, When the browser allows installation, Then the prompt is shown once', () => {
    expect(shouldShowInstallPrompt(base)).toBe(true);
    expect(shouldShowInstallPrompt({ ...base, hasShown: true })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, visits: 1 })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, isPromptAvailable: false })).toBe(false);
  });
  it('AC9.1.2 Given I dismissed it, When I visit again within 7 days, Then it is not shown', () => {
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: '2026-11-08T00:00:00.000Z' })).toBe(
      false,
    );
    expect(shouldShowInstallPrompt({ ...base, dismissedAt: '2026-11-05T00:00:00.000Z' })).toBe(
      true,
    );
  });
  it('AC9.1.3 Given the flag is off, Then no prompt is shown', () => {
    expect(shouldShowInstallPrompt({ ...base, isFlagOn: false, visits: 50 })).toBe(false);
  });
});
