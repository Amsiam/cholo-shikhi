// Shared steps for the catalog e2e journeys. Synthetic @example.test accounts only.
import { expect, type Page } from '@playwright/test';
import { gotoHydrated } from '../foundation/helpers.ts';

/** Signs up a synthetic account and opens its verify link from the local dev mailbox. */
export async function signUpAndVerify(page: Page, email: string, password: string) {
  await gotoHydrated(page, '/sign-up');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(password);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-check-email')).toBeVisible();
  await gotoHydrated(page, '/dev/mailbox');
  await page
    .locator(`[data-testid="dev-mailbox-item"][data-to="${email}"][data-kind="verify"]`)
    .getByTestId('dev-mailbox-link')
    .click();
  await expect(page.getByTestId('home-verified')).toBeVisible();
}

/** A fresh verified Student, signed in. */
export async function newStudent(page: Page) {
  const email = `e2e.student.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  await signUpAndVerify(page, email, 'E2e-synthetic-password-1');
  return email;
}

/** Fails when any element inside `scope` overflows its box horizontally (longest-string check). */
export async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const overflowing = await page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.getAttribute('data-testid') ?? node.tagName),
    );
  expect(overflowing).toEqual([]);
}

/** NFR6.220: the service worker cache holds no U2 responses after a catalog journey. */
export async function expectNoCatalogResponsesCached(page: Page) {
  const cached = await page.evaluate(async () => {
    if (!('caches' in window)) return [];
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls.filter((url) => /_serverFn|\/catalog|\/courses\//.test(url));
  });
  expect(cached).toEqual([]);
}
