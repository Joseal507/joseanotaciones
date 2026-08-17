import { defineConfig, devices } from '@playwright/test'

// Config dedicada a la verificación visual. La config principal excluye
// visual-*.spec.ts a propósito (no debe correr en cada suite); esta la
// habilita para ejecutarla de forma explícita.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/visual-consistency.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
  },
  outputDir: 'reports/playwright-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/landing',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
