import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 AA on every e2e page (team.md Accessibility). */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
}

/** Optional 3G + CPU throttling (E2E_THROTTLE=1). */
export async function maybeThrottle(page: Page): Promise<void> {
  if (process.env.E2E_THROTTLE !== '1') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

/**
 * Full page load that resolves only after React has hydrated (the root shell sets
 * html[data-hydrated]). An interaction before hydration hits server-rendered markup with no event
 * handlers: on a cold dev server a click on submit became a native form GET and the journey failed.
 */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // A cold dev server compiles client modules on first request, so hydration can take a while.
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true', { timeout: 30_000 });
}
