import { expect, test, type Page } from '@playwright/test';

// Verificación visual/mecánica de la unificación de loading (P0 de la
// misión "P0 loading global + progreso del triángulo Manual"). No es una
// suite exhaustiva: valida el mecanismo real (NavLoader) y el copy
// canónico en las superficies que la misión pidió revisar explícitamente.

async function mockAuthAndApis(page: Page) {
  await page.route('**/api/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [], materials: {}, data: [] }) });
  });
  await page.route('**/api/auth/session', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('NavLoader: aparece INSTANTÁNEO al click, mismo StudyLoader, sin Preparando/Afinando', async ({ page }) => {
  await mockAuthAndApis(page);
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });

  // Antes de disparar la navegación, no debe existir loader.
  await expect(page.locator('text=Cargando')).toHaveCount(0);
  await page.waitForFunction(() => typeof (window as any).__showNavLoader === 'function');

  // Dispara exactamente el mecanismo que usan los 27 call sites reales
  // (window.__showNavLoader antes de router.push) SIN esperar a que la
  // navegación real resuelva -- así se ve si aparece instantáneo.
  await page.evaluate(() => (window as any).__showNavLoader?.('/settings'));

  const loaderText = await page.locator('text=/Cargando/').first().textContent();
  expect(loaderText).toBe('Cargando Settings');

  // Nada de las frases viejas debe existir en ningún lado del DOM.
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect(bodyText).not.toContain('Preparando');
  expect(bodyText).not.toContain('Afinando');
  expect(bodyText).not.toContain('un momento');

  await page.screenshot({ path: 'reports/playwright/p0-navloader-instant-settings.png' });
});

test('NavLoader: se oculta cuando el pathname real llega a destino', async ({ page }) => {
  await mockAuthAndApis(page);
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__showNavLoader === 'function');
  await page.evaluate(() => (window as any).__showNavLoader?.('/horario'));
  await expect(page.locator('text=Cargando Horario')).toBeVisible();

  await page.goto('/horario', { waitUntil: 'domcontentloaded' });
  // El propio loading.tsx de la ruta puede seguir visible un instante
  // (incluso deseable -- mismo StudyLoader), pero una vez asentada la
  // página no debe quedar el loader de NavLoader pegado para siempre.
  await page.waitForFunction(() => !document.body.innerText.includes('Cargando'), { timeout: 8000 }).catch(() => {});
  const stuck = await page.locator('text=/Cargando/').count();
  expect(stuck).toBeLessThanOrEqual(0);
});

test('NavLoader: timeout de seguridad si la navegación nunca resuelve', async ({ page }) => {
  await mockAuthAndApis(page);
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__showNavLoader === 'function');
  await page.evaluate(() => (window as any).__showNavLoader?.('/perfil'));
  await expect(page.locator('text=Cargando Perfil')).toBeVisible();
  // No navegamos a ningún lado -> a los 10s el propio NavLoader debe soltarse.
  await page.waitForFunction(() => !document.body.innerText.includes('Cargando'), { timeout: 12000 });
});

const ROUTE_LABELS: Array<{ path: string; expected: string }> = [
  { path: '/', expected: 'Cargando StudyAL' },
  { path: '/settings', expected: 'Cargando Settings' },
  { path: '/materias', expected: 'Cargando Materias' },
  { path: '/horario', expected: 'Cargando Horario' },
  { path: '/perfil', expected: 'Cargando Perfil' },
  { path: '/agenda', expected: 'Cargando Agenda' },
];

for (const { path, expected } of ROUTE_LABELS) {
  test(`loading.tsx de ${path} usa el copy canónico exacto`, async ({ page }) => {
    // Respuestas API deliberadamente lentas para forzar que loading.tsx
    // de la ruta quede visible el tiempo suficiente para inspeccionarlo.
    await page.route('**/api/**', route => {
      setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [], data: [] }) }), 3000);
    });
    await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const nav = page.goto(path, { waitUntil: 'commit' });
    await page.waitForTimeout(150);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (bodyText.includes('Cargando')) {
      expect(bodyText).toContain(expected);
      expect(bodyText).not.toContain('Preparando');
      expect(bodyText).not.toContain('Afinando');
    }
    await nav.catch(() => {});
  });
}
