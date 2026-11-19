import { fileURLToPath } from 'node:url';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Three projects: pure unit tests (node), integration tests against the local
// PostgreSQL and Valkey from docker-compose.dev.yml (node), and component tests (jsdom).
// Coverage from all three is merged into one report (team.md Testing Posture).
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See src/lib/cn.ts: the registry's bare `cn` import resolves to the approved local helper.
      cn: fileURLToPath(new URL('./src/lib/cn.ts', import.meta.url)),
    },
  },
  test: {
    // Unit and integration tests never retry automatically (team.md Flaky tests).
    retry: 0,
    // Keep test output readable; logger behaviour is tested with explicit levels.
    env: { LOG_LEVEL: 'silent' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['src/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup-dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Agreed exclusions (team.md Coverage).
        'src/routeTree.gen.ts',
        'src/components/ui/**',
        'drizzle/**',
        'src/**/*.types.ts',
        // Test code itself.
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
      ],
      thresholds: {
        lines: 80,
        'src/lib/money.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
        // U2 Catalog (plan Step 51a, approved by the human on 2026-11-17).
        // Money module: 100% lines and branches (team.md Coverage, pricing modules).
        'src/features/catalog/domain/pricing.ts': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        // Ownership periods (RD-217, NFR11.201).
        'src/features/catalog/domain/ownership.ts': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        // Content safety: the lesson document library, the link validator and the renderer.
        'src/features/catalog/domain/lesson-document.ts': { branches: 100 },
        'src/features/catalog/domain/link-validator.ts': { branches: 100 },
        'src/features/catalog/ui/render-lesson-document.tsx': { branches: 100 },
      },
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
