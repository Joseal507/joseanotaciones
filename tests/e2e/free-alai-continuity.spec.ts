import { expect, test, type BrowserContext, type Page } from '@playwright/test';

type DurableSession = Record<string, unknown> | null;

async function installRoutes(page: Page, server: { session: DurableSession }, answer?: (message: string, call: number) => Promise<{ status: number; body: Record<string, unknown> }>) {
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
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/alai-studyal-chat', async route => {
    calls += 1;
    const request = route.request().postDataJSON();
    const response = answer
      ? await answer(request.message, calls)
      : { status: 200, body: { success: true, answer: `Respuesta durable: ${request.message}`, inMaterial: true, confidence: 'alta', sourceMaterial: 'e2e-free-a', sourceMaterialName: 'Material A', sourcePages: [2], suggestedFollowups: [] } };
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  return () => calls;
}

async function ask(page: Page, question: string) {
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill(question);
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(`Respuesta durable: ${question}`)).toBeVisible();
}

test('ALAI restaura conversación completa tras refresh sin regenerar', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, server);
  await page.goto('/e2e-free-continuity?tool=alai');
  await ask(page, 'Pregunta A');
  await ask(page, 'Pregunta B');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText('Pregunta A', { exact: true })).toBeVisible();
  await expect(page.getByText('Respuesta durable: Pregunta A')).toBeVisible();
  await expect(page.getByText('Pregunta B', { exact: true })).toBeVisible();
  await expect(page.getByText('Respuesta durable: Pregunta B')).toBeVisible();
  expect(calls()).toBe(2);
});

test('ALAI conserva pregunta fallida y retry produce una sola respuesta', async ({ page }) => {
  const server = { session: null as DurableSession };
  let failed = false;
  const calls = await installRoutes(page, server, async message => {
    if (!failed) {
      failed = true;
      return { status: 503, body: { success: false, error: 'Proveedor temporalmente no disponible' } };
    }
    return { status: 200, body: { success: true, answer: `Respuesta durable: ${message}`, inMaterial: true, confidence: 'alta', sourcePages: [] } };
  });
  await page.goto('/e2e-free-continuity?tool=alai');
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill('Pregunta retry');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByTestId('alai-recoverable-turn')).toBeVisible();
  await page.getByRole('button', { name: /Reintentar respuesta/i }).click();
  await expect(page.getByText('Respuesta durable: Pregunta retry')).toBeVisible();
  await expect(page.getByText('Pregunta retry', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Respuesta durable: Pregunta retry')).toHaveCount(1);
  expect(calls()).toBe(2);
});

test('ALAI convierte una generación interrumpida por refresh en retry explícito', async ({ page }) => {
  const server = { session: null as DurableSession };
  let releaseFirst: (() => void) | null = null;
  const calls = await installRoutes(page, server, async message => {
    if (message === 'Pregunta interrumpida' && !releaseFirst) {
      await new Promise<void>(resolve => { releaseFirst = resolve; });
    }
    return { status: 200, body: { success: true, answer: `Respuesta durable: ${message}`, inMaterial: true, confidence: 'alta', sourcePages: [] } };
  });
  await page.goto('/e2e-free-continuity?tool=alai');
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill('Pregunta interrumpida');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Pregunta interrumpida', { exact: true })).toBeVisible();
  await page.reload();
  releaseFirst?.();
  await expect(page.getByTestId('alai-recoverable-turn')).toBeVisible();
  expect(calls()).toBe(1);
  await page.getByRole('button', { name: /Reintentar respuesta/i }).click();
  await expect(page.getByText('Respuesta durable: Pregunta interrumpida')).toBeVisible();
  expect(calls()).toBe(2);
});

test('ALAI reaparece igual después de visitar otra herramienta', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, server);
  await page.goto('/e2e-free-continuity?tool=alai');
  await ask(page, 'Pregunta navegación');
  await page.waitForTimeout(400);
  await page.goto('/e2e-free-continuity?tool=flashcards');
  await page.goto('/e2e-free-continuity?tool=alai');
  await expect(page.getByText('Pregunta navegación', { exact: true })).toBeVisible();
  await expect(page.getByText('Respuesta durable: Pregunta navegación')).toBeVisible();
  expect(calls()).toBe(1);
});

test('ALAI restaura desde servidor sin localStorage y mantiene mobile usable', async ({ browser }) => {
  const server = { session: null as DurableSession };
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await installRoutes(firstPage, server);
  await firstPage.goto('/e2e-free-continuity?tool=alai');
  await ask(firstPage, 'Pregunta cross device');
  await firstPage.waitForTimeout(700);
  expect(server.session).not.toBeNull();
  await firstContext.close();

  const secondContext: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondPage = await secondContext.newPage();
  const calls = await installRoutes(secondPage, server);
  await secondPage.goto('/e2e-free-continuity?tool=alai');
  await expect(secondPage.getByText('Pregunta cross device', { exact: true })).toBeVisible();
  await expect(secondPage.getByText('Respuesta durable: Pregunta cross device')).toBeVisible();
  expect(calls()).toBe(0);
  expect(await secondPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await secondContext.close();
});
