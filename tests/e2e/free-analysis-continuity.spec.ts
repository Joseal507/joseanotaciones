import { expect, test, type BrowserContext, type Page } from '@playwright/test';

type DurableSession = Record<string, unknown> | null;

function analysisFixture(level: string) {
  return {
    titulo: `Análisis durable ${level}`,
    nivel_detectado: level,
    objetivos: [`Objetivo durable ${level}`],
    si_no_sabes_nada: `Base durable ${level} explicada únicamente desde el material autorizado.`,
    mapa_inicial: `Mapa durable ${level} con AUTHORIZED_ALPHA y AUTHORIZED_BETA.`,
    cobertura_material: [{ elemento: 'AUTHORIZED_ALPHA', por_que_importa: 'Contenido seleccionado y autorizado para esta sesión.' }],
    clase_narrativa: [{ titulo: `Clase ${level}`, explicacion: 'Explicación durable grounded con suficiente contenido para restaurar exactamente.', ejemplo: 'AUTHORIZED_BETA', checkpoint: '¿Qué aprendiste?' }],
    panorama_completo: `Panorama durable ${level} con las fuentes autorizadas.`,
    resumen_final_profesor: `Resumen durable ${level} sin contenido no seleccionado.`,
    preguntale_alai: 'Pregunta sobre el análisis durable.',
  };
}

async function installRoutes(
  page: Page,
  server: { session: DurableSession },
  answer?: (level: string, call: number) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  let calls = 0;
  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }) });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      sourceSelectionFingerprint: request.sourceSelection.fingerprint,
      totalChars: 70,
      materials: {
        'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 34 },
        'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 33 },
      },
    }) });
  });
  await page.route('**/api/analizar-teorico', async route => {
    calls += 1;
    const request = route.request().postDataJSON();
    const level = String(request.nivel || 'universidad');
    const response = answer
      ? await answer(level, calls)
      : { status: 200, body: { success: true, analisis: analysisFixture(level) } };
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await page.route('**/api/alai-studyal-chat', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: 'Respuesta de duda durable' }) }));
  return () => calls;
}

test('Análisis restaura resultado completo tras refresh sin regenerar', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, server);
  await page.goto('/e2e-free-continuity?tool=analysis&level=universidad');
  await expect(page.getByText('Análisis durable universidad')).toBeVisible();
  await page.getByRole('button', { name: /marcar leído/i }).first().click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText('Análisis durable universidad')).toBeVisible();
  await expect(page.getByRole('button', { name: /leído/i }).first()).toContainText('leído');
  expect(calls()).toBe(1);
});

test('Análisis mantiene resultados aislados por tipo', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, server);
  await page.goto('/e2e-free-continuity?tool=analysis&level=universidad');
  await expect(page.getByText('Análisis durable universidad')).toBeVisible();
  await page.waitForTimeout(400);
  await page.goto('/e2e-free-continuity?tool=analysis&level=medicina');
  await expect(page.getByText('Análisis durable medicina')).toBeVisible();
  await page.waitForTimeout(400);
  await page.goto('/e2e-free-continuity?tool=analysis&level=universidad');
  await expect(page.getByText('Análisis durable universidad')).toBeVisible();
  expect(calls()).toBe(2);
});

test('Análisis conserva fallo recuperable y retry produce un resultado autoritativo', async ({ page }) => {
  const server = { session: null as DurableSession };
  let failed = false;
  const calls = await installRoutes(page, server, async level => {
    if (!failed) {
      failed = true;
      return { status: 503, body: { success: false, error: 'Proveedor temporalmente no disponible' } };
    }
    return { status: 200, body: { success: true, analisis: analysisFixture(level) } };
  });
  await page.goto('/e2e-free-continuity?tool=analysis');
  await expect(page.getByText('Proveedor temporalmente no disponible')).toBeVisible();
  await page.getByTestId('analysis-retry').click();
  await expect(page.getByText('Análisis durable universidad')).toBeVisible();
  await expect(page.getByText('Análisis durable universidad')).toHaveCount(1);
  expect(calls()).toBe(2);
});

test('Análisis restaura desde servidor sin estado local y es usable en móvil', async ({ browser }) => {
  const server = { session: null as DurableSession };
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await installRoutes(firstPage, server);
  await firstPage.goto('/e2e-free-continuity?tool=analysis');
  await expect(firstPage.getByText('Análisis durable universidad')).toBeVisible();
  await firstPage.waitForTimeout(700);
  expect(server.session).not.toBeNull();
  await firstContext.close();

  const secondContext: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondPage = await secondContext.newPage();
  const calls = await installRoutes(secondPage, server);
  await secondPage.goto('/e2e-free-continuity?tool=analysis');
  await expect(secondPage.getByText('Análisis durable universidad')).toBeVisible();
  expect(calls()).toBe(0);
  expect(await secondPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await secondContext.close();
});
