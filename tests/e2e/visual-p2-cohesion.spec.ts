import { expect, test, type Page } from '@playwright/test';

// Captura visual de la pasada P2 de cohesión (TemaView / Leaderboard / Quiz /
// Truquitos / Análisis). No es funcional: mockea genéricamente las rutas API
// para que cada superficie pinte su shell sin depender de auth/datos reales.
// Solo se corre explícitamente (patrón visual-*.spec.ts, excluido del run normal).

const LEADERBOARD_ENTRIES = Array.from({ length: 8 }, (_, i) => ({
  user_id: `u${i + 1}`,
  nombre: `Estudiante ${i + 1}`,
  xp_total: 5000 - i * 400,
  flashcards_estudiadas: 120 - i * 8,
  racha_actual: 12 - i,
  mejor_racha: 30 - i,
  precision_global: 92 - i,
  updated_at: new Date().toISOString(),
  carrera: 'Ingeniería',
  universidad: 'Universidad de ejemplo',
  tipo_estudiante: 'universitario',
}));

async function mockApis(page: Page) {
  await page.route('**/api/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [], materials: {} }) });
  });
  await page.route('**/api/leaderboard', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: LEADERBOARD_ENTRIES }) });
  });
  await page.route('**/api/auth/session', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function seedTheme(page: Page, dark: boolean, tema: string) {
  await page.addInitScript(([d, t]) => {
    localStorage.setItem('studyal_darkmode', d ? 'dark' : 'light');
    localStorage.setItem('studyal_settings', JSON.stringify({ tema: t }));
  }, [dark, tema] as const);
}

const SURFACES: Array<{ id: string; label: string }> = [
  { id: 'temaview', label: 'TemaView' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'truquitos', label: 'Truquitos' },
  { id: 'analisis', label: 'Analisis' },
];

const THEMES: Array<{ dark: boolean; tema: string; label: string }> = [
  { dark: false, tema: 'default', label: 'light-clasico' },
  { dark: true, tema: 'default', label: 'dark-clasico' },
  { dark: true, tema: 'neon', label: 'dark-electrico' },
];

for (const surface of SURFACES) {
  for (const theme of THEMES) {
    test(`P2 visual: ${surface.label} / ${theme.label}`, async ({ page }) => {
      await mockApis(page);
      await seedTheme(page, theme.dark, theme.tema);
      await page.goto(`/e2e-visual-p1?surface=${surface.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await page.waitForFunction(() => !document.body.innerText.includes('cargando ranking'), { timeout: 8000 }).catch(() => {});
      await page.screenshot({
        path: `reports/playwright/p2-${surface.id}-${theme.label}.png`,
        fullPage: false,
      });
      const bodyText = await page.evaluate(() => document.body.innerText.length);
      expect(bodyText).toBeGreaterThan(0);
    });
  }
}
