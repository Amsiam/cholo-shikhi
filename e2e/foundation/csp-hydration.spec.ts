// The nonce-based CSP (no 'unsafe-inline' in script-src) must not stop the app from hydrating.
import { expect, test } from '@playwright/test';

test.use({ locale: 'bn-BD' });

test('pages hydrate under the nonce CSP with no policy violations', async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const response = await page.goto('/sign-in');
  const csp = response?.headers()['content-security-policy'] ?? '';
  const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).not.toContain('unsafe-inline');
  expect(csp).toContain('frame-src https://www.youtube-nocookie.com');

  // A click handler only works once React has hydrated (the root shell sets html[data-hydrated]).
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true', { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await page.getByTestId('language-switcher-en').click();
  const early = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(early).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('sign-in-submit')).toHaveText('Sign in');

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations).toEqual([]);
});
