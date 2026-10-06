import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running compose stack.
 *   ./raadi e2e   (runs in the toolbox, inside Traefik's network namespace)
 */
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Every worker reaches Traefik from the same IP and shares its per-client
  // rate limit (sized for one person), so the worker count is fixed instead of
  // scaling with the host's cores.
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  // A test that only passes on its retry is a bug in the test or the app: report it as a failure instead
  // of hiding it (the retry still runs, so the trace shows both attempts).
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.PUBLIC_BASE_URL ?? 'http://raadi.localhost',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'nb-NO',
  },
  projects: [
    // One sign-in per demo user for the whole run (see specs/sessions.setup.ts).
    { name: 'sessions', testMatch: /.*\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      dependencies: ['sessions'],
      testIgnore: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
