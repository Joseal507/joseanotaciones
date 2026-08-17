import { defineConfig, devices } from '@playwright/test'

// Config dedicada a capturar el review visual de P2 (TemaView/Leaderboard/Quiz/Truquitos/Analisis).
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/visual-p2-cohesion.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3101' },
  outputDir: 'reports/playwright-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101/landing',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
