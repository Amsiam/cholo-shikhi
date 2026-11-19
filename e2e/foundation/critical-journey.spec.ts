// Critical journey (done bar): sign-up -> verify (stub mailbox) -> sign-in -> language switch -> sign-out.
// Synthetic data only: a fresh @example.test address per run.
import { expect, test } from '@playwright/test';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import { expectAccessible, gotoHydrated, maybeThrottle } from './helpers.ts';

// A Bangla-first phone: the browser prefers Bangla, so the first visit is in Bangla (BR6.2).
test.use({ locale: 'bn-BD' });

// Each run signs up from the same loopback client; start from a known rate-limit state so earlier
// runs never exhaust the sign-up limit (see e2e/local-rate-limits.ts). The limit itself is unchanged.
test.beforeAll(async () => {
  await resetLocalRateLimits();
});

test('a learner signs up, verifies, signs in, switches language and signs out', async ({
  page,
}) => {
  await maybeThrottle(page);
  const email = `e2e.${Date.now().toString(36)}@example.test`;
  const password = 'E2e-synthetic-password-1';

  // Visitor on S11: Bangla by default on a first visit.
  await gotoHydrated(page, '/sign-up');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByTestId('sign-up-form')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(password);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-check-email')).toBeVisible();

  // Verify through the local stub mailbox, in the same browser: verified and signed in (AC1.17.1).
  await gotoHydrated(page, '/dev/mailbox');
  const message = page.locator(
    `[data-testid="dev-mailbox-item"][data-to="${email}"][data-kind="verify"]`,
  );
  await expect(message).toHaveCount(1);
  await expectAccessible(page);
  await message.getByTestId('dev-mailbox-link').click();
  await expect(page.getByTestId('home-verified')).toBeVisible();
  await expect(page.getByTestId('notification-bell-link')).toBeVisible();
  await expectAccessible(page);

  // Sign out from Me (within 2 taps of Home), then sign in again.
  await page.getByTestId('nav-me').click();
  await expect(page.getByTestId('me-page')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('me-sign-out').click();
  await expect(page.getByTestId('sign-in-page')).toBeVisible();
  await expectAccessible(page);
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('home-greeting')).toBeVisible();
  await expect(page.getByTestId('notification-bell-link')).toBeVisible();

  // The welcome notification arrives through the outbox relay when the worker runs.
  // Language switch on Me: everything re-renders in English and html lang becomes en (AC1.12.1).
  await page.getByTestId('nav-me').click();
  await page.getByTestId('language-switcher-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('me-sign-out')).toHaveText('Sign out');
  await expectAccessible(page);

  // Sign out: the session ends and Me is no longer reachable.
  await page.getByTestId('me-sign-out').click();
  await expect(page.getByTestId('sign-in-page')).toBeVisible();
  await gotoHydrated(page, '/me');
  await expect(page.getByTestId('sign-in-page')).toBeVisible();
});
