// Journey: an Admin adds a new Instructor by email; the invitee opens the emailed link, sets a
// password and signs in (straight to two-step); the Admin then opens their staff profile.
// Synthetic accounts only; the demo staff accounts are never used. SHOTS_DIR saves screenshots.
import { expect, type Page, test } from '@playwright/test';
import { totpCode } from '../../src/features/identity-access/domain/totp.ts';
import { readDevMailbox } from '../../src/features/notifications/server/email-sender.server.ts';
import { signUpAndVerify } from '../catalog/journey.ts';
import { withLocalDb } from '../catalog/seed.ts';
import { resetLocalRateLimits } from '../local-rate-limits.ts';
import { gotoHydrated } from './helpers.ts';

const PASSWORD = 'E2e-synthetic-password-1';
const shots = process.env.SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!shots) return;
  for (const [label, size] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 900 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${shots}/${name}-${label}.png`, fullPage: true });
  }
}

async function adminWithTwoStep(page: Page) {
  const email = `e2e.inviter.${Date.now().toString(36)}@example.test`;
  await signUpAndVerify(page, email, PASSWORD);
  await withLocalDb((c) =>
    c.query(
      `INSERT INTO staff_role_assignment (user_id, role, assigned_by)
       SELECT user_id, 'admin', user_id FROM user_account WHERE email_normalised = $1`,
      [email],
    ),
  );
  await page.context().clearCookies();
  await gotoHydrated(page, '/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL('**/two-step');
  await page.getByTestId('two-step-start').click();
  const key = ((await page.getByTestId('two-step-setup-key').textContent()) ?? '').replace(
    /\s+/g,
    '',
  );
  await page.getByTestId('two-step-code').fill(totpCode(key, new Date().toISOString()));
  await page.getByTestId('two-step-confirm').click();
  await page.getByTestId('two-step-recovery-saved').click();
  await page.waitForURL('**/admin**');
}

test.beforeAll(async () => {
  await resetLocalRateLimits();
});

test('an Admin invites a new Instructor, who joins with the emailed link', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await adminWithTwoStep(page);

  // 1. Add staff: a new email gets an invitation.
  const run = Date.now().toString(36);
  const invitee = `e2e.invitee.${run}@example.test`;
  const inviteeName = `Farhana Invitee ${run}`;
  await gotoHydrated(page, '/admin/staff');
  await page.getByTestId('staff-name').fill(inviteeName);
  await page.getByTestId('staff-email').fill(invitee);
  await page.getByLabel(/Employee/).check();
  await page.getByTestId('staff-assign').click();
  await expect(page.getByTestId('staff-added')).toContainText(invitee);
  await expect(page.getByTestId('staff-invites')).toContainText(invitee);
  await shot(page, 'staff-admin');

  // 2. The invitee opens the link in their own browser and sets a password.
  const mail = readDevMailbox().find((m) => m.to === invitee && m.kind === 'staff_invite');
  expect(mail, 'invitation email in the dev mailbox').toBeTruthy();
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await gotoHydrated(inviteePage, new URL(mail?.link ?? '').pathname);
  await expect(inviteePage.getByTestId('staff-invite-page')).toContainText(inviteeName);
  await shot(inviteePage, 'staff-invite');
  const password = 'Invitee-password-2026';
  await inviteePage.getByTestId('staff-invite-password').fill(password);
  await inviteePage.getByTestId('staff-invite-again').fill(password);
  await inviteePage.getByTestId('staff-invite-submit').click();
  await expect(inviteePage.getByTestId('staff-invite-done')).toBeVisible();

  // 3. They sign in like any staff member: on to two-step.
  await gotoHydrated(inviteePage, '/sign-in');
  await inviteePage.getByTestId('sign-in-email').fill(invitee);
  await inviteePage.getByTestId('sign-in-password').fill(password);
  await inviteePage.getByTestId('sign-in-submit').click();
  await inviteePage.waitForURL('**/two-step');
  // The link works once.
  await gotoHydrated(inviteePage, new URL(mail?.link ?? '').pathname);
  await expect(inviteePage.getByTestId('staff-invite-invalid')).toBeVisible();
  await inviteeContext.close();

  // 4. The Admin sees them as staff and opens their profile, with the money tabs.
  await gotoHydrated(page, '/admin/staff');
  await expect(page.getByTestId('staff-invites')).toHaveCount(0);
  await page.getByRole('link', { name: inviteeName }).click();
  await expect(page.getByTestId('staff-profile')).toContainText(inviteeName);
  await shot(page, 'staff-profile-overview');
  await page.getByTestId('staff-profile-tab-payouts').click();
  await expect(page.getByTestId('staff-profile')).toContainText('No payout cycle');
  await page.getByTestId('staff-profile-tab-earnings').click();
  await shot(page, 'staff-profile-earnings');
});
