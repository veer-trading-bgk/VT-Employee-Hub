import { defineConfig, devices } from '@playwright/test';

/**
 * Public journey pages are unauthenticated — no auth.setup / E2E_EMAIL required.
 * Use for journeyPublicScaffold and similar capability-URL smoke tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /journeyPublicScaffold\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev -p 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
