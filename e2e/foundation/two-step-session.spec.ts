// Regression: finishing two-step (first enrolment, and the challenge on a later sign-in) must land the
// staff member in the signed-in shell straight away, without a manual page reload. The shell (sidebar
// on wide screens, drawer on phones) only renders when the root loader's shell state says signed in.
// Synthetic account only; the demo staff accounts are never enrolled by tests.
import { expect, type Page, test } from '@playwright/test';
import { totpCode } from '../../src/features/identity-access/domain/totp.ts';
import { signUpAndVerify } from '../catalog/journey.ts';
import { withLocalDb } from '../catalog/seed.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import { gotoHydrated } from './helpers.ts';

const PASSWORD = 'E2e-synthetic-password-1';

async function submitSignIn(page: Page, email: string) {
  await gotoHydrated(page, '/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  // Staff land on the two-step screen by client navigation (no full reload).
  await page.waitForURL('**/two-step', { timeout: 30_000 });
}

/** The next 30-second TOTP window's code, so a challenge never reuses the enrolment's step. */
async function freshCode(key: string, lastCode: string): Promise<string> {
  for (;;) {
    const code = totpCode(key, new Date().toISOString());
    if (code !== lastCode) return code;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test.beforeAll(async () => {
  await resetLocalRateLimits();
});

test('an Admin is in the signed-in shell right after two-step, without a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = `e2e.twostep.${Date.now().toString(36)}@example.test`;
  await signUpAndVerify(page, email, PASSWORD);
  await withLocalDb((c) =>
    c.query(
      `INSERT INTO staff_role_assignment (user_id, role, assigned_by)
       SELECT user_id, 'admin', user_id FROM user_account WHERE email_normalised = $1`,
      [email],
    ),
  );
  // A fresh browser session for the staff sign-in.
  await page.context().clearCookies();

  // 1. First sign-in: enrol.
  await submitSignIn(page, email);
  await page.getByTestId('two-step-start').click();
  const key = ((await page.getByTestId('two-step-setup-key').textContent()) ?? '').replace(
    /\s+/g,
    '',
  );
  const enrolCode = totpCode(key, new Date().toISOString());
  await page.getByTestId('two-step-code').fill(enrolCode);
  await page.getByTestId('two-step-confirm').click();
  await expect(page.getByTestId('two-step-recovery-codes')).toBeVisible();
  await page.getByTestId('two-step-recovery-saved').click();

  await page.waitForURL('**/admin**', { timeout: 30_000 });
  await expect(page.getByTestId('student-shell')).toBeVisible();
  await expect(page.getByTestId('admin-denied')).toHaveCount(0);

  // 2. A later sign-in: the challenge.
  await page.context().clearCookies();
  await submitSignIn(page, email);
  await page.getByTestId('two-step-challenge-code').fill(await freshCode(key, enrolCode));
  await page.getByTestId('two-step-verify').click();

  await page.waitForURL('**/admin**', { timeout: 30_000 });
  await expect(page.getByTestId('student-shell')).toBeVisible();
  await expect(page.getByTestId('admin-denied')).toHaveCount(0);
});
