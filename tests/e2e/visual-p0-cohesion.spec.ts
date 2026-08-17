import { expect, test, type Page } from '@playwright/test';

// Captura visual de la pasada P0 de cohesión (Adaptive / Manual / Flashcards).
// No es funcional: mockea genéricamente las rutas API para que cada
// superficie pinte su shell sin depender de auth/datos reales. Solo se
// corre explícitamente (patrón visual-*.spec.ts, excluido del run normal).

async function mockApis(page: Page) {
  await page.route('**/api/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [], materials: {}, blueprint: null }) });
  });
}

async function seedTheme(page: Page, dark: boolean, tema: string) {
  await page.addInitScript(([d, t]) => {
    localStorage.setItem('studyal_darkmode', d ? 'dark' : 'light');
    localStorage.setItem('studyal_settings', JSON.stringify({ tema: t }));
  }, [dark, tema] as const);
}

const SURFACES: Array<{ id: string; label: string }> = [
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'manual', label: 'Manual' },
  { id: 'cards', label: 'Flashcards' },
];

const THEMES: Array<{ dark: boolean; tema: string; label: string }> = [
  { dark: false, tema: 'default', label: 'light-clasico' },
  { dark: true, tema: 'default', label: 'dark-clasico' },
  { dark: true, tema: 'neon', label: 'dark-electrico' },
];

for (const surface of SURFACES) {
  for (const theme of THEMES) {
    test(`P0 visual: ${surface.label} / ${theme.label}`, async ({ page }) => {
      await mockApis(page);
      await seedTheme(page, theme.dark, theme.tema);
      await page.goto(`/e2e-visual-p0?surface=${surface.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await page.screenshot({
        path: `reports/playwright/p0-${surface.id}-${theme.label}.png`,
        fullPage: false,
      });
      // Humo: la página realmente pintó algo, no quedó en blanco/crash.
      const bodyText = await page.evaluate(() => document.body.innerText.length);
      expect(bodyText).toBeGreaterThan(0);
    });
  }
}
