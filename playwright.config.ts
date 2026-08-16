import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    '**/visual-*.spec.ts',
    '**/dev-skip-tool.spec.ts',
  ],
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'reports/playwright-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/e2e-adaptive',
    reuseExistingServer: true,
    timeout: 120_000,
    // ZERO-PAID-PROVIDER TEST GUARD: only ever set for this Playwright-
    // spawned local dev server — never present in production. See
    // instrumentation.ts and lib/alai.ts's assertNoRealProviderCallsInTestMode.
    env: {
      STUDYAL_TEST_NO_PROVIDER_CALLS: '1',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
