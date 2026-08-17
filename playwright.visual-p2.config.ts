import { defineConfig, devices } from '@playwright/test'

// Config dedicada a verificar el loading global (P0) y el triángulo Manual (P1).
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/visual-p0-nav-loader.spec.ts', '**/visual-p1-manual-triangle.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100' },
  outputDir: 'reports/playwright-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/landing',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
