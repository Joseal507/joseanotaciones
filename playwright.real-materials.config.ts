import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e-real-materials',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright-real-materials', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'reports/playwright-real-materials-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3101',
    // Precompilar la superficie cliente evita que el primer documento se abra
    // con HTML estático antes de que Next haya emitido el chunk de hidratación.
    url: 'http://127.0.0.1:3101/e2e-real-materials',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
