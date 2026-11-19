import { defineConfig, devices } from '@playwright/test';

// Critical journeys only (team.md Testing Posture), on a Chromium mobile profile.
// E2E_THROTTLE=1 adds 3G network and 4x CPU throttling (timing is never asserted).
export default defineConfig({
  testDir: './e2e',
  // E2E retries at most once, and every retry is reported.
  retries: 1,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
