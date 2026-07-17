import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e-real-sessions',
  // El perfil assistance_dependent recorre todas las repairs válidas antes de
  // cerrar; ese recorrido visual completo puede superar un minuto en dev.
  timeout: 120_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright-real-sessions', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3102',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'reports/playwright-real-sessions-artifacts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102/e2e-real-sessions',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
