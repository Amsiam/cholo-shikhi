// CSRF protection on the app's own server functions, through the real server (team.md: CSRF and
// origin checks are never disabled). The language switch is a server-function POST from the page.
import { expect, test } from '@playwright/test';
import { gotoHydrated } from './helpers.ts';

test.use({ locale: 'bn-BD' });

test('a same-origin server-function POST passes and a cross-origin replay is refused', async ({
  page,
  request,
}) => {
  await gotoHydrated(page, '/sign-in');

  const serverFnCall = page.waitForResponse(
    (r) => r.url().includes('/_serverFn/') && r.request().method() === 'POST',
  );
  await page.getByTestId('language-switcher-en').click();
  const sameOrigin = await serverFnCall;
  expect(sameOrigin.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // Replay the same call from another site: refused before the server function runs.
  const url = sameOrigin.url();
  const body = sameOrigin.request().postData() ?? '';
  const contentType = sameOrigin.request().headers()['content-type'] ?? 'application/json';

  const crossSite = await request.post(url, {
    data: body,
    headers: {
      'content-type': contentType,
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  });
  expect(crossSite.status()).toBe(403);

  const untrustedOrigin = await request.post(url, {
    data: body,
    headers: { 'content-type': contentType, origin: 'https://evil.example' },
  });
  expect(untrustedOrigin.status()).toBe(403);
  // A refused request still carries the security headers.
  expect(untrustedOrigin.headers()['x-content-type-options']).toBe('nosniff');

  const noOrigin = await request.post(url, {
    data: body,
    headers: { 'content-type': contentType },
  });
  expect(noOrigin.status()).toBe(403);
});
