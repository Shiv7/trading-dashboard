import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the Kotsin dashboard smoke test.
 *
 * baseURL defaults to the production deployment so we test the actually-shipped bundle
 * (the same artifact users hit). Override with BASE_URL env var for staging/local.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // serial keeps the console-error reporting deterministic
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: process.env.BASE_URL || 'https://kotsin.in',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
    // Headless shell only — we don't need the full chromium for a smoke test.
    launchOptions: {
      args: ['--no-sandbox'],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
